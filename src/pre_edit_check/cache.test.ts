import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  addOverrides,
  hasOverride,
  getOverrides,
  clearOverrides,
  size,
} from './cache.js'

describe('overrideCache', () => {
  beforeEach(() => {
    clearOverrides()
  })

  test('starts empty', () => {
    assert.equal(size(), 0)
    assert.equal(hasOverride('anything'), false)
    assert.equal(getOverrides().size, 0)
  })

  test('addOverrides records new IDs and returns the count added', () => {
    const added = addOverrides(['d1', 'd2', 'd3'])
    assert.equal(added, 3)
    assert.equal(size(), 3)
    assert.equal(hasOverride('d1'), true)
    assert.equal(hasOverride('d2'), true)
    assert.equal(hasOverride('d3'), true)
    assert.equal(hasOverride('d4'), false)
  })

  test('addOverrides dedups idempotently', () => {
    addOverrides(['d1', 'd2'])
    const added = addOverrides(['d1', 'd2', 'd3'])
    assert.equal(added, 1) // only d3 is new
    assert.equal(size(), 3)
  })

  test('repeat add of identical set returns 0', () => {
    addOverrides(['d1', 'd2'])
    const added = addOverrides(['d1', 'd2'])
    assert.equal(added, 0)
    assert.equal(size(), 2)
  })

  test('addOverrides on empty input is a no-op', () => {
    addOverrides(['d1'])
    const added = addOverrides([])
    assert.equal(added, 0)
    assert.equal(size(), 1)
  })

  test('getOverrides reflects current contents', () => {
    addOverrides(['d1', 'd2'])
    const view = getOverrides()
    assert.equal(view.size, 2)
    assert.equal(view.has('d1'), true)
    assert.equal(view.has('d2'), true)
  })

  test('getOverrides returns a live view (reflects subsequent adds)', () => {
    const view = getOverrides()
    addOverrides(['d1'])
    // Same object, now non-empty — evaluator reads a fresh view per call,
    // so this matches the production usage pattern.
    assert.equal(view.has('d1'), true)
  })

  test('clearOverrides empties the cache', () => {
    addOverrides(['d1', 'd2'])
    clearOverrides()
    assert.equal(size(), 0)
    assert.equal(hasOverride('d1'), false)
  })

  test('clearOverrides is idempotent on empty cache', () => {
    clearOverrides()
    clearOverrides()
    assert.equal(size(), 0)
  })
})
