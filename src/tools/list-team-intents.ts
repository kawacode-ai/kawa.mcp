import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'
import { resolveOrigin } from './resolve-origin.js'

export const listTeamIntentsSchema = z.object({
  repoOrigin: z.string().optional().describe('Git remote origin URL. Auto-detected from repoPath via git if not provided.'),
  repoPath: z.string().describe('Local path to the repository root'),
  status: z.enum(['active', 'committed', 'pushed', 'done', 'abandoned']).optional()
    .describe('Filter by intent status')
})

export type ListTeamIntentsInput = z.infer<typeof listTeamIntentsSchema>

export interface TeamIntent {
  id: string
  title: string
  description: string
  author: string
  status: string
  templateType: string
  branch: string
  forkedFrom?: string
  fileCount: number
  updatedAt: string
}

export interface ListTeamIntentsResponse {
  intents: TeamIntent[]
  count: number
  summary: string
}

export async function listTeamIntents(input: ListTeamIntentsInput): Promise<ListTeamIntentsResponse> {
  const actualOrigin = resolveOrigin(input.repoOrigin, input.repoPath)

  const res = await request('intent', 'list', {
    repoOrigin: actualOrigin,
    status: input.status,
  })

  const intents: TeamIntent[] = (res.intents || []).map((intent: any) => ({
    id: intent.id || intent._id || '',
    title: intent.title || '',
    description: intent.description || '',
    author: intent.author || intent.author_name || intent.authorName || 'Unknown',
    status: intent.status || 'active',
    templateType: intent.template_type || intent.templateType || 'feature',
    branch: intent.branch || '',
    forkedFrom: intent.forked_from || intent.forkedFrom,
    fileCount: intent.file_count || intent.fileCount || 0,
    updatedAt: intent.updated_at || intent.updatedAt || ''
  }))

  // Filter by status if provided (in case Muninn doesn't filter)
  const filteredIntents = input.status
    ? intents.filter(i => i.status === input.status)
    : intents

  const activeCount = filteredIntents.filter(i => i.status === 'active').length
  const summary = filteredIntents.length === 0
    ? 'No intents found'
    : input.status
      ? `${filteredIntents.length} ${input.status} intent(s)`
      : `${filteredIntents.length} intent(s), ${activeCount} active`

  return {
    intents: filteredIntents,
    count: filteredIntents.length,
    summary
  }
}

export const listTeamIntentsTool = {
  name: 'list_team_intents',
  description: `List all intents from team members for this repository.

Use this to:
- See what your team is working on
- Check for potential overlapping work before starting a new task
- Review the status of various features/refactors in progress

Optionally filter by status (active, committed, pushed, done, abandoned).`,
  inputSchema: listTeamIntentsSchema,
  handler: listTeamIntents
}
