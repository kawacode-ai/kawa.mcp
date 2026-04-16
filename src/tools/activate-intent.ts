import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'
import { resolveOrigin } from './resolve-origin.js'

export const activateIntentSchema = z.object({
  repoOrigin: z.string().optional().describe('Git remote origin URL. Auto-detected from repoPath via git if not provided.'),
  repoPath: z.string().describe('Local path to the repository root'),
  intentId: z.string().describe('The cloud ID (preferred) or local UUID of the existing intent to activate.'),
})

export type ActivateIntentInput = z.infer<typeof activateIntentSchema>

export interface ActivateIntentResponse {
  success: boolean
  intentId: string
  previousActiveId?: string
  message: string
}

export async function activateIntent(input: ActivateIntentInput): Promise<ActivateIntentResponse> {
  const actualOrigin = resolveOrigin(input.repoOrigin, input.repoPath)

  // Check if there's already an active intent
  const activeRes = await request('intent', 'get-active', { repoOrigin: actualOrigin })
  const previousActiveId = activeRes.intentId || activeRes.intent?.id || ''

  if (previousActiveId === input.intentId) {
    return {
      success: true,
      intentId: input.intentId,
      previousActiveId,
      message: `Intent ${input.intentId.substring(0, 8)} is already active`,
    }
  }

  // Set the intent as active
  await request('intent', 'set-active', {
    repoOrigin: actualOrigin,
    intentId: input.intentId,
  })

  return {
    success: true,
    intentId: input.intentId,
    previousActiveId: previousActiveId || undefined,
    message: previousActiveId
      ? `Activated intent ${input.intentId.substring(0, 8)} (was: ${previousActiveId.substring(0, 8)})`
      : `Activated intent ${input.intentId.substring(0, 8)}`,
  }
}

export const activateIntentTool = {
  name: 'activate_intent',
  description: `Activate an existing intent by ID without creating a new one.

Use this to:
- Switch to a different intent found via list_team_intents or get_relevant_context
- Re-activate an intent that was deactivated (e.g., to complete it)
- Resume work on a previously created intent

Accepts both cloud IDs (from get_relevant_context / API) and local UUIDs (from list_team_intents).

If another intent is currently active, it will be replaced (not completed).
To complete the previous intent first, call complete_intent before this tool.`,
  inputSchema: activateIntentSchema,
  handler: activateIntent,
}
