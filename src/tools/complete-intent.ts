import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'
import { resolveOrigin } from './resolve-origin.js'

export const completeIntentSchema = z.object({
  repoOrigin: z.string().optional().describe('Git remote origin URL. Auto-detected from repoPath via git if not provided.'),
  repoPath: z.string().describe('Local path to the repository root'),
  commitSha: z.string().optional().describe('The git commit SHA to associate with this intent (if already committed)'),
  status: z.enum(['committed', 'pushed', 'done', 'abandoned']).default('committed')
    .describe('The new status for the intent. Use "committed" after git commit, "done" when work is complete, "abandoned" to discard.')
})

export type CompleteIntentInput = z.infer<typeof completeIntentSchema>

export interface CompleteIntentResponse {
  success: boolean
  intentId: string
  previousStatus: string
  newStatus: string
  commitSha?: string
  message: string
}

export async function completeIntent(input: CompleteIntentInput): Promise<CompleteIntentResponse> {
  const actualOrigin = resolveOrigin(input.repoOrigin, input.repoPath)

  const res = await request('intent', 'complete', {
    repoOrigin: actualOrigin,
    status: input.status,
    commitSha: input.commitSha,
  })

  const intentId = res.intentId || ''
  const intentTitle = res.intentTitle || 'Intent'
  const previousStatus = res.previousStatus || 'active'

  const statusMessages: Record<string, string> = {
    committed: `Intent "${intentTitle}" marked as committed`,
    pushed: `Intent "${intentTitle}" marked as pushed`,
    done: `Intent "${intentTitle}" marked as done`,
    abandoned: `Intent "${intentTitle}" abandoned`
  }

  return {
    success: res.success !== false,
    intentId,
    previousStatus,
    newStatus: input.status,
    commitSha: input.commitSha,
    message: statusMessages[input.status] + (input.commitSha ? ` (commit: ${input.commitSha.substring(0, 7)})` : '')
  }
}

export const completeIntentTool = {
  name: 'complete_intent',
  description: `Mark the active intent as completed and clear it.

Call this after a successful git commit to:
1. Update the intent status (committed/pushed/done/abandoned)
2. Store the commit SHA for tracking
3. Clear the active intent so a new one can be started

Status values:
- "committed": Code is committed locally (default)
- "pushed": Code has been pushed to remote
- "done": Work is fully complete
- "abandoned": Work was discarded without committing`,
  inputSchema: completeIntentSchema,
  handler: completeIntent
}
