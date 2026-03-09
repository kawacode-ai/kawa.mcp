import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'
import { resolveOrigin } from './resolve-origin.js'

export const getIntentChangesSchema = z.object({
  repoOrigin: z.string().optional().describe('Git remote origin URL. Auto-detected from repoPath via git if not provided.'),
  repoPath: z.string().describe('Local path to the repository root')
})

export type GetIntentChangesInput = z.infer<typeof getIntentChangesSchema>

export interface FileChange {
  filePath: string
  status: 'modified' | 'added' | 'deleted' | 'renamed'
  staged: boolean
}

export interface IntentChangesResponse {
  hasActiveIntent: boolean
  intent?: {
    id: string
    title: string
    description: string
    status: string
    createdAt?: string
  }
  changes: {
    modified: FileChange[]
    untracked: string[]
    totalFiles: number
  }
  warnings: string[]
}

export async function getIntentChanges(input: GetIntentChangesInput): Promise<IntentChangesResponse> {
  const actualOrigin = resolveOrigin(input.repoOrigin, input.repoPath)

  const res = await request('intent', 'get-changes', {
    repoOrigin: actualOrigin,
    repoPath: input.repoPath,
  })

  const modified: FileChange[] = (res.changes?.modified || res.modified || []).map((f: any) => ({
    filePath: f.filePath || f,
    status: f.status || 'modified',
    staged: f.staged || false,
  }))

  const untracked: string[] = res.changes?.untracked || res.untracked || []
  const warnings: string[] = res.warnings || []

  const hasActiveIntent = res.hasActiveIntent !== undefined
    ? res.hasActiveIntent
    : !!res.intent

  if (!hasActiveIntent && (modified.length > 0 || untracked.length > 0)) {
    warnings.push('Changes detected but no active intent. Consider creating an intent first.')
  }

  return {
    hasActiveIntent,
    intent: res.intent ? {
      id: res.intent.id || res.intent._id || '',
      title: res.intent.title || '',
      description: res.intent.description || '',
      status: res.intent.status || 'active',
      createdAt: res.intent.created_at || res.intent.createdAt
    } : undefined,
    changes: {
      modified,
      untracked,
      totalFiles: modified.length + untracked.length
    },
    warnings
  }
}

export const getIntentChangesTool = {
  name: 'get_intent_changes',
  description: `Get uncommitted changes in the repository along with the active intent info.

Use this tool before prompting the user about committing to show:
- The active intent title and description
- Number of modified, added, and untracked files
- Any warnings (e.g., pre-existing changes from before intent activation)

This helps you construct an informative commit prompt like:
"You have uncommitted work on '[intent title]' (N files changed)..."`,
  inputSchema: getIntentChangesSchema,
  handler: getIntentChanges
}
