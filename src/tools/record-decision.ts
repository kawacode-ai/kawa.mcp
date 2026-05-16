import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'
import { resolveOrigin } from './resolve-origin.js'
import { forkFieldsExtensions, extractForkFields } from './_fork-fields.js'

const constraintViolationSchema = z.object({
  alternative: z.string().describe('The alternative that was rejected'),
  constraint: z.string().describe('The constraint ID that was violated (e.g., "zero-knowledge")'),
  reason: z.string().describe('Why the alternative violates the constraint')
})

export const recordDecisionSchema = z.object({
  repoOrigin: z.string().optional().describe('Git remote origin URL. Auto-detected from repoPath via git if not provided.'),
  repoPath: z.string().describe('Local path to the repository root (enables offline sync)'),
  intentId: z.string().optional().default('').describe('The intent ID this decision belongs to. Omit for repo-scoped decisions (discoveries, constraints) not tied to a specific work unit'),
  type: z.enum(['fork', 'abandoned', 'discovery', 'constraint', 'tradeoff', 'dependency'])
    .describe('Type of decision: fork (chose between alternatives), abandoned (tried and rejected), discovery (found unexpected behavior), constraint (identified hard requirement), tradeoff (made explicit trade-off), dependency (selected library/tool)'),
  summary: z.string().describe('Brief summary of the decision (< 100 chars recommended)'),
  rationale: z.string().describe('Why this decision was made'),
  context: z.string().optional().describe('What we were trying to accomplish when this decision was made'),
  alternatives: z.array(z.string()).optional().describe('Other options that were considered'),
  consequences: z.string().optional().describe('Downstream implications of this decision'),
  symptom: z.string().optional().describe('Observable symptom that indicates this decision is relevant (e.g., error messages, runtime panics, unexpected behavior). Useful for discovery and constraint decisions.'),
  relatedFiles: z.array(z.string()).optional().describe('File paths affected by this decision'),
  supersedes: z.array(z.string()).optional().describe('Decision IDs that this one replaces. When a later decision supersedes an earlier one, pass the earlier decisionId(s) here so the evolve pipeline can track the lineage.'),
  constraintsChecked: z.array(z.string()).optional().describe('Which architectural constraints were verified before this decision'),
  constraintViolations: z.array(constraintViolationSchema).optional()
    .describe('Alternatives that were rejected due to constraint violations'),
  source: z.enum(['user', 'agent', 'extractor', 'infer_history']).optional().default('agent')
    .describe('Provenance: user (human-recorded), agent (AI deliberately recorded via this tool — the default), extractor (from thought-chain extraction), infer_history (from commit-history extraction). Most callers leave this as the default.'),
  confidence: z.enum(['high', 'medium', 'low']).optional()
    .describe('Self-rated confidence in the decision. Meaningful only for extractor and infer_history sources — leave null for deliberate recordings.'),
  sourceThoughtIds: z.array(z.string()).optional()
    .describe('Thought-chain entry IDs this record was extracted from. Only set by the extractor path.'),
  ...forkFieldsExtensions,
})

export type RecordDecisionInput = z.infer<typeof recordDecisionSchema>

export interface RecordDecisionResponse {
  recorded: boolean
  decisionId: string
}

export async function recordDecision(input: RecordDecisionInput): Promise<RecordDecisionResponse> {
  const origin = resolveOrigin(input.repoOrigin, input.repoPath)
  const res = await request('decision', 'record', {
    repoOrigin: origin,
    intentId: input.intentId || '',
    type: input.type,
    summary: input.summary,
    rationale: input.rationale,
    context: input.context,
    alternatives: input.alternatives || [],
    consequences: input.consequences,
    symptom: input.symptom,
    relatedFiles: input.relatedFiles || [],
    supersedes: input.supersedes || [],
    constraintsChecked: input.constraintsChecked || [],
    constraintViolations: input.constraintViolations || [],
    source: input.source,
    confidence: input.confidence,
    sourceThoughtIds: input.sourceThoughtIds || [],
    ...extractForkFields(input),
  })

  return {
    recorded: res.success !== false,
    decisionId: res.decisionId || ''
  }
}

export const recordDecisionTool = {
  name: 'record_decision',
  description: `Silently record a decision point during development.

Call this tool when you:
- Choose between multiple alternatives (type: fork)
- Try an approach that fails or is rejected (type: abandoned)
- Find unexpected behavior or limitations (type: discovery)
- Identify a hard constraint that must be respected (type: constraint)
- Make an explicit trade-off between competing concerns (type: tradeoff)
- Select an external library or dependency (type: dependency)

Decisions can be **intent-scoped** (tied to a specific work unit) or **repo-scoped** (general knowledge like discoveries and constraints). Omit intentId for repo-scoped decisions.

Decisions are accumulated silently during the session and presented for review before commit.
This creates a "reasoning changelog" that captures not just what was done, but why.

IMPORTANT: Include constraintViolations when alternatives are rejected due to architectural constraints.`,
  inputSchema: recordDecisionSchema,
  handler: recordDecision
}
