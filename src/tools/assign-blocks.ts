import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'
import { resolveOrigin } from './resolve-origin.js'

export const assignBlocksSchema = z.object({
  repoOrigin: z.string().optional().describe('Git remote origin URL. Auto-detected from repoPath via git if not provided.'),
  repoPath: z.string().describe('Local path to the repository root'),
  intentId: z.string().describe('The intent ID to assign blocks to'),
  blocks: z.array(z.object({
    filePath: z.string().describe('Path to the file (relative to repo root)'),
    startLine: z.number().min(1).describe('Start line number (1-based)'),
    endLine: z.number().min(1).describe('End line number (1-based, inclusive)')
  })).describe('Code blocks to assign to the active intent')
})

export type AssignBlocksInput = z.infer<typeof assignBlocksSchema>

export interface AssignBlocksResponse {
  success: boolean
  assignedBlocks: number
  intentId: string
  intentTitle: string
  message: string
}

export async function assignBlocksToIntent(input: AssignBlocksInput): Promise<AssignBlocksResponse> {
  const actualOrigin = resolveOrigin(input.repoOrigin, input.repoPath)

  // Delegate all file I/O, encryption, and API sync to Muninn
  const res = await request('intent-block', 'batch-assign', {
    repoOrigin: actualOrigin,
    repoPath: input.repoPath,
    intentId: input.intentId,
    blocks: input.blocks.map(b => ({
      filePath: b.filePath,
      startLine: b.startLine,
      endLine: b.endLine,
    })),
  })

  return {
    success: res.success !== false,
    assignedBlocks: res.count || res.assignedCount || input.blocks.length,
    intentId: res.intentId || '',
    intentTitle: res.intentTitle || 'Active Intent',
    message: `Assigned ${res.count || input.blocks.length} code block(s) to active intent`
  }
}

export const assignBlocksToIntentTool = {
  name: 'assign_blocks_to_intent',
  description: `Assign code blocks to the currently active intent.

Call this AFTER writing code to track which lines were modified:
1. For each file you modified, provide the line range
2. Blocks get assigned to the active intent
3. This enables tracking, conflict detection, and team visibility

Example: After adding a function at lines 50-75 in auth.ts, call with:
{ blocks: [{ filePath: "src/auth.ts", startLine: 50, endLine: 75 }] }`,
  inputSchema: assignBlocksSchema,
  handler: assignBlocksToIntent
}
