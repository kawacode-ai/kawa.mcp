import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'
import { resolveOrigin } from './resolve-origin.js'
import { evaluate } from '../pre_edit_check/evaluator.js'
import {
  computeSupersedes,
  type DecisionForSupersedes,
} from '../pre_edit_check/supersedes.js'
import { getOverrides } from '../pre_edit_check/cache.js'
import type {
  DecisionRecord,
  DecisionType,
  EvaluatorInput,
  OverlappingIntent,
  Tier,
  Recommendation,
  FilteredDiagnostic,
} from '../pre_edit_check/types.js'

export const preEditDecisionCheckSchema = z.object({
  repoOrigin: z
    .string()
    .optional()
    .describe('Git remote origin URL. Auto-detected from repoPath via git if not provided.'),
  repoPath: z
    .string()
    .describe('Local path to the repository root (also used to read the file for AST symbol detection)'),
  filePath: z
    .string()
    .describe('Path to the file being edited (relative to repoPath)'),
  startLine: z
    .number()
    .min(1)
    .describe('Start line of the touched range (1-based, inclusive)'),
  endLine: z
    .number()
    .min(1)
    .describe('End line of the touched range (1-based, inclusive)'),
  intentId: z
    .string()
    .optional()
    .describe('Active intent ID for supersedes scoping. Auto-detected via intent:get-active when omitted.'),
  sessionToken: z
    .string()
    .optional()
    .describe('Session scope for the force-override cache. Defaults to the MCP server\'s SESSION_ID; PreToolUse hook callers should pass Claude Code\'s session_id so writes from one process are visible to the other.'),
})

export type PreEditDecisionCheckInput = z.infer<typeof preEditDecisionCheckSchema>

export interface EnclosingSymbol {
  name: string
  fullyQualifiedName: string
  kind: string
  startLine: number
  endLine: number
  signature: string
}

export interface PreEditDecisionCheckResponse {
  triggered: boolean
  tier: Tier | null
  intents?: OverlappingIntent[]
  decisions?: DecisionRecord[]
  filtered: FilteredDiagnostic
  recommendation: Recommendation
  enclosingSymbol: EnclosingSymbol | null
  language?: string
}

const DECISION_TYPES: ReadonlySet<DecisionType> = new Set<DecisionType>([
  'fork',
  'abandoned',
  'discovery',
  'constraint',
  'tradeoff',
  'dependency',
])

function normalizeDecisionType(raw: unknown): DecisionType {
  if (typeof raw === 'string' && DECISION_TYPES.has(raw as DecisionType)) {
    return raw as DecisionType
  }
  return 'discovery'
}

function normalizeDecision(d: any): DecisionRecord {
  return {
    decisionId: d.decision_id || d.decisionId || d._id || d.id || '',
    intentId:
      d.intent_id ||
      d.intentId ||
      (Array.isArray(d.intent_ids) ? d.intent_ids[0] : undefined) ||
      (Array.isArray(d.intentIds) ? d.intentIds[0] : undefined) ||
      '',
    summary: d.summary || '',
    rationale: d.rationale || '',
    type: normalizeDecisionType(d.decision_type ?? d.decisionType ?? d.type),
  }
}

function normalizeOverlappingIntent(raw: any): OverlappingIntent {
  return {
    intentId: raw.intentId || raw.id || '',
    title: raw.title || 'Unknown Intent',
    blockStartLine: raw.block_start_line || raw.overlappingLines?.blockStartLine || 0,
    blockEndLine: raw.block_end_line || raw.overlappingLines?.blockEndLine || 0,
    overlapStart: raw.overlap_start || raw.overlappingLines?.overlapStart || 0,
    overlapEnd: raw.overlap_end || raw.overlappingLines?.overlapEnd || 0,
  }
}

function normalizeEnclosingSymbol(raw: any): EnclosingSymbol | null {
  if (!raw || raw.symbol == null) return null
  const s = raw.symbol
  return {
    name: s.name || '',
    fullyQualifiedName: s.fullyQualifiedName || s.fully_qualified_name || s.name || '',
    kind: s.kind || 'unknown',
    startLine: s.startLine || s.start_line || 0,
    endLine: s.endLine || s.end_line || 0,
    signature: s.signature || '',
  }
}

export async function preEditDecisionCheck(
  input: PreEditDecisionCheckInput,
): Promise<PreEditDecisionCheckResponse> {
  const origin = resolveOrigin(input.repoOrigin, input.repoPath)

  // Resolve the active intent ID. Caller may pin it via input.intentId — that's
  // useful for hooks that fire with stale-but-still-correct context (e.g.,
  // mid-session activate-intent races). Otherwise ask Muninn for the current
  // active intent. An empty string is acceptable (no active intent yet).
  let activeIntentId = input.intentId ?? ''
  if (activeIntentId.length === 0) {
    try {
      const activeRes = await request('intent', 'get-active', { repoOrigin: origin })
      activeIntentId = activeRes?.intent?.id || activeRes?.intentId || ''
    } catch {
      // No active intent is a normal state — fall through with empty id.
    }
  }

  // Fan out the four IPC calls in parallel. Each is independent — Tier 1a
  // intents, project-list (for both supersedes computation and Tier 1a
  // intent-associated decisions), Tier 1b file-filtered decisions, and the
  // optional enclosing-symbol enrichment.
  const [tier1aRes, projectListRes, tier1bRes, symbolRes] = await Promise.allSettled([
    request('intent-block', 'get-for-lines', {
      repoOrigin: origin,
      filePath: input.filePath,
      startLine: input.startLine,
      endLine: input.endLine,
    }),
    request('decision', 'project-list', { repoOrigin: origin }),
    request('decision', 'by-file', { repoOrigin: origin, filePath: input.filePath }),
    request('ast', 'get-enclosing-symbol', {
      repoPath: input.repoPath,
      filePath: input.filePath,
      startLine: input.startLine,
      endLine: input.endLine,
    }),
  ])

  const tier1aIntents: OverlappingIntent[] =
    tier1aRes.status === 'fulfilled'
      ? ((tier1aRes.value?.intents || []) as any[]).map(normalizeOverlappingIntent)
      : []

  const allRepoDecisionsRaw: any[] =
    projectListRes.status === 'fulfilled'
      ? (projectListRes.value?.decisions || [])
      : []

  const tier1bDecisionsRaw: any[] =
    tier1bRes.status === 'fulfilled' ? (tier1bRes.value?.decisions || []) : []

  // Tier 1a's associated decisions: filter the repo decision list down to those
  // whose intent IDs overlap the overlapping intents. A decision can span
  // multiple intents post-evolve, hence checking both intent_id and intent_ids[].
  const tier1aIntentIdSet = new Set(tier1aIntents.map(i => i.intentId).filter(Boolean))
  const tier1aDecisionsRaw = allRepoDecisionsRaw.filter(d => {
    const owners = new Set<string>()
    if (d.intent_id) owners.add(d.intent_id)
    if (d.intentId) owners.add(d.intentId)
    if (Array.isArray(d.intent_ids)) for (const id of d.intent_ids) owners.add(id)
    if (Array.isArray(d.intentIds)) for (const id of d.intentIds) owners.add(id)
    for (const id of tier1aIntentIdSet) if (owners.has(id)) return true
    return false
  })

  const tier1aDecisions = tier1aDecisionsRaw.map(normalizeDecision)
  const tier1bDecisions = tier1bDecisionsRaw.map(normalizeDecision)

  const supersedesInput: DecisionForSupersedes[] = allRepoDecisionsRaw.map(d => ({
    intentId: d.intentId,
    intent_id: d.intent_id,
    intentIds: d.intentIds,
    intent_ids: d.intent_ids,
    supersedes: Array.isArray(d.supersedes) ? d.supersedes : undefined,
  }))
  const { activeIntentSupersedes, repoScopedSupersedes } = computeSupersedes(
    supersedesInput,
    activeIntentId,
  )

  const evaluatorInput: EvaluatorInput = {
    tier1aIntents,
    tier1aDecisions,
    tier1bDecisions,
    activeIntentSupersedes,
    repoScopedSupersedes,
    sessionForceOverrides: await getOverrides(input.sessionToken),
  }

  const result = evaluate(evaluatorInput)

  const symbolPayload = symbolRes.status === 'fulfilled' ? symbolRes.value : null
  const enclosingSymbol = normalizeEnclosingSymbol(symbolPayload)
  const language = symbolPayload?.language as string | undefined

  return {
    triggered: result.triggered,
    tier: result.tier,
    intents: result.intents,
    decisions: result.decisions,
    filtered: result.filtered,
    recommendation: result.recommendation,
    enclosingSymbol,
    language,
  }
}

export const preEditDecisionCheckTool = {
  name: 'pre_edit_decision_check',
  description: `Check whether the line range about to be edited has prior recorded reasoning attached.

Call this BEFORE editing code in a kawa-indexed repo. Surfaces:
- Tier 1a — overlapping intents whose blocks cover these lines (line-precise team coordination + intent-scoped decisions)
- Tier 1b — repo decisions whose relatedFiles include this file (file-coarse, catches infer_history-extracted constraints)

Decisions already overridden via record_decision(supersedes=...) are filtered out automatically.

Recommendation maps to action:
- "proceed" — nothing relevant; safe to edit
- "review" — surfaced context worth inspecting before editing
- "investigate-upstream" — prior constraint or abandoned approach matches; don't proceed without reading the rationale and either revising the change or recording a new fork decision that supersedes the old one

Also returns the smallest enclosing function/method symbol via tree-sitter (Rust/TS/JS/Python only; null for other languages) for warning readability.`,
  inputSchema: preEditDecisionCheckSchema,
  handler: preEditDecisionCheck,
}
