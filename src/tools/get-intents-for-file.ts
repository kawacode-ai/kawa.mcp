import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'
import { resolveOrigin } from './resolve-origin.js'

export const getIntentsForFileSchema = z.object({
  repoOrigin: z.string().optional().describe('Git remote origin URL. Auto-detected from repoPath via git if not provided.'),
  repoPath: z.string().describe('Local path to the repository root'),
  filePath: z.string().describe('Path to the file (relative to repo root)')
})

export type GetIntentsForFileInput = z.infer<typeof getIntentsForFileSchema>

export interface FileIntentBlock {
  id: string
  startLine: number
  endLine: number
  contentSnippet: string
  intentIds: string[]
}

export interface FileIntentInfo {
  intentId: string
  title: string
  author?: string
  status: string
  description: string
  branch: string
  forkedFrom?: string
  blocks: FileIntentBlock[]
}

export interface GetIntentsForFileResponse {
  filePath: string
  intents: FileIntentInfo[]
  hasConflicts: boolean
  summary: string
}

export async function getIntentsForFile(input: GetIntentsForFileInput): Promise<GetIntentsForFileResponse> {
  const actualOrigin = resolveOrigin(input.repoOrigin, input.repoPath)

  const res = await request('intent-block', 'get-for-file', {
    repoOrigin: actualOrigin,
    filePath: input.filePath,
  })

  const intents: FileIntentInfo[] = (res.intents || []).map((intent: any) => ({
    intentId: intent.intentId || intent.id || '',
    title: intent.title || 'Unknown Intent',
    author: intent.author || intent.author_name || intent.authorName,
    status: intent.status || 'active',
    description: intent.description || '',
    branch: intent.branch || '',
    forkedFrom: intent.forked_from || intent.forkedFrom,
    blocks: (intent.blocks || []).map((b: any, i: number) => ({
      id: b.id || `block-${i}`,
      startLine: b.start_line || b.startLine || 0,
      endLine: b.end_line || b.endLine || 0,
      contentSnippet: b.content_snippet || b.contentSnippet || '',
      intentIds: b.intent_ids || b.intentIds || [intent.intent_id || intent.intentId || intent.id || '']
    }))
  }))

  const hasConflicts = intents.length > 1

  const summary = intents.length === 0
    ? 'No intents found for this file'
    : intents.length === 1
      ? `1 intent: "${intents[0].title}" (${intents[0].status})`
      : `${intents.length} intents affecting this file${hasConflicts ? ' - potential conflicts' : ''}`

  return {
    filePath: input.filePath,
    intents,
    hasConflicts,
    summary
  }
}

export const getIntentsForFileTool = {
  name: 'get_intents_for_file',
  description: `Get all intents that have code blocks in this file.

Use this before modifying a file to:
- See what work is already in progress
- Identify potential conflicts with team members
- Understand the context of existing code changes

Returns intent details including author, status, and specific line ranges.`,
  inputSchema: getIntentsForFileSchema,
  handler: getIntentsForFile
}
