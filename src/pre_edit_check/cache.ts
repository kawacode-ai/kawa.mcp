/**
 * Session force-override cache — thin async wrappers over Muninn IPC
 * (kawa.dev-doc/PRE_EDIT_DECISION_CHECK.md §Phase 3).
 *
 * The cache itself lives in Muninn (PreEditCacheService, gated behind the
 * `pre-edit-cache` IPC domain). Both the kawa.mcp MCP server and the
 * PreToolUse hook process talk to the same Muninn instance, so either
 * caller's writes are visible to the other.
 *
 * Phase 2 originally placed this in MCP-server-process memory, which broke
 * the hook flow (a sibling process can't see in-process state). The user
 * chose Muninn-daemon-backing during Phase 3 readiness.
 *
 * `sessionToken` is opaque — callers pick their own scope. The hook uses
 * the Claude Code session_id from its payload; direct MCP callers fall
 * back to `DEFAULT_SESSION_TOKEN` (kawa.mcp's process-scoped SESSION_ID)
 * when they don't pass one in.
 */

import { request, SESSION_ID } from '../services/muninn-ipc.js'

/** Default session token for callers that don't supply one. Tied to the
 *  MCP server's process lifetime — fresh each MCP server boot. */
export const DEFAULT_SESSION_TOKEN = SESSION_ID

export async function getOverrides(sessionToken: string = DEFAULT_SESSION_TOKEN): Promise<Set<string>> {
  try {
    const res = await request('pre-edit-cache', 'get', { sessionToken })
    const ids: string[] = Array.isArray(res?.ids) ? res.ids : []
    return new Set(ids)
  } catch {
    // If Muninn is unreachable, surface fewer results rather than crashing
    // the pre-edit check — degrade gracefully (matches the Promise.allSettled
    // pattern in pre-edit-decision-check.ts).
    return new Set()
  }
}

export async function addOverrides(
  ids: string[],
  sessionToken: string = DEFAULT_SESSION_TOKEN,
): Promise<{ added: number; total: number }> {
  if (ids.length === 0) {
    const total = await size(sessionToken)
    return { added: 0, total }
  }
  const res = await request('pre-edit-cache', 'add', {
    sessionToken,
    decisionIds: ids,
  })
  return {
    added: typeof res?.added === 'number' ? res.added : 0,
    total: typeof res?.total === 'number' ? res.total : 0,
  }
}

export async function size(sessionToken: string = DEFAULT_SESSION_TOKEN): Promise<number> {
  const overrides = await getOverrides(sessionToken)
  return overrides.size
}

export async function clearOverrides(
  sessionToken: string = DEFAULT_SESSION_TOKEN,
): Promise<boolean> {
  try {
    const res = await request('pre-edit-cache', 'clear', { sessionToken })
    return Boolean(res?.cleared)
  } catch {
    return false
  }
}
