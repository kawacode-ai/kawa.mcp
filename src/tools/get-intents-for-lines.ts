import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'
import { resolveOrigin } from './resolve-origin.js'

export const getIntentsForLinesSchema = z.object({
  repoOrigin: z.string().optional().describe('Git remote origin URL. Auto-detected from repoPath via git if not provided.'),
  repoPath: z.string().describe('Local path to the repository root'),
  filePath: z.string().describe('Path to the file (relative to repo root)'),
  startLine: z.number().min(1).describe('Start line number (1-based)'),
  endLine: z.number().min(1).describe('End line number (1-based, inclusive)')
})

export type GetIntentsForLinesInput = z.infer<typeof getIntentsForLinesSchema>

export interface LineRangeIntent {
  intentId: string
  title: string
  author?: string
  status: string
  description: string
  branch: string
  forkedFrom?: string
  overlappingLines: {
    blockStartLine: number
    blockEndLine: number
    overlapStart: number
    overlapEnd: number
  }
}

export interface GetIntentsForLinesResponse {
  filePath: string
  queryRange: { startLine: number; endLine: number }
  intents: LineRangeIntent[]
  hasOverlap: boolean
  warning?: string
}

export async function getIntentsForLines(input: GetIntentsForLinesInput): Promise<GetIntentsForLinesResponse> {
  const actualOrigin = resolveOrigin(input.repoOrigin, input.repoPath)

  const res = await request('intent-block', 'get-for-lines', {
    repoOrigin: actualOrigin,
    filePath: input.filePath,
    startLine: input.startLine,
    endLine: input.endLine,
  })

  const overlappingIntents: LineRangeIntent[] = (res.intents || []).map((intent: any) => ({
    intentId: intent.cloud_id || intent.cloudId || intent.intent_id || intent.intentId || intent.id || '',
    title: intent.title || 'Unknown Intent',
    author: intent.author || intent.author_name || intent.authorName,
    status: intent.status || 'active',
    description: intent.description || '',
    branch: intent.branch || '',
    forkedFrom: intent.forked_from || intent.forkedFrom,
    overlappingLines: {
      blockStartLine: intent.block_start_line || intent.overlappingLines?.blockStartLine || 0,
      blockEndLine: intent.block_end_line || intent.overlappingLines?.blockEndLine || 0,
      overlapStart: intent.overlap_start || intent.overlappingLines?.overlapStart || 0,
      overlapEnd: intent.overlap_end || intent.overlappingLines?.overlapEnd || 0,
    }
  }))

  const hasOverlap = overlappingIntents.length > 0
  let warning: string | undefined

  if (hasOverlap) {
    const activeIntents = overlappingIntents.filter(i => i.status === 'active')
    if (activeIntents.length > 0) {
      const authors = [...new Set(activeIntents.map(i => i.author).filter(Boolean))]
      warning = `Lines ${input.startLine}-${input.endLine} overlap with active work by: ${authors.join(', ') || 'team members'}`
    }
  }

  return {
    filePath: input.filePath,
    queryRange: { startLine: input.startLine, endLine: input.endLine },
    intents: overlappingIntents,
    hasOverlap,
    warning
  }
}

export const getIntentsForLinesTool = {
  name: 'get_intents_for_lines',
  description: `Get intents covering a specific line range.

Use this before modifying specific lines to check for conflicts:
- Warns if the lines overlap with another team member's active intent
- Shows the exact overlap range
- Helps avoid merge conflicts and duplicate work

Returns overlap details so you can work around or coordinate with team members.`,
  inputSchema: getIntentsForLinesSchema,
  handler: getIntentsForLines
}
