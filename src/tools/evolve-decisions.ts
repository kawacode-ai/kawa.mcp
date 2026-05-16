import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'
import { forkFieldsExtensions, extractForkFields } from './_fork-fields.js'

export const evolveDecisionsSchema = z.object({
  stories: z.array(z.any()).describe('Array of story objects from a previous infer_history run'),
  model: z.string().optional().default('claude-haiku-4-5-20251001').describe('Anthropic model used for the curation pass (default: claude-haiku-4-5-20251001).'),
  repoPath: z.string().optional().describe('Local path to the repository root (required for auto-persist after evolution)'),
  repoOrigin: z.string().optional().describe('Git remote origin URL (auto-detected from repoPath if not provided)'),
  ...forkFieldsExtensions,
})

export type EvolveDecisionsInput = z.infer<typeof evolveDecisionsSchema>

export interface EvolveDecisionsResponse {
  started: boolean
  message: string
}

export async function evolveDecisions(input: EvolveDecisionsInput): Promise<EvolveDecisionsResponse> {
  const res = await request('inference', 'evolve', {
    stories: input.stories,
    model: input.model,
    repoPath: input.repoPath,
    repoOrigin: input.repoOrigin,
    ...extractForkFields(input),
  })

  return {
    started: res.started,
    message: res.message || 'Evolution pipeline started. Progress updates will be sent as the pipeline runs.'
  }
}

export const evolveDecisionsTool = {
  name: 'evolve_decisions',
  description: `Curate a set of previously extracted stories so that only the decisions still worth keeping are persisted.

When to use:
- After running \`infer_history\` in story-only mode (rare — \`infer_history\` already chains this step automatically).
- When you have a pre-existing set of stories you want to re-curate without re-running history extraction.

Inputs:
- \`stories\`: array of story objects from a previous \`infer_history\` run.
- \`repoPath\` (optional): when provided, curated results are persisted as intents and decisions for the repo after curation finishes.
- \`model\` (optional): Anthropic model used for the curation pass.

Behavior:
- Runs asynchronously — returns immediately with a started/pending status while progress is reported separately.`,
  inputSchema: evolveDecisionsSchema,
  handler: evolveDecisions
}
