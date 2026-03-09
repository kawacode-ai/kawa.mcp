import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'
import { resolveOrigin } from './resolve-origin.js'

export const createAndActivateIntentSchema = z.object({
  repoOrigin: z.string().optional().describe('Git remote origin URL. Auto-detected from repoPath via git if not provided.'),
  repoPath: z.string().describe('Local path to the repository root'),
  title: z.string().max(200).describe('Short, descriptive title for the intent'),
  description: z.string().max(2000).describe('What this intent accomplishes'),
  templateType: z.enum(['feature', 'refactor', 'exploration']).default('feature').describe('Type of work'),
  constraints: z.array(z.string()).optional().describe('Requirements or constraints for this work')
})

export type CreateIntentInput = z.infer<typeof createAndActivateIntentSchema>

export interface CreateIntentResponse {
  success: boolean
  intentId: string
  localId: string
  message: string
}

export async function createAndActivateIntent(input: CreateIntentInput): Promise<CreateIntentResponse> {
  const actualOrigin = resolveOrigin(input.repoOrigin, input.repoPath)

  // Step 1: Create the intent
  const createRes = await request('intent', 'create', {
    repoOrigin: actualOrigin,
    title: input.title,
    description: input.description,
    templateType: input.templateType,
    constraints: input.constraints || [],
    scope: { type: 'repo', paths: [] },
  })

  const intentId = createRes.intent?.id || createRes.intentId || ''

  // Step 2: Set it as active
  await request('intent', 'set-active', {
    repoOrigin: actualOrigin,
    intentId,
  })

  return {
    success: true,
    intentId,
    localId: intentId,
    message: `Created and activated intent: "${input.title}"`
  }
}

export const createAndActivateIntentTool = {
  name: 'create_and_activate_intent',
  description: `Create a new intent from the user's request and mark it as active.

Call this when check_active_intent returns no active intent. Before calling:
1. Summarize what the user is asking for
2. Ask the user to confirm the intent details (title, description, type)
3. Then call this tool with the confirmed details

This ensures all AI-generated code gets properly tracked and attributed.`,
  inputSchema: createAndActivateIntentSchema,
  handler: createAndActivateIntent
}
