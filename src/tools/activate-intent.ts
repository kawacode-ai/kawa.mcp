import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'
import { resolveOrigin } from './resolve-origin.js'

export const activateIntentSchema = z.object({
  repoOrigin: z.string().optional().describe('Git remote origin URL. Auto-detected from repoPath via git if not provided.'),
  repoPath: z.string().describe('Local path to the repository root'),
  intentId: z.string().describe('The cloud ID (preferred) or local UUID of the existing intent to activate.'),
  force: z.boolean().optional().default(false).describe('Bypass the per-repo active-intent lock. Set to true after the user has reviewed the lock conflict and chosen to take over.'),
})

export type ActivateIntentInput = z.infer<typeof activateIntentSchema>

export interface ActiveIntentLockConflict {
  existingIntentId: string
  title?: string
  createdBy?: string
  author?: string
}

export interface ActivateIntentResponse {
  success: boolean
  intentId: string
  action?: 'activated' | 'already_active' | 'conflict'
  previousActiveId?: string
  message: string
  lockConflict?: ActiveIntentLockConflict
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
      action: 'already_active',
      previousActiveId,
      message: `Intent ${input.intentId.substring(0, 8)} is already active`,
    }
  }

  // Set the intent as active
  const setRes = await request('intent', 'set-active', {
    repoOrigin: actualOrigin,
    intentId: input.intentId,
    force: input.force || false,
  })

  if (setRes.conflict === true && setRes.conflictType === 'active_intent_lock') {
    const lockConflict = await buildLockConflictDetails(actualOrigin, setRes.existingIntentId)
    const idShort = setRes.existingIntentId.substring(0, 8)
    const who = lockConflict.author ? ` by ${lockConflict.author}` : ''
    const titlePart = lockConflict.title ? ` "${lockConflict.title}"` : ''
    return {
      success: false,
      intentId: input.intentId,
      action: 'conflict',
      lockConflict,
      message:
        `Active-intent lock: repo already owns intent ${idShort}${titlePart}${who}. ` +
        `Call activate_intent again with force=true to take over, complete_intent on ${idShort} first, ` +
        `or choose a different intent.`,
    }
  }

  return {
    success: true,
    intentId: input.intentId,
    action: 'activated',
    previousActiveId: previousActiveId || undefined,
    message: previousActiveId
      ? `Activated intent ${input.intentId.substring(0, 8)} (was: ${previousActiveId.substring(0, 8)})`
      : `Activated intent ${input.intentId.substring(0, 8)}`,
  }
}

async function buildLockConflictDetails(repoOrigin: string, existingIntentId: string): Promise<ActiveIntentLockConflict> {
  try {
    const res = await request('intent', 'get-active', { repoOrigin })
    const intent = res.intent
    if (intent && intent.id === existingIntentId) {
      return {
        existingIntentId,
        title: intent.title,
        createdBy: intent.createdBy,
        author: intent.authorInfo?.name || intent.author,
      }
    }
  } catch {
    // Fall through to ID-only response
  }
  return { existingIntentId }
}

export const activateIntentTool = {
  name: 'activate_intent',
  description: `Activate an existing intent by ID without creating a new one.

Use this to:
- Switch to a different intent found via list_team_intents or get_relevant_context
- Re-activate an intent that was deactivated (e.g., to complete it)
- Resume work on a previously created intent

Accepts both cloud IDs (from get_relevant_context / API) and local UUIDs (from list_team_intents).

Per-repo active-intent lock: if another session already has a different intent active on
this repo, the tool returns action="conflict" with lockConflict details. Present the
conflict to the user and choose one of:
- Take over: retry with force=true (displaces the other session's active intent).
- Complete first: call complete_intent on the existing intent, then retry.
- Cancel: choose a different intent or stop.`,
  inputSchema: activateIntentSchema,
  handler: activateIntent,
}
