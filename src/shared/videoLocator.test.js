import assert from 'node:assert/strict'
import test from 'node:test'
import { createVideoLocator, getVideoStart, normalizeVideoLocator, relocateVideoLocator } from './videoLocator.js'

test('new video locations default to 2.55 seconds and keep the exact picture start', () => {
  for (const start of [0, 1, 12.345678]) {
    assert.deepEqual(createVideoLocator(start), { start, end: start + 2.55 })
  }
})

test('default end stops at known media duration without changing start', () => {
  assert.deepEqual(createVideoLocator(9, 10), { start: 9, end: 10 })
  assert.deepEqual(createVideoLocator(10, 10), { start: 10, end: 10 })
  // Stale duration metadata must never move the picture or produce end < start.
  assert.deepEqual(createVideoLocator(11, 10), { start: 11, end: 11 })
  for (const duration of [null, undefined, NaN, Infinity, -1]) {
    assert.deepEqual(createVideoLocator(9, duration), { start: 9, end: 11.55 })
  }
})

test('valid saved end is retained exactly, including an intentional zero length', () => {
  const locator = { start: 1.23456789, end: 25.87654321 }
  assert.deepEqual(normalizeVideoLocator(locator, 10), locator)
  assert.deepEqual(normalizeVideoLocator({ start: 0, end: 0 }), { start: 0, end: 0 })
})

test('invalid starts and ends are rejected rather than silently repaired', () => {
  for (const start of [undefined, null, '', '1', true, [], -1, NaN, Infinity]) {
    assert.throws(() => normalizeVideoLocator({ start, end: 10 }), /invalid-video-locator-start/)
  }
  for (const end of [null, '', '2', false, [], -1, 0.5, NaN, Infinity]) {
    assert.throws(() => normalizeVideoLocator({ start: 1, end }), /invalid-video-locator-end/)
  }
})

test('read compatibility prefers start; end never determines the captured picture', () => {
  assert.equal(getVideoStart({ start: 0, end: 50, time: 99 }), 0)
  assert.equal(getVideoStart({ time: 12.345678 }), 12.345678)
  assert.equal(getVideoStart({ start: -1, time: 2 }), null)
  assert.equal(getVideoStart({ end: 50 }), null)
})

test('rebind shifts the existing interval, clamps at media end and does not mutate original', () => {
  const locator = { start: 5, end: 12 }
  assert.deepEqual(relocateVideoLocator(locator, 20, 100), { start: 20, end: 27 })
  assert.deepEqual(relocateVideoLocator(locator, 20, 25), { start: 20, end: 25 })
  assert.deepEqual(relocateVideoLocator({ time: 1 }, 3), { start: 3, end: 5.55 })
  assert.deepEqual(locator, { start: 5, end: 12 })
  const precise = { start: 1.23456789, end: 12.34567891 }
  assert.deepEqual(relocateVideoLocator(precise, precise.start), precise)
})
