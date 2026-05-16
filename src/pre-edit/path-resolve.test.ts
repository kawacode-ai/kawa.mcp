import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import * as nodePath from 'node:path'

import { resolvePaths } from './path-resolve.js'

const posix = nodePath.posix
const win32 = nodePath.win32

describe('resolvePaths — empty inputs', () => {
  test('null when cwd is empty', () => {
    assert.equal(resolvePaths('', '/foo/bar.ts'), null)
  })
  test('null when filePath is empty', () => {
    assert.equal(resolvePaths('/repo', ''), null)
  })
})

describe('resolvePaths — POSIX (Unix/macOS)', () => {
  test('absolute path under cwd → repo-relative + absolute preserved', () => {
    const r = resolvePaths('/repo', '/repo/src/foo.ts', posix)
    assert.deepEqual(r, {
      absolutePath: '/repo/src/foo.ts',
      relativePath: 'src/foo.ts',
    })
  })

  test('absolute path equal to cwd → null (empty relative)', () => {
    const r = resolvePaths('/repo', '/repo', posix)
    assert.equal(r, null)
  })

  test('absolute path outside cwd → null', () => {
    const r = resolvePaths('/repo', '/etc/hosts', posix)
    assert.equal(r, null)
  })

  test('relative path → cwd-resolved absolute + relative preserved', () => {
    const r = resolvePaths('/repo', 'src/foo.ts', posix)
    assert.deepEqual(r, {
      absolutePath: '/repo/src/foo.ts',
      relativePath: 'src/foo.ts',
    })
  })

  test('nested relative path', () => {
    const r = resolvePaths('/repo', 'src/a/b/c.ts', posix)
    assert.deepEqual(r, {
      absolutePath: '/repo/src/a/b/c.ts',
      relativePath: 'src/a/b/c.ts',
    })
  })
})

describe('resolvePaths — Windows', () => {
  test('absolute backslash path under cwd → forward-slash relative', () => {
    const r = resolvePaths('C:\\repo', 'C:\\repo\\src\\foo.ts', win32)
    assert.deepEqual(r, {
      absolutePath: 'C:\\repo\\src\\foo.ts',
      relativePath: 'src/foo.ts',
    })
  })

  test('absolute forward-slash path under cwd (Git Bash / mixed style) → forward-slash relative', () => {
    // Both inputs use forward slashes — common when Claude Code runs under
    // Git Bash or when tools normalize paths to forward slashes. path.win32
    // treats `C:/repo` as absolute and computes relative correctly.
    const r = resolvePaths('C:/repo', 'C:/repo/src/foo.ts', win32)
    // path.win32.relative on forward-slash inputs returns backslashes; the
    // normalize step collapses to forward slashes either way.
    assert.equal(r?.relativePath, 'src/foo.ts')
  })

  test('mixed-separator cwd vs filePath both normalize correctly', () => {
    // Realistic: cwd from process.cwd() uses backslashes; filePath from
    // Claude Code may use forward slashes.
    const r = resolvePaths('C:\\repo', 'C:/repo/src/foo.ts', win32)
    assert.equal(r?.relativePath, 'src/foo.ts')
    assert.equal(r?.absolutePath, 'C:/repo/src/foo.ts')
  })

  test('absolute path outside cwd → null', () => {
    const r = resolvePaths('C:\\repo', 'C:\\Users\\alice\\Documents\\notes.txt', win32)
    assert.equal(r, null)
  })

  test('absolute path on different drive → null', () => {
    const r = resolvePaths('C:\\repo', 'D:\\other\\file.ts', win32)
    assert.equal(r, null)
  })

  test('relative path with backslashes → forward-slash normalized', () => {
    const r = resolvePaths('C:\\repo', 'src\\foo.ts', win32)
    assert.deepEqual(r, {
      absolutePath: 'C:\\repo\\src\\foo.ts',
      relativePath: 'src/foo.ts',
    })
  })

  test('relative path with forward slashes → unchanged', () => {
    const r = resolvePaths('C:\\repo', 'src/foo.ts', win32)
    assert.equal(r?.relativePath, 'src/foo.ts')
  })

  test('UNC path under cwd → forward-slash relative', () => {
    const r = resolvePaths('\\\\server\\share\\repo', '\\\\server\\share\\repo\\src\\foo.ts', win32)
    assert.equal(r?.relativePath, 'src/foo.ts')
  })
})

describe('resolvePaths — regression guard: the legacy bug', () => {
  test('Windows absolute path no longer gets concat-with-cwd as relative', () => {
    // The legacy code did `if (filePath.startsWith('/'))` which is false for
    // `C:\…`, then `absolutePath = \`${cwd}/${filePath}\`` producing
    // `C:\repo/C:\Users\…\file.ts`. The fix detects the absolute path
    // properly and never produces that garbage.
    const r = resolvePaths('C:\\repo', 'C:\\repo\\src\\foo.ts', win32)
    assert.notEqual(r?.absolutePath, 'C:\\repo/C:\\repo\\src\\foo.ts')
    assert.equal(r?.absolutePath, 'C:\\repo\\src\\foo.ts')
  })
})
