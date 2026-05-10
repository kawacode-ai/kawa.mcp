#!/usr/bin/env node
/**
 * kawacode-pre-edit-decision-check — Claude Code PreToolUse hook for
 * Edit/Write tools (kawa.dev-doc/PRE_EDIT_DECISION_CHECK.md §Phase 3).
 *
 * Reads the PreToolUse hook payload from stdin:
 *   { session_id, transcript_path, cwd, hook_event_name, tool_name, tool_input }
 *
 * Connects directly to Muninn (mirroring kawacode-extract-trigger), runs the
 * same orchestration that the pre_edit_decision_check MCP tool does, plus
 * the new pre-edit-cache:get/add IPC for the session force-override cache.
 *
 * Three-mode output per plan §Phase 3 + decision #2:
 *   - Block      (exit 2 + stderr message)  — Tier 1a + constraint/abandoned in filtered set
 *   - Advisory   (exit 0 + JSON to stdout)  — Tier 1a (no block-trigger types) or Tier 1b
 *   - Silent     (exit 0, no output)        — no tier fired or pipeline removed everything
 *
 * Override paths:
 *   - record_decision(supersedes=...) — handled by the agent; this hook re-fires next Edit
 *     and the supersedes filter drops the decision.
 *   - force: true on the Edit input — this hook detects it, adds the surfaced decision IDs
 *     to pre-edit-cache via Muninn, and exits 0 (allow).
 *
 * Failure discipline: every error path exits 0 to never block Claude Code on hook failure.
 * Opt out with KAWA_PRE_EDIT_CHECK=off.
 */

import { readFileSync } from 'node:fs'

import { connectToMuninn, request, disconnect } from './services/muninn-ipc.js'
import { evaluate } from './pre_edit_check/evaluator.js'
import { computeSupersedes, type DecisionForSupersedes } from './pre_edit_check/supersedes.js'
import type {
  DecisionRecord,
  DecisionType,
  EvaluatorInput,
  OverlappingIntent,
} from './pre_edit_check/types.js'

interface HookPayload {
  session_id?: string
  cwd?: string
  hook_event_name?: string
  tool_name?: string
  tool_input?: {
    file_path?: string
    old_string?: string
    new_string?: string
    content?: string
    force?: boolean
    [key: string]: any
  }
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
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

/**
 * Find the first occurrence of `needle` in `haystack` and return its 1-based
 * inclusive line range. Returns null if not found.
 */
function locateLineRange(haystack: string, needle: string): { startLine: number; endLine: number } | null {
  if (!needle) return null
  const idx = haystack.indexOf(needle)
  if (idx < 0) return null

  // Count newlines in haystack[0..idx] to get the start line (1-based).
  let startLine = 1
  for (let i = 0; i < idx; i += 1) {
    if (haystack.charCodeAt(i) === 10) startLine += 1
  }

  // Count newlines within needle to get the end line.
  let extraLines = 0
  for (let i = 0; i < needle.length; i += 1) {
    if (needle.charCodeAt(i) === 10) extraLines += 1
  }
  return { startLine, endLine: startLine + extraLines }
}

interface ResolvedTarget {
  filePath: string // relative to repoPath
  repoPath: string
  startLine: number
  endLine: number
}

/**
 * Derive the touched line range from the hook payload's tool_input.
 *
 * Edit:  use old_string to locate the range in the existing file.
 * Write: when the file exists, target the whole current file (lines 1..N).
 *        When the file is new (target doesn't exist), skip — no prior
 *        intents/decisions could own lines that don't yet exist.
 *
 * Returns null when we can't (or shouldn't) check.
 */
function resolveTarget(payload: HookPayload): ResolvedTarget | null {
  const cwd = payload.cwd
  const toolName = payload.tool_name
  const input = payload.tool_input
  if (!cwd || !toolName || !input) return null
  const filePath = input.file_path
  if (!filePath) return null

  // file_path may be absolute or repo-relative. Normalize to absolute, then
  // derive repo-relative by stripping cwd prefix (best effort — Muninn IPC
  // accepts either form for most actions but the AST handler reads from disk
  // so we want the absolute path).
  let absolutePath = filePath
  let relativePath = filePath
  if (filePath.startsWith('/')) {
    if (filePath.startsWith(cwd + '/')) {
      relativePath = filePath.slice(cwd.length + 1)
    }
  } else {
    absolutePath = `${cwd}/${filePath}`
  }

  let fileContent: string
  try {
    fileContent = readFileSync(absolutePath, 'utf8')
  } catch {
    if (toolName === 'Write') {
      // New file — nothing for the index to surface.
      return null
    }
    return null
  }

  if (toolName === 'Edit') {
    const oldString = input.old_string
    if (!oldString) return null
    const range = locateLineRange(fileContent, oldString)
    if (!range) return null
    return {
      filePath: relativePath,
      repoPath: cwd,
      startLine: range.startLine,
      endLine: range.endLine,
    }
  }

  if (toolName === 'Write') {
    // Existing file overwrite — surface for the entire current file.
    const lines = fileContent.split('\n').length
    return {
      filePath: relativePath,
      repoPath: cwd,
      startLine: 1,
      endLine: Math.max(1, lines),
    }
  }

  return null
}

interface CheckResult {
  recommendation: 'proceed' | 'review' | 'investigate-upstream'
  intents: OverlappingIntent[]
  decisions: DecisionRecord[]
  enclosingSymbolName?: string
}

async function runCheck(
  target: ResolvedTarget,
  sessionToken: string,
): Promise<CheckResult> {
  // Resolve active intent (best-effort — empty string if none).
  let activeIntentId = ''
  try {
    const activeRes = await request('intent', 'get-active', { repoPath: target.repoPath })
    activeIntentId = activeRes?.intent?.id || activeRes?.intentId || ''
  } catch {
    /* no active intent — proceed with empty id */
  }

  const [tier1aRes, projectListRes, tier1bRes, symbolRes, cacheRes] = await Promise.allSettled([
    request('intent-block', 'get-for-lines', {
      repoPath: target.repoPath,
      filePath: target.filePath,
      startLine: target.startLine,
      endLine: target.endLine,
    }),
    request('decision', 'project-list', { repoPath: target.repoPath }),
    request('decision', 'by-file', {
      repoPath: target.repoPath,
      filePath: target.filePath,
    }),
    request('ast', 'get-enclosing-symbol', {
      repoPath: target.repoPath,
      filePath: target.filePath,
      startLine: target.startLine,
      endLine: target.endLine,
    }),
    request('pre-edit-cache', 'get', { sessionToken }),
  ])

  const tier1aIntents: OverlappingIntent[] =
    tier1aRes.status === 'fulfilled'
      ? ((tier1aRes.value?.intents || []) as any[]).map(normalizeOverlappingIntent)
      : []

  const allRepoDecisionsRaw: any[] =
    projectListRes.status === 'fulfilled' ? (projectListRes.value?.decisions || []) : []

  const tier1bDecisionsRaw: any[] =
    tier1bRes.status === 'fulfilled' ? (tier1bRes.value?.decisions || []) : []

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

  const cachedIds: string[] =
    cacheRes.status === 'fulfilled' && Array.isArray(cacheRes.value?.ids) ? cacheRes.value.ids : []
  const sessionForceOverrides = new Set<string>(cachedIds)

  const evaluatorInput: EvaluatorInput = {
    tier1aIntents,
    tier1aDecisions,
    tier1bDecisions,
    activeIntentSupersedes,
    repoScopedSupersedes,
    sessionForceOverrides,
  }

  const result = evaluate(evaluatorInput)

  let enclosingSymbolName: string | undefined
  if (symbolRes.status === 'fulfilled' && symbolRes.value?.symbol?.name) {
    enclosingSymbolName = symbolRes.value.symbol.name as string
  }

  return {
    recommendation: result.recommendation,
    intents: result.intents ?? [],
    decisions: result.decisions ?? [],
    enclosingSymbolName,
  }
}

function formatBlockMessage(target: ResolvedTarget, result: CheckResult): string {
  const lines: string[] = []
  const symbol = result.enclosingSymbolName ? ` (in ${result.enclosingSymbolName})` : ''
  lines.push(
    `Pre-edit decision check: prior reasoning is attached to ${target.filePath}:${target.startLine}-${target.endLine}${symbol}.`,
  )
  for (const d of result.decisions) {
    lines.push(`  • [${d.type}] ${d.summary}`)
    if (d.rationale) lines.push(`    ${d.rationale}`)
  }
  lines.push('')
  lines.push('Override options:')
  lines.push(
    '  1) record_decision(type:"fork", supersedes:[<id>], rationale:"...") then retry the Edit.',
  )
  lines.push(
    '  2) Add `force: true` to the Edit args as a one-off escape hatch (acks the surfaced decisions for this session).',
  )
  return lines.join('\n')
}

async function main(): Promise<void> {
  if (process.env.KAWA_PRE_EDIT_CHECK === 'off') {
    process.exit(0)
  }

  const raw = readStdin()
  if (!raw) {
    process.exit(0)
  }

  let payload: HookPayload
  try {
    payload = JSON.parse(raw)
  } catch {
    process.exit(0)
  }

  const target = resolveTarget(payload)
  if (!target) {
    process.exit(0)
  }

  const sessionToken = payload.session_id || 'default'

  try {
    await connectToMuninn()
  } catch {
    // Muninn unreachable — silent. Don't block the edit on infra unavailability.
    process.exit(0)
  }

  let result: CheckResult
  try {
    result = await runCheck(target, sessionToken)
  } catch {
    disconnect()
    process.exit(0)
  }

  if (result.recommendation === 'investigate-upstream') {
    const force = payload.tool_input?.force === true
    if (force) {
      // Acknowledge the surfaced decisions for this session, then allow.
      try {
        const ids = result.decisions.map(d => d.decisionId).filter(Boolean)
        if (ids.length > 0) {
          await request('pre-edit-cache', 'add', {
            sessionToken,
            decisionIds: ids,
          })
        }
      } catch {
        /* best-effort — even if the cache add fails, we don't block */
      }
      disconnect()
      process.exit(0)
    }
    // Block: exit 2, write reason to stderr (Claude Code surfaces to user).
    const message = formatBlockMessage(target, result)
    process.stderr.write(message + '\n')
    disconnect()
    process.exit(2)
  }

  if (result.recommendation === 'review') {
    // Advisory: exit 0 + JSON on stdout. Claude Code injects this as
    // additional context for the agent.
    const out = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: formatBlockMessage(target, result),
      },
    }
    process.stdout.write(JSON.stringify(out) + '\n')
    disconnect()
    process.exit(0)
  }

  // Silent: proceed.
  disconnect()
  process.exit(0)
}

main().catch(() => process.exit(0))
