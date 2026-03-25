import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'

export const inferHistorySchema = z.object({
  repoPath: z.string().describe('Local path to the repository root'),
  commits: z.number().optional().default(50).describe('Number of recent commits to analyze (default: 50)'),
  tier: z.number().optional().default(5).describe('Enrichment tier 1-5: 1=git log, 2=+PR descriptions, 3=+revert diffs, 4=+issue discussions, 5=+full diffs (default: 5)'),
  contextIssues: z.boolean().optional().default(false).describe('Include context issues from commit date range (Tier 4 only)'),
  model: z.string().optional().default('claude-sonnet-4-20250514').describe('Anthropic model to use (default: claude-sonnet-4-20250514)'),
  maxStories: z.number().optional().default(0).describe('Maximum stories to analyze in Pass 2 (0 = unlimited)'),
  allowCommitSplitting: z.boolean().optional().default(false).describe('Allow splitting a single commit into multiple stories when it contains unrelated changes (recommended for repos with messy commit history)'),
  estimateOnly: z.boolean().optional().default(false).describe('If true, only estimate token cost without running the pipeline'),
})

export type InferHistoryInput = z.infer<typeof inferHistorySchema>

export interface InferHistoryResponse {
  started?: boolean
  estimate?: {
    pass1_input: number
    pass1_output: number
    pass2_input: number
    pass2_output: number
    total_input: number
    total_output: number
    est_stories: number
    cost_usd: number
  }
  commit_count?: number
  message: string
}

export async function inferHistory(input: InferHistoryInput): Promise<InferHistoryResponse> {
  if (input.estimateOnly) {
    const res = await request('inference', 'estimate', {
      repoPath: input.repoPath,
      commits: input.commits,
      tier: input.tier,
      contextIssues: input.contextIssues,
      model: input.model,
    })

    return {
      estimate: res.estimate,
      commit_count: res.commit_count,
      message: `Estimated cost: $${res.estimate?.cost_usd ?? '?'} for ~${res.estimate?.est_stories ?? '?'} stories from ${res.commit_count ?? '?'} commits`
    }
  }

  const res = await request('inference', 'run', {
    repoPath: input.repoPath,
    commits: input.commits,
    tier: input.tier,
    contextIssues: input.contextIssues,
    model: input.model,
    maxStories: input.maxStories,
    allowCommitSplitting: input.allowCommitSplitting,
  })

  return {
    started: res.started,
    message: res.message || 'Inference pipeline started. Progress updates will be sent as the pipeline runs.'
  }
}

export const inferHistoryTool = {
  name: 'infer_history',
  description: `Analyze git commit history to extract structured development knowledge (intents and decisions).

Runs the full pipeline automatically: infer → evolve → persist.

1. **Pass 1**: Groups commits into coherent development stories with value hints
2. **Pass 2**: Deep analysis of each story to extract architectural decisions
3. **Evolution**: Curates decisions by finding relationships (supersedes, reinforces, contradicts, specializes)
4. **Persist**: Stores curated stories as intents with decisions (auto-syncs to cloud)

Use \`estimateOnly: true\` first to preview token cost before running the full pipeline.

The pipeline supports checkpointing — if interrupted, re-running resumes from where it left off.

Enrichment tiers control how much context is gathered:
- Tier 1: Git log only (fastest, cheapest)
- Tier 2: + PR descriptions and review comments
- Tier 3: + Diffs for revert commits
- Tier 4: + GitHub issue discussions with decision-level content (recommended)
- Tier 5: + Full diffs and code annotation extraction (most expensive)`,
  inputSchema: inferHistorySchema,
  handler: inferHistory
}
