import assert from 'node:assert/strict'
import test from 'node:test'
import { hydrateAnnotationDocument, serializeAnnotationDocument } from './annotationDocument.js'
import { mediaLocationKey } from './mediaLocation.js'

function legacy(kind, locator, meta = {}) {
  return {
    schemaVersion: 1,
    sources: [{ id: 'src', kind, meta: { width: 1000, height: 800 } }],
    frames: [{ id: 'f', sourceId: 'src', kind, locator, meta }],
    annotations: [{ id: 'a', frameId: 'f', type: 'rect', geometry: { x: 0, y: 0, width: 1, height: 1 }, timeStamp: 99 }],
    entities: [{ id: 'e', aCards: [{ id: 'card', aObjectId: 'a', role: 'question', children: [] }] }],
    simpleNotes: [{ id: 'note', content: 'preserved' }],
  }
}

test('video migration uses exact frame time, removes frame storage and keeps refs and notes', () => {
  const input = legacy('video', { time: 12.345678 })
  const stored = serializeAnnotationDocument(input)
  assert.equal(stored.schemaVersion, 3.1)
  assert.equal('frames' in stored, false)
  assert.equal('frameId' in stored.annotations[0], false)
  assert.equal('timeStamp' in stored.annotations[0], false)
  assert.deepEqual(stored.annotations[0].locator, { start: 12.345678, end: 12.345678 + 2.55 })
  assert.deepEqual(stored.entities, input.entities)
  assert.deepEqual(stored.simpleNotes, input.simpleNotes)
  assert.equal(input.annotations[0].frameId, 'f')
  const runtime = hydrateAnnotationDocument(stored)
  assert.equal(runtime.annotations[0].locator.start, 12.345678)
  assert.equal('frames' in runtime, false)
  assert.equal('frameId' in runtime.annotations[0], false)
  assert.deepEqual(serializeAnnotationDocument(runtime), stored)
})

test('PDF migration and round trip preserve physical and book pages including Roman labels', () => {
  const stored = serializeAnnotationDocument(legacy('pdf', { physicalPage: 3 }, { bookPageLabel: 'iii' }))
  assert.deepEqual(stored.annotations[0].locator, { physicalPage: 3, bookPageLabel: 'iii' })
  const runtime = hydrateAnnotationDocument(stored)
  assert.equal(runtime.annotations[0].locator.bookPageLabel, 'iii')
  assert.deepEqual(serializeAnnotationDocument(runtime), stored)
})

test('image needs no frame location and legacy without version remains readable', () => {
  const data = legacy('image', {})
  delete data.schemaVersion
  const stored = serializeAnnotationDocument(data)
  assert.deepEqual(stored.annotations[0].locator, {})
  assert.equal('frames' in hydrateAnnotationDocument(stored), false)
})

test('A objects sharing the same video picture use one cache key without a Frame', () => {
  const stored = serializeAnnotationDocument(legacy('video', { time: 0 }))
  stored.annotations.push({ ...stored.annotations[0], id: 'a2' })
  const runtime = hydrateAnnotationDocument(stored)
  assert.equal('frames' in runtime, false)
  assert.equal(mediaLocationKey(runtime.sources[0], runtime.annotations[0].locator),
    mediaLocationKey(runtime.sources[0], runtime.annotations[1].locator))
})

test('new bindings override stale persisted locators on save', () => {
  const runtime = hydrateAnnotationDocument(serializeAnnotationDocument(legacy('video', { time: 1 })))
  runtime.annotations[0].locator = { start: 8, end: 12 }
  assert.deepEqual(serializeAnnotationDocument(runtime).annotations[0].locator, { start: 8, end: 12 })
})

test('legacy notes with regenerated sole-source IDs retain their exact frame target', () => {
  const data = legacy('video', { time: 4.56 })
  data.frames[0].sourceId = 'previous-session-source'
  assert.equal(hydrateAnnotationDocument(data).annotations[0].sourceId, 'src')
  const stored = serializeAnnotationDocument(data)
  assert.equal(stored.annotations[0].sourceId, 'src')
  assert.equal(stored.annotations[0].locator.start, 4.56)
})

test('invalid or unknown formats fail instead of inventing a page or overwriting', () => {
  assert.throws(() => hydrateAnnotationDocument({ schemaVersion: 4 }), /unsupported/)
  assert.throws(() => hydrateAnnotationDocument({ schemaVersion: 3.2 }), /unsupported/)
  assert.throws(() => hydrateAnnotationDocument({ schemaVersion: '3.1' }), /unsupported/)
  assert.throws(() => hydrateAnnotationDocument({ schemaVersion: '2' }), /unsupported/)
  const data = legacy('pdf', {})
  assert.throws(() => serializeAnnotationDocument(data), /pdf-page-unavailable/)
  const v2 = serializeAnnotationDocument(legacy('video', { time: 1 }))
  delete v2.annotations[0].sourceId
  assert.throws(() => hydrateAnnotationDocument(v2), /invalid-annotation-locator/)
})

test('v2 and v3 migrate time to a default interval without mutating source data', () => {
  for (const schemaVersion of [2, 3]) {
    const data = {
      schemaVersion,
      sources: [{ id: 's', kind: 'video', meta: { duration: 10 } }],
      annotations: [{ id: 'a', sourceId: 's', locator: { time: 9 }, comment: 'keep me' }],
      entities: [{ id: 'e', aObjectIds: ['a'] }],
    }
    const copy = structuredClone(data)
    const result = hydrateAnnotationDocument(data)
    assert.equal(result.schemaVersion, 3.1)
    assert.deepEqual(result.annotations[0].locator, { start: 9, end: 10 })
    assert.equal(result.annotations[0].comment, 'keep me')
    assert.deepEqual(result.entities, data.entities)
    assert.deepEqual(data, copy)
  }
})

test('v3.1 round trip retains exact interval, geometry, attributes and references', () => {
  const data = {
    schemaVersion: 3.1,
    sources: [{ id: 's', kind: 'video' }],
    annotations: [{
      id: 'a', sourceId: 's', locator: { start: 1.23456789, end: 55.67890123 },
      type: 'rect', geometry: { x: 0, y: 0, width: 1, height: 1 },
      defaultRole: null, comment: 'old Better Content',
    }],
    entities: [{ id: 'e', aObjectIds: ['a'], aObjectRefs: [{ aObjectId: 'a', comment: 'reference comment' }] }],
    simpleNotes: [{ start: 1, end: 3, content: 'independent SimpleNote' }], collections: [],
  }
  const stored = serializeAnnotationDocument(data)
  assert.deepEqual(hydrateAnnotationDocument(JSON.parse(JSON.stringify(stored))), data)
  assert.equal('time' in stored.annotations[0].locator, false)
})

test('v3.1 requires start, validates provided end and defaults only missing end', () => {
  const data = { schemaVersion: 3.1, sources: [{ id: 's', kind: 'video' }], annotations: [] }
  const load = (locator) => hydrateAnnotationDocument({
    ...data, annotations: [{ id: 'a', sourceId: 's', locator }],
  })
  for (const locator of [{ time: 2 }, { start: '2' }, { start: null }, { start: -1 }]) {
    assert.throws(() => load(locator), /invalid-video-locator-start:a/)
  }
  for (const end of [null, '3', 1, Infinity]) {
    assert.throws(() => load({ start: 2, end }), /invalid-video-locator-end:a/)
  }
  assert.deepEqual(load({ start: 2 }).annotations[0].locator, { start: 2, end: 4.55 })
  assert.deepEqual(load({ start: 2, end: 2, time: 99 }).annotations[0].locator, { start: 2, end: 2 })
})
