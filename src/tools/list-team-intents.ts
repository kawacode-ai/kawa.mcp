import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'
import { resolveOrigin } from './resolve-origin.js'
import { forkFieldsExtensions, extractForkFields } from './_fork-fields.js'

export const listTeamIntentsSchema = z.object({
  repoOrigin: z.string().optional().describe('Git remote origin URL. Auto-detected from repoPath via git if not provided.'),
  repoPath: z.string().describe('Local path to the repository root'),
  status: z.enum(['active', 'pending', 'committed', 'pushed', 'done', 'abandoned']).optional()
    .describe('Filter by intent status. "pending" surfaces intents auto-finalized by the sweeper or blocked at completion by conflicts — these are resumable via activate_intent.'),
  author: z.string().optional().describe('Filter by author name or ID'),
  since: z.string().optional().describe('Filter intents updated after this ISO8601 date (e.g. "2026-04-01")'),
  until: z.string().optional().describe('Filter intents updated before this ISO8601 date'),
  limit: z.number().optional().default(50).describe('Maximum number of intents to return (default: 50)'),
  offset: z.number().optional().default(0).describe('Number of intents to skip for pagination (default: 0)'),
  ...forkFieldsExtensions,
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
    ...extractForkFields(input),
  })

  let intents: TeamIntent[] = (res.intents || []).map((intent: any) => ({
    id: intent.id || '',
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

  // Apply filters
  if (input.status) {
    intents = intents.filter(i => i.status === input.status)
  }
  if (input.author) {
    const authorLower = input.author.toLowerCase()
    intents = intents.filter(i => i.author.toLowerCase().includes(authorLower))
  }
  if (input.since) {
    const sinceDate = new Date(input.since)
    if (!isNaN(sinceDate.getTime())) {
      intents = intents.filter(i => new Date(i.updatedAt) >= sinceDate)
    }
  }
  if (input.until) {
    const untilDate = new Date(input.until)
    if (!isNaN(untilDate.getTime())) {
      intents = intents.filter(i => new Date(i.updatedAt) <= untilDate)
    }
  }

  const total = intents.length
  const offset = input.offset ?? 0
  const limit = input.limit ?? 50
  const paginated = intents.slice(offset, offset + limit)

  const activeCount = paginated.filter(i => i.status === 'active').length
  const summary = total === 0
    ? 'No intents found'
    : `${paginated.length} intent(s) returned (${total} total${offset > 0 ? `, offset ${offset}` : ''}), ${activeCount} active`

  return {
    intents: paginated,
    count: total,
    summary
  }
}

export const listTeamIntentsTool = {
  name: 'list_team_intents',
  description: `List intents from team members for this repository.

Use this to:
- See what your team is working on
- Check for potential overlapping work before starting a new task
- Review the status of various features/refactors in progress

Supports filtering by status, author, and date range. Paginated (default: 50 per page).`,
  inputSchema: listTeamIntentsSchema,
  handler: listTeamIntents
}
