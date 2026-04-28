import { z } from 'zod'
import { request } from '../services/muninn-ipc.js'

export const inferHistorySchema = z.object({
  repoPath: z.string().describe('Local path to the repository root'),
  commits: z.number().optional().describe('Number of recent commits to analyze. If omitted, the server resumes from the last commit infer_history processed for this repo (or falls back to 50 on first run).'),
  contextIssues: z.boolean().optional().default(false).describe('Include context issues from commit date range (requires gh/glab CLI)'),
  model: z.string().optional().default('claude-sonnet-4-20250514').describe('Anthropic model to use (default: claude-sonnet-4-20250514)'),
  maxStories: z.number().optional().default(0).describe('Maximum number of stories to analyze in this run (0 = unlimited).'),
  allowCommitSplitting: z.boolean().optional().default(false).describe('Allow splitting a single commit into multiple stories when it contains unrelated changes (recommended for repos with messy commit history)'),
  estimateOnly: z.boolean().optional().default(true).describe('If true (default), only estimate token cost without running the pipeline. Set to false to run the full pipeline.'),
})

export type InferHistoryInput = z.infer<typeof inferHistorySchema>

export type AutoMode =
  | 'first-run'
  | 'resume'
  | 'head-equals-last'
  | 'fallback-rewritten'
  | 'fallback-no-remote'
  | 'fallback-error'

export interface AutoModeResolution {
  commits: number
  mode: AutoMode
  lastSha?: string
}

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
  autoMode?: AutoModeResolution
  message: string
}

function describeAutoMode(am: AutoModeResolution): string {
  const sha = am.lastSha ? ` (last_inferred_sha=${am.lastSha.slice(0, 7)})` : ''
  switch (am.mode) {
    case 'first-run':
      return `\nℹ Auto-mode: first run for this repo — analyzing fallback of ${am.commits} most recent commits.`
    case 'resume':
      return `\nℹ Auto-mode: resumed${sha} — ${am.commits} commits since last run.`
    case 'head-equals-last':
      return `\nℹ Auto-mode: HEAD already matches last_inferred_sha${sha} — nothing new to analyze.`
    case 'fallback-rewritten':
      return `\n⚠ Auto-mode: stored last_inferred_sha${sha} is no longer reachable (rebase/GC/branch switch). Falling back to ${am.commits} most recent commits.`
    case 'fallback-no-remote':
      return `\n⚠ Auto-mode: no git remote 'origin' — cannot key resume state. Falling back to ${am.commits} most recent commits.`
    case 'fallback-error':
      return `\n⚠ Auto-mode: failed to resolve resume state (see Muninn logs). Falling back to ${am.commits} most recent commits.`
  }
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
    // Walking git history on deep repos (e.g., zed at 37k commits) exceeds
    // the 30s default. Estimate is synchronous — no async-start response —
    // so the caller blocks until the server returns.
    const ESTIMATE_TIMEOUT_MS = 180_000
    const res = await request('inference', 'estimate', inferencePayload, ESTIMATE_TIMEOUT_MS)

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

    const autoModeNote = res.autoMode ? describeAutoMode(res.autoMode) : ''

    return {
      estimate: res.estimate,
      forge: res.forge,
      forge_cli_available: res.forge_cli_available,
      commit_count: res.commit_count,
      autoMode: res.autoMode,
      message: `Estimated cost: $${res.estimate?.cost_usd ?? '?'} for ~${res.estimate?.est_stories ?? '?'} stories from ${res.commit_count ?? '?'} commits${autoModeNote}${forgeWarning}`
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
  const autoModeNote = res.autoMode ? describeAutoMode(res.autoMode) : ''

  return {
    started: res.started,
    autoMode: res.autoMode,
    message: (res.message || 'Inference pipeline started. Progress updates will be sent as the pipeline runs.') + autoModeNote
  }
}

export const inferHistoryTool = {
  name: 'infer_history',
  description: `Analyze a repository's git commit history and produce structured development knowledge (intents and decisions) for the repo.

When to use:
- To bootstrap a repository that has no recorded intents/decisions yet.
- To extend coverage for new commits since the last run (resumes automatically when no \`commits\` value is provided).

Inputs of note:
- \`estimateOnly\` (default true): returns a token/cost estimate without running. Call with \`estimateOnly: true\` first to preview cost, then re-call with \`estimateOnly: false\` to run.
- \`commits\` (optional): how many recent commits to analyze. Omit to resume from where the last run stopped (or fall back to a sensible default on first run).
- \`contextIssues\`: include PR/MR descriptions and issue discussions when an authenticated forge CLI (\`gh\` or \`glab\`) is available; auto-skipped otherwise.
- \`allowCommitSplitting\`: enable when commit history is messy and a single commit may cover unrelated changes.
- \`model\`, \`maxStories\`: Anthropic model and per-run cap.

Behavior:
- A run is asynchronous — returns immediately with a started/pending status; progress is reported separately.
- Results are persisted as intents and decisions for the repo on completion.
- If interrupted, re-running resumes from where it left off.
- GitHub and GitLab are supported; the forge is detected from the remote origin.`,
  inputSchema: inferHistorySchema,
  handler: inferHistory
}
