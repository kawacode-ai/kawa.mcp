import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'

export const inferHistorySchema = z.object({
  repoPath: z.string().describe('Local path to the repository root'),
  commits: z.number().optional().default(50).describe('Number of recent commits to analyze (default: 50)'),
  tier: z.number().optional().default(5).describe('Enrichment tier 1-5 (cumulative — each includes all lower tiers). 1=git log, 2=+PR/MR descriptions, 3=+revert diffs, 4=+issue discussions, 5=+full diffs+annotations. Default: 5. Tiers 2/4 auto-skip if gh/glab CLI unavailable.'),
  contextIssues: z.boolean().optional().default(false).describe('Include context issues from commit date range (Tier 4 only)'),
  model: z.string().optional().default('claude-sonnet-4-20250514').describe('Anthropic model to use (default: claude-sonnet-4-20250514)'),
  maxStories: z.number().optional().default(0).describe('Maximum stories to analyze in Pass 2 (0 = unlimited)'),
  allowCommitSplitting: z.boolean().optional().default(false).describe('Allow splitting a single commit into multiple stories when it contains unrelated changes (recommended for repos with messy commit history)'),
  estimateOnly: z.boolean().optional().default(true).describe('If true (default), only estimate token cost without running the pipeline. Set to false to run the full pipeline.'),
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
  forge?: string
  forge_cli_available?: boolean
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

    let forgeWarning = ''
    if (input.tier >= 2 && !res.forge_cli_available) {
      const forge = res.forge ?? 'Unknown'
      if (forge === 'Unknown') {
        forgeWarning = '\n⚠ Unrecognized git hosting platform. Tiers 2 (PR/MR descriptions) and 4 (issue discussions) will be skipped.'
      } else if (forge === 'GitHub') {
        forgeWarning = '\n⚠ GitHub CLI (gh) not found or not authenticated. Tiers 2 and 4 will be skipped. Run `gh auth login` to include PR and issue context.'
      } else if (forge === 'GitLab') {
        forgeWarning = '\n⚠ GitLab CLI (glab) not found or not authenticated. Tiers 2 and 4 will be skipped. Run `glab auth login` to include MR and issue context.'
      }
    }

    return {
      estimate: res.estimate,
      forge: res.forge,
      forge_cli_available: res.forge_cli_available,
      commit_count: res.commit_count,
      message: `Estimated cost: $${res.estimate?.cost_usd ?? '?'} for ~${res.estimate?.est_stories ?? '?'} stories from ${res.commit_count ?? '?'} commits${forgeWarning}`
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

Enrichment tiers are **cumulative** — each tier includes all data from lower tiers:
- Tier 1: Git log with file stats (always available)
- Tier 2: Tier 1 + PR/MR descriptions and review comments (requires gh or glab CLI)
- Tier 3: Tier 2 + diffs for revert commits
- Tier 4: Tier 3 + issue discussions with decision-level content (requires gh or glab CLI)
- Tier 5: Tier 4 + full diffs and code annotation extraction (default, most thorough)

Tiers 2 and 4 are automatically skipped if the forge CLI is not available — no data is lost from other tiers.

Supports GitHub (gh CLI) and GitLab (glab CLI). Forge is auto-detected from the remote origin.`,
  inputSchema: inferHistorySchema,
  handler: inferHistory
}
