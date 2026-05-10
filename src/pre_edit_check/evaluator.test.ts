import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { evaluate, applyFilterPipeline } from './evaluator.js'
import type { DecisionRecord, OverlappingIntent } from './types.js'

const dec = (
  id: string,
  type: DecisionRecord['type'] = 'fork',
  intentId = 'intent-1',
): DecisionRecord => ({
  decisionId: id,
  intentId,
  summary: `decision ${id}`,
  rationale: 'because',
  type,
})

const intent = (id: string): OverlappingIntent => ({
  intentId: id,
  title: `intent ${id}`,
  blockStartLine: 100,
  blockEndLine: 110,
  overlapStart: 105,
  overlapEnd: 108,
})

const empty = new Set<string>()

describe('applyFilterPipeline', () => {
  test('passes decisions through when no filters apply', () => {
    const result = applyFilterPipeline([dec('a'), dec('b')], empty, empty, empty)
    assert.equal(result.surviving.length, 2)
    assert.deepEqual(result.diagnostic.activeIntentSupersedes, [])
    assert.deepEqual(result.diagnostic.repoScopedSupersedes, [])
    assert.deepEqual(result.diagnostic.sessionForceOverrides, [])
  })

  test('active-intent supersedes drops matching decisions', () => {
    const result = applyFilterPipeline(
      [dec('a'), dec('b')],
      new Set(['a']),
      empty,
      empty,
    )
    assert.equal(result.surviving.length, 1)
    assert.equal(result.surviving[0].decisionId, 'b')
    assert.deepEqual(result.diagnostic.activeIntentSupersedes, ['a'])
  })

  test('repo-scoped supersedes drops matching decisions independently', () => {
    const result = applyFilterPipeline(
      [dec('a'), dec('b')],
      empty,
      new Set(['b']),
      empty,
    )
    assert.equal(result.surviving.length, 1)
    assert.equal(result.surviving[0].decisionId, 'a')
    assert.deepEqual(result.diagnostic.repoScopedSupersedes, ['b'])
  })

  test('session force-overrides drops matching decisions independently', () => {
    const result = applyFilterPipeline(
      [dec('a'), dec('b')],
      empty,
      empty,
      new Set(['a', 'b']),
    )
    assert.equal(result.surviving.length, 0)
    assert.deepEqual(result.diagnostic.sessionForceOverrides, ['a', 'b'])
  })

  test('filter sources are short-circuiting in declared order', () => {
    // a is in all three sets — should attribute to activeIntentSupersedes only.
    const result = applyFilterPipeline(
      [dec('a')],
      new Set(['a']),
      new Set(['a']),
      new Set(['a']),
    )
    assert.deepEqual(result.diagnostic.activeIntentSupersedes, ['a'])
    assert.deepEqual(result.diagnostic.repoScopedSupersedes, [])
    assert.deepEqual(result.diagnostic.sessionForceOverrides, [])
  })

  test('combined filters each remove their own IDs', () => {
    const result = applyFilterPipeline(
      [dec('a'), dec('r'), dec('s'), dec('k')],
      new Set(['a']),
      new Set(['r']),
      new Set(['s']),
    )
    assert.equal(result.surviving.length, 1)
    assert.equal(result.surviving[0].decisionId, 'k')
    assert.deepEqual(result.diagnostic.activeIntentSupersedes, ['a'])
    assert.deepEqual(result.diagnostic.repoScopedSupersedes, ['r'])
    assert.deepEqual(result.diagnostic.sessionForceOverrides, ['s'])
  })
})

describe('evaluate — silent path', () => {
  test('both tiers empty → not triggered, proceed', () => {
    const out = evaluate({
      tier1aIntents: [],
      tier1aDecisions: [],
      tier1bDecisions: [],
      activeIntentSupersedes: empty,
      repoScopedSupersedes: empty,
      sessionForceOverrides: empty,
    })
    assert.equal(out.triggered, false)
    assert.equal(out.tier, null)
    assert.equal(out.recommendation, 'proceed')
    assert.equal(out.intents, undefined)
    assert.equal(out.decisions, undefined)
  })

  test('Tier 1b retrieval non-empty but fully filtered → silent', () => {
    const out = evaluate({
      tier1aIntents: [],
      tier1aDecisions: [],
      tier1bDecisions: [dec('d1', 'constraint')],
      activeIntentSupersedes: new Set(['d1']),
      repoScopedSupersedes: empty,
      sessionForceOverrides: empty,
    })
    assert.equal(out.triggered, false)
    assert.equal(out.tier, null)
    assert.equal(out.recommendation, 'proceed')
    // Diagnostic still reports what was filtered for telemetry (Phase 4).
    assert.deepEqual(out.filtered.activeIntentSupersedes, ['d1'])
  })
})

describe('evaluate — Tier 1a path', () => {
  test('Tier 1a hit short-circuits Tier 1b retrieval', () => {
    const out = evaluate({
      tier1aIntents: [intent('i1')],
      tier1aDecisions: [dec('d1', 'fork')],
      tier1bDecisions: [dec('d99', 'constraint')], // must be ignored
      activeIntentSupersedes: empty,
      repoScopedSupersedes: empty,
      sessionForceOverrides: empty,
    })
    assert.equal(out.tier, '1a')
    assert.equal(out.triggered, true)
    assert.equal(out.intents?.length, 1)
    assert.equal(out.intents?.[0].intentId, 'i1')
    assert.equal(out.decisions?.length, 1)
    assert.equal(out.decisions?.[0].decisionId, 'd1')
  })

  test('Tier 1a + constraint → investigate-upstream', () => {
    const out = evaluate({
      tier1aIntents: [intent('i1')],
      tier1aDecisions: [dec('d1', 'constraint')],
      tier1bDecisions: [],
      activeIntentSupersedes: empty,
      repoScopedSupersedes: empty,
      sessionForceOverrides: empty,
    })
    assert.equal(out.recommendation, 'investigate-upstream')
  })

  test('Tier 1a + abandoned → investigate-upstream', () => {
    const out = evaluate({
      tier1aIntents: [intent('i1')],
      tier1aDecisions: [dec('d1', 'abandoned')],
      tier1bDecisions: [],
      activeIntentSupersedes: empty,
      repoScopedSupersedes: empty,
      sessionForceOverrides: empty,
    })
    assert.equal(out.recommendation, 'investigate-upstream')
  })

  test('Tier 1a with non-block-trigger types → review', () => {
    const out = evaluate({
      tier1aIntents: [intent('i1')],
      tier1aDecisions: [dec('d1', 'fork'), dec('d2', 'discovery'), dec('d3', 'tradeoff')],
      tier1bDecisions: [],
      activeIntentSupersedes: empty,
      repoScopedSupersedes: empty,
      sessionForceOverrides: empty,
    })
    assert.equal(out.recommendation, 'review')
  })

  test('Tier 1a triggered even when all decisions are filtered (intent overlap stands)', () => {
    const out = evaluate({
      tier1aIntents: [intent('i1')],
      tier1aDecisions: [dec('d1', 'constraint')],
      tier1bDecisions: [],
      activeIntentSupersedes: new Set(['d1']),
      repoScopedSupersedes: empty,
      sessionForceOverrides: empty,
    })
    assert.equal(out.triggered, true)
    assert.equal(out.tier, '1a')
    assert.equal(out.decisions?.length, 0)
    assert.equal(out.recommendation, 'review') // constraint filtered → no upstream block
    assert.deepEqual(out.filtered.activeIntentSupersedes, ['d1'])
  })

  test('Tier 1a with mix of block-trigger + filtered constraint → still investigate-upstream if any block-trigger survives', () => {
    const out = evaluate({
      tier1aIntents: [intent('i1')],
      tier1aDecisions: [dec('d1', 'constraint'), dec('d2', 'abandoned')],
      tier1bDecisions: [],
      activeIntentSupersedes: new Set(['d1']),
      repoScopedSupersedes: empty,
      sessionForceOverrides: empty,
    })
    assert.equal(out.recommendation, 'investigate-upstream')
    assert.equal(out.decisions?.length, 1)
    assert.equal(out.decisions?.[0].decisionId, 'd2')
  })
})

describe('evaluate — Tier 1b path', () => {
  test('Tier 1b only with surviving decisions → review', () => {
    const out = evaluate({
      tier1aIntents: [],
      tier1aDecisions: [],
      tier1bDecisions: [dec('d1', 'constraint')], // even constraint stays as review (no Tier 1a)
      activeIntentSupersedes: empty,
      repoScopedSupersedes: empty,
      sessionForceOverrides: empty,
    })
    assert.equal(out.tier, '1b')
    assert.equal(out.triggered, true)
    assert.equal(out.recommendation, 'review')
    assert.equal(out.intents, undefined)
    assert.equal(out.decisions?.length, 1)
  })

  test('Tier 1b with abandoned-type decision still maps to review (block trigger requires Tier 1a)', () => {
    const out = evaluate({
      tier1aIntents: [],
      tier1aDecisions: [],
      tier1bDecisions: [dec('d1', 'abandoned')],
      activeIntentSupersedes: empty,
      repoScopedSupersedes: empty,
      sessionForceOverrides: empty,
    })
    assert.equal(out.recommendation, 'review')
  })

  test('Tier 1b filter pipeline applies', () => {
    const out = evaluate({
      tier1aIntents: [],
      tier1aDecisions: [],
      tier1bDecisions: [dec('d1', 'fork'), dec('d2', 'fork')],
      activeIntentSupersedes: empty,
      repoScopedSupersedes: new Set(['d1']),
      sessionForceOverrides: empty,
    })
    assert.equal(out.tier, '1b')
    assert.equal(out.decisions?.length, 1)
    assert.equal(out.decisions?.[0].decisionId, 'd2')
    assert.deepEqual(out.filtered.repoScopedSupersedes, ['d1'])
  })
})
