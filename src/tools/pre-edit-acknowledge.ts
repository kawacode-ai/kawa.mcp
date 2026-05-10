import { z } from 'zod'

import { addOverrides } from '../pre_edit_check/cache.js'

export const preEditAcknowledgeSchema = z.object({
  decisionIds: z
    .array(z.string().min(1))
    .min(1)
    .describe('Decision IDs to acknowledge (mark as overridden for the rest of this session)'),
  sessionToken: z
    .string()
    .optional()
    .describe('Session scope for the force-override cache. Should match the sessionToken passed to pre_edit_decision_check. Defaults to the MCP server\'s SESSION_ID.'),
})

export type PreEditAcknowledgeInput = z.infer<typeof preEditAcknowledgeSchema>

export interface PreEditAcknowledgeResponse {
  acknowledged: number
  cacheSize: number
}

export async function preEditAcknowledge(
  input: PreEditAcknowledgeInput,
): Promise<PreEditAcknowledgeResponse> {
  const { added, total } = await addOverrides(input.decisionIds, input.sessionToken)
  return {
    acknowledged: added,
    cacheSize: total,
  }
}

export const preEditAcknowledgeTool = {
  name: 'pre_edit_acknowledge',
  description: `Mark decisions as consciously overridden for the rest of this session.

Phase 3's PreToolUse hook calls this when the agent passes \`force: true\` on an Edit tool call to bypass a pre_edit_decision_check block. Adds the surfaced decision IDs to an in-memory session cache; subsequent pre_edit_decision_check fires filter those IDs out so the same block doesn't re-fire.

The cache resets when the MCP server process exits (= the agent session ends). For persistent override across sessions, record a fork decision via \`record_decision(type: "fork", supersedes: [<id>])\` instead.

Returns:
- acknowledged: number of newly-added IDs (existing IDs are deduped silently)
- cacheSize: total IDs currently in the session override cache`,
  inputSchema: preEditAcknowledgeSchema,
  handler: preEditAcknowledge,
}
