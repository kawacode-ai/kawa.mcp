/**
 * Session-scoped force-override cache (kawa.dev-doc/PRE_EDIT_DECISION_CHECK.md
 * §Phase 2 + §1).
 *
 * The third filter source in the evaluator pipeline. When the agent passes
 * `force: true` on an Edit tool call to bypass a block, Phase 3's PreToolUse
 * hook calls `pre_edit_acknowledge` — which adds the surfaced decision IDs
 * to this cache. Subsequent pre-edit fires within the same session filter
 * those IDs out.
 *
 * Module-level state: the MCP server runs as one process per agent session
 * (see `SESSION_ID` in services/muninn-ipc.ts — generated once at process
 * start). One process == one session, so a single module-level Set is the
 * cache; it dies when the process dies, which is exactly the "resets at
 * session boundaries" semantic the plan calls for.
 *
 * Persistent override across sessions is via record_decision(supersedes=...),
 * not this cache.
 */

const overrideCache: Set<string> = new Set()

/**
 * Add decision IDs to the override cache. Idempotent — duplicate adds are
 * silent dedups. Returns the count of NEW IDs added (helpful for telemetry
 * and the acknowledge tool's response).
 */
export function addOverrides(ids: readonly string[]): number {
  let added = 0
  for (const id of ids) {
    if (!overrideCache.has(id)) {
      overrideCache.add(id)
      added += 1
    }
  }
  return added
}

export function hasOverride(id: string): boolean {
  return overrideCache.has(id)
}

/**
 * Returns the cache contents as a ReadonlySet. The evaluator's
 * `sessionForceOverrides` input is typed as ReadonlySet<string>, so this
 * is the natural shape — no copy needed.
 */
export function getOverrides(): ReadonlySet<string> {
  return overrideCache
}

export function size(): number {
  return overrideCache.size
}

/** Test-only helper — clears the cache. Production code should not call this. */
export function clearOverrides(): void {
  overrideCache.clear()
}
