/**
 * Phase 4 of the pre-edit decision check (kawa.dev-doc/PRE_EDIT_DECISION_CHECK.md
 * §Phase 4). Local-only JSONL telemetry — nothing leaves the machine.
 *
 * Per fire, both the MCP tool and the PreToolUse hook append one JSON line
 * to a daily-rotated file at `~/.kawa-code/logs/pre-edit-decision-check-YYYY-MM-DD.jsonl`.
 *
 * Retention runs once per process on first log call: deletes files older than
 * 30 days, then enforces a 100 MB cumulative cap by dropping the oldest first.
 *
 * The plan explicitly forbids sending telemetry over the wire — tuning happens
 * by the user reviewing local logs.
 *
 * Opt out with KAWA_PRE_EDIT_TELEMETRY=off.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/** Configuration constants — exposed so tests can override via `pickFilesToDelete`. */
export const MAX_AGE_DAYS = 30
export const MAX_BYTES = 100 * 1024 * 1024 // 100 MB
const FILENAME_PREFIX = 'pre-edit-decision-check-'
const FILENAME_SUFFIX = '.jsonl'

export function logsDir(): string {
  return path.join(os.homedir(), '.kawa-code', 'logs')
}

/** Format a Date as YYYY-MM-DD in the system's local timezone. */
function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function dailyLogPath(date: Date = new Date()): string {
  return path.join(logsDir(), `${FILENAME_PREFIX}${formatDate(date)}${FILENAME_SUFFIX}`)
}

/** Parse a log filename and return the Date it covers, or null if it doesn't match the pattern. */
export function parseLogFileDate(filename: string): Date | null {
  if (!filename.startsWith(FILENAME_PREFIX) || !filename.endsWith(FILENAME_SUFFIX)) {
    return null
  }
  const datePart = filename.slice(FILENAME_PREFIX.length, filename.length - FILENAME_SUFFIX.length)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null
  const d = new Date(year, month - 1, day)
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null
  }
  return d
}

export interface LogFileStat {
  filename: string
  date: Date
  size: number
}

/**
 * Pure function: given a list of log file metadata and the current time,
 * return the filenames that should be deleted to satisfy retention rules.
 *
 * Rules (applied in order):
 *  1. Delete any file whose date is more than `maxAgeDays` old.
 *  2. If the cumulative size of the survivors still exceeds `maxBytes`,
 *     delete the oldest first until under the cap.
 *
 * Stable when nothing needs deletion (returns `[]`).
 */
export function pickFilesToDelete(
  stats: readonly LogFileStat[],
  maxAgeDays: number,
  maxBytes: number,
  now: Date = new Date(),
): string[] {
  const ageCutoffMs = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000
  const toDelete: string[] = []
  const survivors: LogFileStat[] = []

  for (const s of stats) {
    if (s.date.getTime() < ageCutoffMs) {
      toDelete.push(s.filename)
    } else {
      survivors.push(s)
    }
  }

  // Sort survivors oldest-first by date, tie-break by filename for stability.
  survivors.sort((a, b) => {
    const dt = a.date.getTime() - b.date.getTime()
    if (dt !== 0) return dt
    return a.filename.localeCompare(b.filename)
  })

  let total = survivors.reduce((sum, s) => sum + s.size, 0)
  let i = 0
  while (total > maxBytes && i < survivors.length) {
    toDelete.push(survivors[i].filename)
    total -= survivors[i].size
    i += 1
  }

  return toDelete
}

function telemetryEnabled(): boolean {
  return process.env.KAWA_PRE_EDIT_TELEMETRY !== 'off'
}

/** Synchronous mkdir-p of the logs dir. Cheap and only called when writing. */
function ensureLogsDir(): boolean {
  try {
    fs.mkdirSync(logsDir(), { recursive: true })
    return true
  } catch {
    return false
  }
}

/** Append one JSON object as a single line to today's log file. Best-effort: any
 *  failure (no disk, permission denied, etc.) is swallowed — telemetry must not
 *  ever break the hot path. */
function appendJsonl(event: Record<string, unknown>): void {
  if (!telemetryEnabled()) return
  if (!ensureLogsDir()) return
  try {
    const line = JSON.stringify(event) + '\n'
    fs.appendFileSync(dailyLogPath(), line, { encoding: 'utf8' })
  } catch {
    /* swallow */
  }
  // Kick off retention sweep on first call per process.
  scheduleRetentionOnce()
}

let retentionScheduled = false
function scheduleRetentionOnce(): void {
  if (retentionScheduled) return
  retentionScheduled = true
  // Run on next tick so we don't block the calling fire path.
  setImmediate(() => {
    try {
      enforceRetention()
    } catch {
      /* swallow */
    }
  })
}

/** List log files in the logs dir, with their parsed dates and sizes.
 *  Files that don't match the naming pattern are skipped. */
function listLogFiles(): LogFileStat[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(logsDir(), { withFileTypes: true })
  } catch {
    return []
  }
  const stats: LogFileStat[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const date = parseLogFileDate(entry.name)
    if (!date) continue
    const full = path.join(logsDir(), entry.name)
    let size = 0
    try {
      size = fs.statSync(full).size
    } catch {
      continue
    }
    stats.push({ filename: entry.name, date, size })
  }
  return stats
}

/**
 * Run the retention sweep against the current logs dir. Public so callers can
 * invoke it explicitly (e.g., from tests with a non-default config), but
 * typically the lazy scheduler kicks it off on first log write.
 */
export function enforceRetention(
  maxAgeDays: number = MAX_AGE_DAYS,
  maxBytes: number = MAX_BYTES,
): void {
  const stats = listLogFiles()
  if (stats.length === 0) return
  const toDelete = pickFilesToDelete(stats, maxAgeDays, maxBytes)
  for (const filename of toDelete) {
    try {
      fs.unlinkSync(path.join(logsDir(), filename))
    } catch {
      /* swallow */
    }
  }
}

// ============================================================================
// Event shapes + log entry points
// ============================================================================

export interface FireEvent {
  /** Source process: the MCP tool ("mcp") or the PreToolUse hook ("hook"). */
  agent: 'mcp' | 'hook'
  repoPath: string
  filePath: string
  startLine: number
  endLine: number
  tier: '1a' | '1b' | null
  recommendation: 'proceed' | 'review' | 'investigate-upstream'
  enclosingSymbol?: string | null
  surfacedDecisions: Array<{ decisionId: string; type: string }>
  filtered: {
    activeIntentSupersedes: string[]
    repoScopedSupersedes: string[]
    sessionForceOverrides: string[]
  }
  /** Hook only: the exit-code-derived outcome — "block" (2), "advisory" (0+JSON), or "silent" (0). */
  hookOutcome?: 'block' | 'advisory' | 'silent'
  /** Optional Claude Code session_id when the source is the hook. */
  sessionToken?: string
}

export interface OverrideEvent {
  agent: 'mcp' | 'hook'
  kind: 'force' | 'supersede'
  sessionToken?: string
  /** Decision IDs that were acked (force) or whose new fork supersedes them. */
  decisionIds: string[]
}

/** Append a `fire` event to today's log. Best-effort. */
export function logFire(event: FireEvent): void {
  appendJsonl({
    event: 'fire',
    ts: new Date().toISOString(),
    ...event,
  })
}

/** Append an `override` event to today's log. Best-effort. */
export function logOverride(event: OverrideEvent): void {
  appendJsonl({
    event: 'override',
    ts: new Date().toISOString(),
    ...event,
  })
}
