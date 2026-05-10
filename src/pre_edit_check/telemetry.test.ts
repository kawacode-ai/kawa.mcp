import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  dailyLogPath,
  parseLogFileDate,
  pickFilesToDelete,
  logsDir,
  type LogFileStat,
} from './telemetry.js'

describe('dailyLogPath', () => {
  test('formats path with YYYY-MM-DD', () => {
    const p = dailyLogPath(new Date(2026, 4, 10)) // May 10, 2026 (month is 0-indexed)
    assert.equal(p.endsWith('/pre-edit-decision-check-2026-05-10.jsonl'), true)
    assert.equal(p.startsWith(logsDir()), true)
  })

  test('zero-pads month and day', () => {
    const p = dailyLogPath(new Date(2026, 0, 5)) // Jan 5
    assert.equal(p.endsWith('/pre-edit-decision-check-2026-01-05.jsonl'), true)
  })
})

describe('parseLogFileDate', () => {
  test('parses a well-formed filename', () => {
    const d = parseLogFileDate('pre-edit-decision-check-2026-05-10.jsonl')
    assert.notEqual(d, null)
    assert.equal(d!.getFullYear(), 2026)
    assert.equal(d!.getMonth(), 4)
    assert.equal(d!.getDate(), 10)
  })

  test('rejects files outside the naming convention', () => {
    assert.equal(parseLogFileDate('pre-edit-decision-check.jsonl'), null)
    assert.equal(parseLogFileDate('other-2026-05-10.jsonl'), null)
    assert.equal(parseLogFileDate('pre-edit-decision-check-2026-05-10.txt'), null)
    assert.equal(parseLogFileDate(''), null)
  })

  test('rejects invalid date components', () => {
    assert.equal(parseLogFileDate('pre-edit-decision-check-2026-13-01.jsonl'), null) // bad month
    assert.equal(parseLogFileDate('pre-edit-decision-check-2026-02-30.jsonl'), null) // bad day
    assert.equal(parseLogFileDate('pre-edit-decision-check-202X-05-10.jsonl'), null) // non-numeric
  })
})

describe('pickFilesToDelete', () => {
  const now = new Date(2026, 4, 10) // May 10, 2026
  const stat = (filename: string, daysAgo: number, size: number): LogFileStat => ({
    filename,
    date: new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000),
    size,
  })

  test('returns empty when nothing exceeds limits', () => {
    const out = pickFilesToDelete(
      [stat('a.jsonl', 0, 1024), stat('b.jsonl', 1, 1024)],
      30,
      100 * 1024 * 1024,
      now,
    )
    assert.deepEqual(out, [])
  })

  test('drops files older than maxAgeDays', () => {
    const out = pickFilesToDelete(
      [
        stat('old-1.jsonl', 31, 100),
        stat('old-2.jsonl', 60, 100),
        stat('keep.jsonl', 5, 100),
      ],
      30,
      100 * 1024 * 1024,
      now,
    )
    assert.deepEqual(out.sort(), ['old-1.jsonl', 'old-2.jsonl'])
  })

  test('enforces size cap by dropping oldest survivors first', () => {
    // Cap is 150 bytes; we have three 100-byte files, all in-window. Drop
    // oldest first (20d) → total=200, still over cap. Drop middle (5d) →
    // total=100, under cap. Stop.
    const out = pickFilesToDelete(
      [
        stat('young.jsonl', 0, 100),
        stat('middle.jsonl', 5, 100),
        stat('oldest.jsonl', 20, 100),
      ],
      30,
      150,
      now,
    )
    assert.deepEqual(out, ['oldest.jsonl', 'middle.jsonl'])
  })

  test('stops dropping once size cap is satisfied', () => {
    // Cap is 250 bytes; three 100-byte files = 300 total. One drop → 200 ≤ 250.
    const out = pickFilesToDelete(
      [
        stat('young.jsonl', 0, 100),
        stat('middle.jsonl', 5, 100),
        stat('oldest.jsonl', 20, 100),
      ],
      30,
      250,
      now,
    )
    assert.deepEqual(out, ['oldest.jsonl'])
  })

  test('age cutoff applied before size cap', () => {
    // 'ancient' is over age cutoff. After dropping it, total = 100, under cap. No size drop.
    const out = pickFilesToDelete(
      [stat('ancient.jsonl', 60, 100), stat('keep.jsonl', 1, 100)],
      30,
      150,
      now,
    )
    assert.deepEqual(out, ['ancient.jsonl'])
  })

  test('stable when files have same date — tie-break by filename', () => {
    // Both same date, total = 200, cap = 100. Pick by filename ascending.
    const out = pickFilesToDelete(
      [stat('z.jsonl', 5, 100), stat('a.jsonl', 5, 100)],
      30,
      100,
      now,
    )
    assert.deepEqual(out, ['a.jsonl'])
  })
})
