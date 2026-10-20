import assert from 'node:assert/strict'
import test from 'node:test'
import { matchesMediaLocation, mediaLocationKey, resolveMediaTarget } from './mediaLocation.js'

const source = { id: 's', kind: 'video', fileName: 'video.mp4', fingerprint: { size: 123, mtimeMs: 456 } }

test('video targets preserve exact times and reject missing location or mismatched sources', () => {
  const a = { sourceId: 's', locator: { start: 0, end: 2.55 } }
  assert.equal(resolveMediaTarget(source, a).time, 0)
  a.locator = { start: 12.345678, end: 15 }
  assert.equal(resolveMediaTarget(source, a).time, 12.345678)
  assert.equal(resolveMediaTarget(source, { ...a, sourceId: 'other' }), null)
  assert.equal(resolveMediaTarget(source, { sourceId: 's', locator: {} }), null)
})

test('cache keys share the same picture, distinguish exact times and file changes', () => {
  assert.equal(mediaLocationKey(source, { start: 1, end: 3 }), mediaLocationKey({ ...source, id: 'another-session' }, { start: 1, end: 99 }))
  assert.equal(mediaLocationKey(source, { start: 1, end: 3 }), mediaLocationKey(source, { time: 1 }))
  assert.notEqual(mediaLocationKey(source, { start: 1 }), mediaLocationKey(source, { start: 1.00001 }))
  assert.notEqual(mediaLocationKey(source, { start: 1 }), mediaLocationKey({ ...source, fingerprint: { size: 123, mtimeMs: 789 } }, { start: 1 }))
})

test('PDF matching uses physical page, independent of book labels', () => {
  const pdf = { ...source, kind: 'pdf', fileName: 'book.pdf' }
  const annotation = { sourceId: 's', locator: { physicalPage: 3, bookPageLabel: 'iii' } }
  assert.equal(resolveMediaTarget(pdf, annotation).page, 3)
  assert.equal(matchesMediaLocation(annotation, 's', { physicalPage: 3 }, 'pdf'), true)
  assert.equal(matchesMediaLocation(annotation, 's', { physicalPage: 4 }, 'pdf'), false)
  assert.equal(mediaLocationKey(pdf, annotation.locator), mediaLocationKey(pdf, { physicalPage: 3, bookPageLabel: '3' }))
})

test('video visibility can use tolerance without changing the stored locator', () => {
  const a = { sourceId: 's', locator: { start: 5, end: 100 } }
  assert.equal(matchesMediaLocation(a, 's', { start: 5.02 }, 'video', 0.1), true)
  assert.equal(matchesMediaLocation(a, 's', { start: 6 }, 'video', 0.1), false)
  assert.equal(a.locator.start, 5)
})
