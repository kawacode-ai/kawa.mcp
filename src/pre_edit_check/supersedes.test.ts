import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { computeSupersedes, type DecisionForSupersedes } from './supersedes.js'

const dec = (
  partial: Partial<DecisionForSupersedes> & { supersedes?: string[] },
): DecisionForSupersedes => ({
  intentId: '',
  ...partial,
})

describe('computeSupersedes', () => {
  test('empty inputs → empty sets', () => {
    const { activeIntentSupersedes, repoScopedSupersedes } = computeSupersedes([], 'I1')
    assert.equal(activeIntentSupersedes.size, 0)
    assert.equal(repoScopedSupersedes.size, 0)
  })

  test('decision with no supersedes contributes nothing', () => {
    const { activeIntentSupersedes, repoScopedSupersedes } = computeSupersedes(
      [dec({ intentId: 'I1' }), dec({ intentId: '' })],
      'I1',
    )
    assert.equal(activeIntentSupersedes.size, 0)
    assert.equal(repoScopedSupersedes.size, 0)
  })

  test('active intent supersedes — flat case', () => {
    const result = computeSupersedes(
      [dec({ intentId: 'I1', supersedes: ['a', 'b'] })],
      'I1',
    )
    assert.deepEqual([...result.activeIntentSupersedes].sort(), ['a', 'b'])
    assert.equal(result.repoScopedSupersedes.size, 0)
  })

  test('repo-scoped supersedes — intentId=""', () => {
    const result = computeSupersedes(
      [dec({ intentId: '', supersedes: ['x'] })],
      'I1',
    )
    assert.equal(result.activeIntentSupersedes.size, 0)
    assert.deepEqual([...result.repoScopedSupersedes], ['x'])
  })

  test('decisions belonging to other intents are ignored (cross-intent supersedes do not leak)', () => {
    const result = computeSupersedes(
      [
        dec({ intentId: 'I1', supersedes: ['active'] }),
        dec({ intentId: 'I_other', supersedes: ['leaked'] }),
        dec({ intentId: '', supersedes: ['repo'] }),
      ],
      'I1',
    )
    assert.deepEqual([...result.activeIntentSupersedes], ['active'])
    assert.deepEqual([...result.repoScopedSupersedes], ['repo'])
    assert.equal(result.activeIntentSupersedes.has('leaked'), false)
    assert.equal(result.repoScopedSupersedes.has('leaked'), false)
  })

  test('multiple decisions union into the same set', () => {
    const result = computeSupersedes(
      [
        dec({ intentId: 'I1', supersedes: ['a', 'b'] }),
        dec({ intentId: 'I1', supersedes: ['b', 'c'] }), // dedup
      ],
      'I1',
    )
    assert.deepEqual([...result.activeIntentSupersedes].sort(), ['a', 'b', 'c'])
  })

  test('handles snake_case intent_id alias', () => {
    const result = computeSupersedes(
      [{ intent_id: 'I1', supersedes: ['a'] } as DecisionForSupersedes],
      'I1',
    )
    assert.deepEqual([...result.activeIntentSupersedes], ['a'])
  })

  test('handles intentIds[] alias (post-evolve decisions can span intents)', () => {
    const result = computeSupersedes(
      [{ intentIds: ['I1', 'other'], supersedes: ['a'] } as DecisionForSupersedes],
      'I1',
    )
    assert.deepEqual([...result.activeIntentSupersedes], ['a'])
  })

  test('empty activeIntentId — no active-intent supersedes computed', () => {
    const result = computeSupersedes(
      [
        dec({ intentId: 'I1', supersedes: ['a'] }),
        dec({ intentId: '', supersedes: ['repo'] }),
      ],
      '',
    )
    assert.equal(result.activeIntentSupersedes.size, 0)
    assert.deepEqual([...result.repoScopedSupersedes], ['repo'])
  })
})
