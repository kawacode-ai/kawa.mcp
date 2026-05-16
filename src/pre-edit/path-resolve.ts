/**
 * Cross-platform path resolution for the PreToolUse dispatcher.
 *
 * The legacy `pre-edit-decision-check-hook.ts` and the Phase 3 thin
 * `kawacode-on-pre-edit.ts` dispatcher both inherited a Unix-only heuristic:
 *   `if (filePath.startsWith('/')) ... else \`${cwd}/${filePath}\``
 * which silently breaks on Windows where absolute paths look like
 * `C:\Users\…\file.ts` or `C:/Users/…/file.ts` and `path.sep` is `\`.
 *
 * This module re-does that resolution properly using Node's `path` module
 * and exposes it as a pure function so it can be tested against both
 * `path.posix` and `path.win32` from any host OS.
 */

import * as nodePath from 'node:path'

export interface ResolvedPaths {
  /** Absolute path for `readFileSync` etc. Native to the calling platform. */
  absolutePath: string
  /** Repo-relative path with forward-slash separators (the form decisions store). */
  relativePath: string
}

/**
 * Resolve a Claude-Code-supplied `filePath` to absolute and repo-relative
 * forms. Returns `null` when the file is outside the repo — in that case the
 * dispatcher should skip the pre-edit check (no in-repo decisions could
 * apply).
 *
 * `pathImpl` is injected for testability: pass `nodePath.posix` to verify
 * Unix-style inputs and `nodePath.win32` for Windows-style inputs from a
 * single test run on any OS. Defaults to the host's `node:path` module so
 * production callers don't have to pick.
 */
export function resolvePaths(
  cwd: string,
  filePath: string,
  pathImpl: typeof nodePath = nodePath,
): ResolvedPaths | null {
  if (!cwd || !filePath) return null

  if (pathImpl.isAbsolute(filePath)) {
    const rel = pathImpl.relative(cwd, filePath)
    // Three out-of-repo cases the pre-edit check has nothing to match:
    //   • empty — filePath equals cwd
    //   • starts with ".." — directory-traversal upward
    //   • is itself absolute — Windows cross-drive case (path.win32.relative
    //     returns the target's absolute path verbatim when there's no
    //     relative representation across drives, e.g. C:\repo → D:\other)
    if (rel === '' || rel.startsWith('..') || pathImpl.isAbsolute(rel)) return null
    return {
      absolutePath: filePath,
      relativePath: rel.split(pathImpl.sep).join('/'),
    }
  }

  // Relative input — assumed to be relative to cwd. Resolve to absolute via
  // pathImpl.resolve and normalize the relative form to forward slashes
  // (Claude Code may send a backslash-relative path on Windows).
  return {
    absolutePath: pathImpl.resolve(cwd, filePath),
    relativePath: filePath.split(pathImpl.sep).join('/'),
  }
}
