import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'
import { resolveOrigin } from './resolve-origin.js'

export const checkActiveIntentSchema = z.object({
  repoOrigin: z.string().optional().describe('Git remote origin URL. Auto-detected from repoPath via git if not provided.'),
  repoPath: z.string().describe('Local path to the repository root')
})

export type CheckActiveIntentInput = z.infer<typeof checkActiveIntentSchema>

export interface IntentBlock {
  id: string
  filePath: string
  startLine: number
  endLine: number
  contentSnippet: string
}

export interface ActiveIntentResponse {
  hasActiveIntent: boolean
  intent?: {
    id: string
    title: string
    description: string
    templateType: 'feature' | 'refactor' | 'exploration'
    constraints: string[]
    status: string
    branch: string
    forkedFrom?: string
    blocks: IntentBlock[]
  }
}

export async function checkActiveIntent(input: CheckActiveIntentInput): Promise<ActiveIntentResponse> {
  const actualOrigin = resolveOrigin(input.repoOrigin, input.repoPath)

  const res = await request('intent', 'get-active', {
    repoOrigin: actualOrigin,
  })

  // Muninn returns { hasActiveIntent, intentId, intent }
  const intent = res.intent
  if (!intent) {
    return { hasActiveIntent: false }
  }

  return {
    hasActiveIntent: true,
    intent: {
      id: intent.id || res.intentId || '',
      title: intent.title || '',
      description: intent.description || '',
      templateType: (intent.templateType || 'feature') as 'feature' | 'refactor' | 'exploration',
      constraints: intent.constraints || [],
      status: intent.status || 'active',
      branch: intent.branch || '',
      forkedFrom: intent.forkedFrom,
      blocks: [] // Blocks are tracked separately by intent-block service
    }
  }
}

export const checkActiveIntentTool = {
  name: 'check_active_intent',
  description: `REQUIRED: Call this tool BEFORE writing any code.

Returns the currently active intent if one exists. If no active intent is set,
you should ask the user to confirm intent details and then call create_and_activate_intent.

An active intent tracks what the user is working on, enabling:
- Better code context for AI-generated changes
- Conflict detection with team members
- Automatic assignment of code blocks to the intent`,
  inputSchema: checkActiveIntentSchema,
  handler: checkActiveIntent
}
