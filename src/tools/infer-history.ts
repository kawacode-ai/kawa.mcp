import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'

export const inferHistorySchema = z.object({
  repoPath: z.string().describe('Local path to the repository root'),
  commits: z.number().optional().describe('Number of recent commits to analyze. If omitted, the server resumes from the last commit infer_history processed for this repo (or falls back to 50 on first run).'),
  contextIssues: z.boolean().optional().default(false).describe('Include context issues from commit date range (requires gh/glab CLI)'),
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
  // Only forward `commits` when the caller explicitly provided one, so the
  // server can fall back to last_inferred_sha tracking otherwise.
  const inferencePayload: Record<string, any> = {
    repoPath: input.repoPath,
    contextIssues: input.contextIssues,
    model: input.model,
  }
  if (input.commits !== undefined) inferencePayload.commits = input.commits

  if (input.estimateOnly) {
    const res = await request('inference', 'estimate', inferencePayload)

    let forgeWarning = ''
    if (!res.forge_cli_available) {
      const forge = res.forge ?? 'Unknown'
      if (forge === 'Unknown') {
        forgeWarning = '\n⚠ Unrecognized git hosting platform. PR/MR descriptions and issue discussions will be skipped.'
      } else if (forge === 'GitHub') {
        forgeWarning = '\n⚠ GitHub CLI (gh) not found or not authenticated. PR descriptions and issue discussions will be skipped. Run `gh auth login` to include them.'
      } else if (forge === 'GitLab') {
        forgeWarning = '\n⚠ GitLab CLI (glab) not found or not authenticated. MR descriptions and issue discussions will be skipped. Run `glab auth login` to include them.'
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

  const runPayload: Record<string, any> = {
    repoPath: input.repoPath,
    contextIssues: input.contextIssues,
    model: input.model,
    maxStories: input.maxStories,
    allowCommitSplitting: input.allowCommitSplitting,
  }
  if (input.commits !== undefined) runPayload.commits = input.commits

  const res = await request('inference', 'run', runPayload)

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

Extraction includes: git log, file diffs, code annotations, revert detection, and optionally PR/MR descriptions + issue discussions (requires gh or glab CLI, auto-skipped if unavailable).

Supports GitHub (gh CLI) and GitLab (glab CLI). Forge is auto-detected from the remote origin.`,
  inputSchema: inferHistorySchema,
  handler: inferHistory
}
