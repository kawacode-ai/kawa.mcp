import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'
import { resolveOrigin } from './resolve-origin.js'

export const createAndActivateIntentSchema = z.object({
  repoOrigin: z.string().optional().describe('Git remote origin URL. Auto-detected from repoPath via git if not provided.'),
  repoPath: z.string().describe('Local path to the repository root'),
  title: z.string().max(200).describe('Short, descriptive title for the intent'),
  description: z.string().max(2000).describe('What this intent accomplishes'),
  templateType: z.enum(['feature', 'refactor', 'exploration']).default('feature').describe('Type of work'),
  constraints: z.array(z.string()).optional().describe('Requirements or constraints for this work'),
  force: z.boolean().optional().default(false).describe('Bypass conflict detection. Set to true after the user has reviewed detected conflicts and chosen to proceed anyway.'),
})

export type CreateIntentInput = z.infer<typeof createAndActivateIntentSchema>

interface ConflictInfo {
  intentId: string
  title: string
  author: string
  status: string
  createdBy: string
  staleness: 'fresh' | 'aging' | 'likely_stale'
  severity: 'high' | 'medium' | 'low'
  overlapType: string
  overlappingFiles: string[]
  similarityScore: number
  oppositionDetected: boolean
  oppositionDetail: string | null
}

export interface ActiveIntentLockConflict {
  existingIntentId: string
  title?: string
  createdBy?: string
  author?: string
}

/**
 * Soft-lock surfaced when a `pending` intent blocks creating a new one on
 * the same repo. PRD_AGENT_COORDINATION_LAYER_02 §6.3 — the agent must prompt
 * the user to abandon-or-finalize the pending one before proceeding.
 */
export interface PendingIntentBlocking {
  intentId: string
  title?: string
  pendingReason?: string
  lastActivityAt?: string
  distilledDecisionCount?: number
}

export interface CreateIntentResponse {
  success: boolean
  intentId: string
  action: 'created' | 'reactivated' | 'conflict' | 'lock_conflict' | 'pending_blocked'
  message: string
  conflicts?: ConflictInfo[]
  lockConflict?: ActiveIntentLockConflict
  pendingIntent?: PendingIntentBlocking
}

export async function createAndActivateIntent(input: CreateIntentInput): Promise<CreateIntentResponse> {
  const actualOrigin = resolveOrigin(input.repoOrigin, input.repoPath)

  // Step 1: Create the intent. If a sufficiently similar one already exists, the
  // server may reactivate it instead of creating a duplicate.
  const createRes = await request('intent', 'create', {
    repoOrigin: actualOrigin,
    title: input.title,
    description: input.description,
    templateType: input.templateType,
    constraints: input.constraints || [],
    scope: { type: 'repo', paths: [] },
    force: input.force || false,
  })

  // Pending-intent soft lock — surfaced before any API write per PRD §6.3.
  // The agent's job is to ask the user to dispose of the pending one before
  // proceeding. force=true bypasses this for autonomous runs.
  if (createRes.pendingIntentBlocking) {
    return buildPendingBlockedResponse(createRes.pendingIntentBlocking)
  }

  // Handle conflict detection — API returned 409 with conflict data.
  // Return the conflicts to the caller (Claude Code) so it can present
  // them to the user and optionally retry with force=true.
  if (createRes.conflict === true && createRes.conflicts) {
    const conflicts: ConflictInfo[] = createRes.conflicts
    const highCount = conflicts.filter((c: ConflictInfo) => c.severity === 'high').length
    const mediumCount = conflicts.filter((c: ConflictInfo) => c.severity === 'medium').length

    const lines: string[] = [
      `Found ${conflicts.length} potential conflict(s) with existing intents:`,
      '',
    ]
    for (const c of conflicts) {
      const badge = c.severity === 'high' ? '[HIGH]' : c.severity === 'medium' ? '[MEDIUM]' : '[LOW]'
      lines.push(`${badge} "${c.title}" by ${c.author} (${c.status}, ${c.staleness})`)
      if (c.overlappingFiles.length > 0) {
        lines.push(`  Files: ${c.overlappingFiles.join(', ')}`)
      }
      if (c.oppositionDetected) {
        lines.push(`  Semantic opposition: ${c.oppositionDetail}`)
      }
      lines.push(`  Similarity: ${(c.similarityScore * 100).toFixed(0)}%`)
      lines.push('')
    }
    lines.push('To proceed anyway, call create_and_activate_intent again with force=true.')

    return {
      success: false,
      intentId: '',
      action: 'conflict',
      message: lines.join('\n'),
      conflicts,
    }
  }

  // Propagate Muninn-side errors (e.g. not signed in, API unreachable) to the AI
  // so it can tell the user how to recover instead of silently proceeding.
  if (createRes.success === false) {
    throw new Error(createRes.error || 'Intent creation failed')
  }

  const intentId = createRes.intent?.id || createRes.intentId || ''
  if (!intentId) {
    throw new Error('Intent creation succeeded but no intent ID was returned')
  }
  const action: 'created' | 'reactivated' = createRes.action === 'reactivated' ? 'reactivated' : 'created'

  // Step 2: Set it as active.
  // The per-repo lock may reject this step even though the intent itself was created —
  // forward force to Muninn and surface the lock conflict separately from the
  // content-similarity conflict that createRes handles above.
  const setRes = await request('intent', 'set-active', {
    repoOrigin: actualOrigin,
    intentId,
    force: input.force || false,
  })

  // The set-active step has its own pending-intent soft-lock check (the lock
  // holder may have transitioned to pending between steps 1 and 2, or the
  // pre-check on create may have been skipped because the active intent was
  // not the lock holder). Surface the same shaped response.
  if (setRes.pendingIntentBlocking) {
    return buildPendingBlockedResponse(setRes.pendingIntentBlocking, intentId)
  }

  if (setRes.conflict === true && setRes.conflictType === 'active_intent_lock') {
    const lockConflict = await buildLockConflictDetails(actualOrigin, setRes.existingIntentId)
    const idShort = setRes.existingIntentId.substring(0, 8)
    const who = lockConflict.author ? ` by ${lockConflict.author}` : ''
    const titlePart = lockConflict.title ? ` "${lockConflict.title}"` : ''
    return {
      success: false,
      intentId,
      action: 'lock_conflict',
      lockConflict,
      message:
        `Intent "${input.title}" was ${action} (id: ${intentId.substring(0, 8)}), but could not be activated: ` +
        `repo already owns intent ${idShort}${titlePart}${who}. ` +
        `Retry with force=true to take over, complete_intent on ${idShort} first, or abandon this new intent.`,
    }
  }

  const message = action === 'reactivated'
    ? `Reactivated existing similar intent: "${input.title}" — resuming previous work instead of creating a duplicate.`
    : `Created and activated intent: "${input.title}"`

  return {
    success: true,
    intentId,
    action,
    message,
  }
}

function buildPendingBlockedResponse(blocker: any, intentId: string = ''): CreateIntentResponse {
  const pendingIntent: PendingIntentBlocking = {
    intentId: blocker.intentId || '',
    title: blocker.title || undefined,
    pendingReason: blocker.pendingReason || undefined,
    lastActivityAt: blocker.lastActivityAt || undefined,
    distilledDecisionCount: typeof blocker.distilledDecisionCount === 'number'
      ? blocker.distilledDecisionCount
      : undefined,
  }
  const idShort = pendingIntent.intentId ? pendingIntent.intentId.substring(0, 8) : 'pending'
  const titlePart = pendingIntent.title ? ` "${pendingIntent.title}"` : ''
  const reasonPart = pendingIntent.pendingReason ? ` (reason: ${pendingIntent.pendingReason})` : ''
  return {
    success: false,
    intentId,
    action: 'pending_blocked',
    pendingIntent,
    message:
      `Pending intent ${idShort}${titlePart}${reasonPart} exists on this repo. ` +
      `Ask the user how to proceed: ` +
      `(A) abandon it via complete_intent(intentId="${pendingIntent.intentId}", status="abandoned"), ` +
      `(C) complete and finalize it via complete_intent(intentId="${pendingIntent.intentId}", status="committed"), ` +
      `then retry. To proceed without prompting, retry with force=true.`,
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

export const createAndActivateIntentTool = {
  name: 'create_and_activate_intent',
  description: `Create a new intent from the user's request and mark it as active.

Call this when check_active_intent returns no active intent. Before calling:
1. Summarize what the user is asking for
2. Ask the user to confirm the intent details (title, description, type)
3. Then call this tool with the confirmed details

This ensures all AI-generated code gets properly tracked and attributed.

If the tool returns conflicts (action="conflict"), present the conflict
details to the user and ask whether to proceed. If yes, retry with
force=true to bypass conflict detection.

Three distinct block types exist:

- action="conflict": content-similarity conflict from intent creation (another
  team member's intent overlaps semantically or in files). Bypassed by
  force=true after the user reviews and chooses to proceed.

- action="lock_conflict": per-repo active-intent lock — another session on this
  repo already owns the active intent slot. The new intent was still created
  and can be activated later; or call complete_intent on the existing one first.
  Bypassed by force=true (takes over the active slot).

- action="pending_blocked": a "pending" intent exists on this repo (auto-finalized
  by the orphan-recovery sweeper, or blocked by conflicts at completion). Surface
  the pendingIntent details to the user and ask how to dispose of it before
  starting new work:
  (A) Abandon it: call complete_intent(intentId=..., status="abandoned").
  (C) Complete and finalize: call complete_intent(intentId=..., status="committed").
  After the user decides and the pending intent is disposed, retry create_and_activate_intent.
  In autonomous (non-interactive) sessions, retry with force=true to proceed
  without prompting — the pending intent stays pending.`,
  inputSchema: createAndActivateIntentSchema,
  handler: createAndActivateIntent
}
