import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'
import { resolveOrigin } from './resolve-origin.js'

export const detectIntentConflictsSchema = z.object({
  repoOrigin: z.string().optional().describe('Git remote origin URL. Auto-detected from repoPath via git if not provided.'),
  repoPath: z.string().describe('Local path to the repository root'),
  intentId: z.string().describe('The active intent ID (cloud_id or local UUID)'),
  minScore: z.number().optional().describe('Minimum similarity score threshold (default: 0.5)'),
})

export type DetectIntentConflictsInput = z.infer<typeof detectIntentConflictsSchema>

export interface ConflictCandidate {
  intentId: string
  title: string
  description: string
  author: string
  authorId: string
  score: number
  overlappingFiles: string[]
  decisions: {
    decisionId: string
    summary: string
    rationale: string
    type: string
    relatedFiles: string[]
  }[]
}

export interface DetectIntentConflictsResponse {
  hasConflicts: boolean
  conflicts: ConflictCandidate[]
  count: number
}

export async function detectIntentConflicts(input: DetectIntentConflictsInput): Promise<DetectIntentConflictsResponse> {
  const actualOrigin = resolveOrigin(input.repoOrigin, input.repoPath)
  const res = await request('decision', 'detect-conflicts', {
    repoOrigin: actualOrigin,
    intentId: input.intentId,
    minScore: input.minScore,
  })

  if (res.error) {
    return {
      hasConflicts: false,
      conflicts: [],
      count: 0,
    }
  }

  const conflicts: ConflictCandidate[] = (res.conflicts || []).map((c: any) => ({
    intentId: c.intentId || '',
    title: c.title || '',
    description: c.description || '',
    author: c.author || '',
    authorId: c.authorId || '',
    score: c.score || 0,
    overlappingFiles: c.overlappingFiles || [],
    decisions: (c.decisions || []).map((d: any) => ({
      decisionId: d.decisionId || '',
      summary: d.summary || '',
      rationale: d.rationale || '',
      type: d.type || '',
      relatedFiles: d.relatedFiles || [],
    })),
  }))

  return {
    hasConflicts: conflicts.length > 0,
    conflicts,
    count: conflicts.length,
  }
}

export const detectIntentConflictsTool = {
  name: 'detect_intent_conflicts',
  description: `Detect intents from team members that potentially conflict with your active intent.

Uses server-side embedding similarity search to find other team members' intents
that overlap with yours in scope, files, or architectural decisions.

Call this before committing to check for potential conflicts.

Returns scored conflict candidates with:
- score: Similarity score (higher = more likely conflict)
- overlappingFiles: Files affected by both intents
- decisions: Architectural decisions attached to the conflicting intent
- author: Who is working on the conflicting intent

The conflict list is informational — review the candidates and their decisions
to determine if coordination is needed.`,
  inputSchema: detectIntentConflictsSchema,
  handler: detectIntentConflicts
}
