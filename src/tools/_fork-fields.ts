/**
 * Shared Zod schema fragment for the forkAuthor + workspaceId attribution
 * fields added in REPO_FORKS_IMPLEMENTATION_PLAN_PHASE_1.md §5.
 *
 * Every MCP tool that accepts `repoOrigin` spreads `forkFieldsExtensions`
 * into its Zod input schema and forwards `extractForkFields(input)` to the
 * IPC payload. Both fields are OPTIONAL — Muninn resolves them
 * automatically from `repoPath` (fork detection + workspace registry, §4.2 +
 * §4.3). Callers only need to pass them in advanced override / testing
 * scenarios where the desktop app's auto-resolution should be bypassed.
 *
 * Keep the field shape in lockstep with:
 *   - kawa.api/src/models/intents.model.ts / decisions.model.ts
 *   - kawa.muninn/src-tauri/src/gardener/handlers/intent.rs (OutboundIdentity)
 *
 * Drift across repos will cause silent rejection (Yup validators strip
 * unknown fields on the API side) or runtime errors on the Muninn side.
 */

import { z } from 'zod'

/**
 * Fork attribution payload. Optional in its entirety; when present, all
 * three subfields are required (so the API can persist a coherent record).
 */
export const forkAuthorSchema = z
  .object({
    platform: z.enum(['github', 'gitlab']),
    user: z.string(),
    forkOrigin: z.string(),
  })
  .describe(
    'Fork attribution; usually resolved by Muninn automatically — pass only for override / testing.',
  )

export type ForkAuthor = z.infer<typeof forkAuthorSchema>

/**
 * Spread into each tool's Zod input schema. The two fields are independent —
 * a tool can accept `workspaceId` alone (override for the override target)
 * without `forkAuthor` (canonical clone) and vice versa.
 */
export const forkFieldsExtensions = {
  forkAuthor: forkAuthorSchema.optional(),
  workspaceId: z
    .string()
    .optional()
    .describe(
      'Workspace identifier; usually resolved by Muninn automatically — pass only for override / testing.',
    ),
}

/**
 * Subset of a tool input shape carrying just the §5 fields.
 *
 * Tools have many other fields; this is the narrow type the
 * `extractForkFields` helper accepts so it stays usable across all 20 tools
 * without each one importing a full input type.
 */
export interface ForkFieldsInput {
  forkAuthor?: ForkAuthor
  workspaceId?: string
}

/**
 * Pluck the §5 fields off a tool input for IPC payload forwarding.
 *
 * Returns an object suitable for spreading into the `request(...)` call:
 *
 *   await request('intent', 'create', {
 *     repoOrigin: actualOrigin,
 *     ...extractForkFields(input),
 *     ...
 *   })
 *
 * Fields are only included when defined, so canonical-clone callers don't
 * spam Muninn with explicit nulls.
 */
export function extractForkFields(input: ForkFieldsInput): ForkFieldsInput {
  const out: ForkFieldsInput = {}
  if (input.forkAuthor !== undefined) out.forkAuthor = input.forkAuthor
  if (input.workspaceId !== undefined) out.workspaceId = input.workspaceId
  return out
}
