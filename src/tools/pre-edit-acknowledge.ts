import { z } from 'zod'

import { addOverrides, size as cacheSize } from '../pre_edit_check/cache.js'

export const preEditAcknowledgeSchema = z.object({
  decisionIds: z
    .array(z.string().min(1))
    .min(1)
    .describe('Decision IDs to acknowledge (mark as overridden for the rest of this session)'),
})

export type PreEditAcknowledgeInput = z.infer<typeof preEditAcknowledgeSchema>

export interface PreEditAcknowledgeResponse {
  acknowledged: number
  cacheSize: number
}

export async function preEditAcknowledge(
  input: PreEditAcknowledgeInput,
): Promise<PreEditAcknowledgeResponse> {
  const acknowledged = addOverrides(input.decisionIds)
  return {
    acknowledged,
    cacheSize: cacheSize(),
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
