import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'
import { resolveOrigin } from './resolve-origin.js'

const constraintViolationSchema = z.object({
  alternative: z.string().describe('The alternative that was rejected'),
  constraint: z.string().describe('The constraint ID that was violated'),
  reason: z.string().describe('Why the alternative violates the constraint')
})

const teamDecisionSchema = z.object({
  decision: z.object({
    id: z.string(),
    timestamp: z.string(),
    type: z.string(),
    summary: z.string(),
    rationale: z.string(),
    context: z.string().optional(),
    alternatives: z.array(z.string()).optional(),
    consequences: z.string().optional(),
    relatedFiles: z.array(z.string()).optional(),
    constraintsChecked: z.array(z.string()).optional(),
    constraintViolations: z.array(constraintViolationSchema).optional()
  }),
  intentId: z.string().describe('Intent ID this decision belongs to'),
  authorId: z.string().describe('Author user ID'),
  authorName: z.string().describe('Author display name')
})

export const detectIntentConflictsSchema = z.object({
  repoOrigin: z.string().optional().describe('Git remote origin URL. Auto-detected from repoPath via git if not provided.'),
  repoPath: z.string().describe('Local path to the repository root'),
  intentId: z.string().describe('The active intent ID'),
  teamDecisions: z.array(teamDecisionSchema).describe('Team decisions to check against')
})

export type DetectIntentConflictsInput = z.infer<typeof detectIntentConflictsSchema>

export interface ConflictInfo {
  localDecision: DecisionInfo
  remoteDecision: DecisionInfo
  remoteAuthor: string
  conflictType: 'overlapping_code' | 'contradictory_rationale' | 'constraint_mismatch'
  overlappingFiles: string[]
}

export interface DecisionInfo {
  id: string
  timestamp: string
  type: string
  summary: string
  rationale: string
  context?: string
  alternatives?: string[]
  consequences?: string
  relatedFiles?: string[]
  constraintsChecked?: string[]
  constraintViolations?: Array<{
    alternative: string
    constraint: string
    reason: string
  }>
}

export interface DetectIntentConflictsResponse {
  hasConflicts: boolean
  conflictCount: number
  hasCriticalConflicts: boolean
  conflicts: ConflictInfo[]
  overlappingFiles: string[]
}

export async function detectIntentConflicts(input: DetectIntentConflictsInput): Promise<DetectIntentConflictsResponse> {
  const actualOrigin = resolveOrigin(input.repoOrigin, input.repoPath)
  const res = await request('decision', 'detect-conflicts', {
    repoOrigin: actualOrigin,
    intentId: input.intentId,
    teamDecisions: input.teamDecisions,
  })

  const conflicts: ConflictInfo[] = (res.conflicts || []).map((c: any) => ({
    localDecision: {
      id: c.local_decision?.id || c.localDecision?.id || '',
      timestamp: c.local_decision?.timestamp || c.localDecision?.timestamp || '',
      type: c.local_decision?.type || c.localDecision?.type || '',
      summary: c.local_decision?.summary || c.localDecision?.summary || '',
      rationale: c.local_decision?.rationale || c.localDecision?.rationale || '',
      relatedFiles: c.local_decision?.related_files || c.localDecision?.relatedFiles,
    },
    remoteDecision: {
      id: c.remote_decision?.id || c.remoteDecision?.id || '',
      timestamp: c.remote_decision?.timestamp || c.remoteDecision?.timestamp || '',
      type: c.remote_decision?.type || c.remoteDecision?.type || '',
      summary: c.remote_decision?.summary || c.remoteDecision?.summary || '',
      rationale: c.remote_decision?.rationale || c.remoteDecision?.rationale || '',
      relatedFiles: c.remote_decision?.related_files || c.remoteDecision?.relatedFiles,
    },
    remoteAuthor: c.remote_author || c.remoteAuthor || '',
    conflictType: c.conflict_type || c.conflictType || 'overlapping_code',
    overlappingFiles: c.overlapping_files || c.overlappingFiles || []
  }))

  const hasCriticalConflicts = conflicts.some(c => c.conflictType === 'constraint_mismatch')

  return {
    hasConflicts: conflicts.length > 0,
    conflictCount: conflicts.length,
    hasCriticalConflicts,
    conflicts,
    overlappingFiles: res.overlapping_files || res.overlappingFiles || [...new Set(conflicts.flatMap(c => c.overlappingFiles))]
  }
}

export const detectIntentConflictsTool = {
  name: 'detect_intent_conflicts',
  description: `Detect conflicts between your local decisions and team members' decisions.

Call this before committing to check for potential conflicts.

The tool compares:
1. **Overlapping code**: Decisions affecting the same files
2. **Contradictory rationale**: Decisions with opposing reasoning
3. **Constraint mismatch**: Decisions applying different constraints

Returns:
- hasConflicts: Whether any conflicts were detected
- hasCriticalConflicts: True if constraint mismatches found (high priority)
- conflicts: List of conflict details with affected files and authors
- overlappingFiles: All files affected by both local and team decisions

Note: Team decisions must be provided (fetched from API).`,
  inputSchema: detectIntentConflictsSchema,
  handler: detectIntentConflicts
}
