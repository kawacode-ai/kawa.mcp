import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'
import { resolveOrigin } from './resolve-origin.js'

export const logWorkSchema = z.object({
  repoOrigin: z.string().optional().describe('Git remote origin URL. Auto-detected from repoPath via git if not provided.'),
  repoPath: z.string().describe('Local path to repository root'),
  title: z.string().max(200).describe('Short description of the work done'),
  files: z.array(z.string()).optional().describe('File paths modified (relative to repo root)')
})

export type LogWorkInput = z.infer<typeof logWorkSchema>

export interface LogWorkResponse {
  success: boolean
  intentId: string
  message: string
}

export async function logWork(input: LogWorkInput): Promise<LogWorkResponse> {
  const origin = resolveOrigin(input.repoOrigin, input.repoPath)

  const res = await request('intent', 'log-work', {
    repoOrigin: origin,
    title: input.title,
    files: input.files || [],
  })

  const intentId = res.intentId || ''

  return {
    success: res.success !== false,
    intentId,
    message: `Logged: "${input.title}"`
  }
}

export const logWorkTool = {
  name: 'log_work',
  description: 'Lightweight single-call tool to log completed work without the full intent lifecycle. Use for quick fixes, doc updates, config changes — any task where create/assign/complete is overhead. Creates a completed intent record in one call. Does NOT set an active intent.',
  inputSchema: logWorkSchema,
  handler: logWork
}
