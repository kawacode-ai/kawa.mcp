import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'
import { resolveOrigin } from './resolve-origin.js'

const constraintViolationSchema = z.object({
  alternative: z.string(),
  constraint: z.string(),
  reason: z.string()
})

const decisionUpdatesSchema = z.object({
  summary: z.string().optional(),
  rationale: z.string().optional(),
  context: z.string().optional(),
  consequences: z.string().optional(),
  alternatives: z.array(z.string()).optional(),
  relatedFiles: z.array(z.string()).optional(),
  constraintsChecked: z.array(z.string()).optional(),
  constraintViolations: z.array(constraintViolationSchema).optional()
})

export const editSessionDecisionSchema = z.object({
  repoOrigin: z.string().optional().describe('Git remote origin URL. Auto-detected from repoPath via git if not provided.'),
  repoPath: z.string().describe('Local path to the repository root'),
  intentId: z.string().describe('The intent ID the decision belongs to'),
  decisionId: z.string().describe('The decision ID to edit or delete'),
  action: z.enum(['update', 'delete']).describe('Action to perform: update modifies the decision, delete removes it'),
  updates: decisionUpdatesSchema.optional().describe('Partial fields to update (only for action=update)')
})

export type EditSessionDecisionInput = z.infer<typeof editSessionDecisionSchema>

export interface EditSessionDecisionResponse {
  success: boolean
}

export async function editSessionDecision(input: EditSessionDecisionInput): Promise<EditSessionDecisionResponse> {
  const actualOrigin = resolveOrigin(input.repoOrigin, input.repoPath)
  const res = await request('decision', 'edit', {
    repoOrigin: actualOrigin,
    intentId: input.intentId,
    decisionId: input.decisionId,
    action: input.action,
    updates: input.updates,
  })

  return { success: res.success !== false }
}

export const editSessionDecisionTool = {
  name: 'edit_session_decision',
  description: `Edit or delete a decision in the current session.

Use this when reviewing decisions before commit:
- action: "update" - Modify the decision fields
- action: "delete" - Remove the decision entirely

This allows users to curate their decision history before it's persisted.`,
  inputSchema: editSessionDecisionSchema,
  handler: editSessionDecision
}
