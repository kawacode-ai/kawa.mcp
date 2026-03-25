import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'

export const evolveDecisionsSchema = z.object({
  stories: z.array(z.any()).describe('Array of story objects from a previous infer_history run'),
  model: z.string().optional().default('claude-haiku-4-5-20251001').describe('Anthropic model for edge classification (default: claude-haiku-4-5-20251001, cheaper model recommended)'),
  repoPath: z.string().optional().describe('Local path to the repository root (required for auto-persist after evolution)'),
  repoOrigin: z.string().optional().describe('Git remote origin URL (auto-detected from repoPath if not provided)'),
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
  })

  return {
    started: res.started,
    message: res.message || 'Evolution pipeline started. Progress updates will be sent as the pipeline runs.'
  }
}

export const evolveDecisionsTool = {
  name: 'evolve_decisions',
  description: `Build a decision evolution graph from previously extracted stories.

This analyzes how decisions relate across stories over time:
1. **Bucketing**: Groups stories by file overlap and keyword similarity (Union-Find)
2. **Edge classification**: Uses LLM to identify relationships between decisions in each bucket:
   - supersedes: Later decision replaces earlier (earlier is outdated)
   - reinforces: Later decision confirms earlier still holds
   - contradicts: Later decision reverses earlier
   - specializes: Later decision adds specificity (both remain valid)
3. **Annotation**: Labels each decision as stable, orphan, evolved, or abandoned
4. **Curation**: Keeps stable + orphan decisions, drops evolved + abandoned

Note: \`infer_history\` already chains evolve + persist automatically. Use this tool only if you want to run evolution separately on a pre-existing set of stories.

If \`repoPath\` is provided, curated stories are automatically persisted as intents with decisions after evolution completes.

The pipeline runs asynchronously — returns immediately. Uses a cheaper model (haiku) by default since edge classification requires less reasoning than story analysis.`,
  inputSchema: evolveDecisionsSchema,
  handler: evolveDecisions
}
