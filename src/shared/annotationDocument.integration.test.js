import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadImageEditorSessionFromAnnotationResult,
  loadImageEditorSessionFromResult,
  loadPdfEditorSessionFromAnnotationResult,
  loadPdfEditorSessionFromResult,
  loadVideoEditorSessionFromAnnotationResult,
  loadVideoEditorSessionFromResult,
  saveAnnotationDocument,
} from '../renderer/ab-editor/abEditorLoader.js'
import { hydrateAnnotationDocument, serializeAnnotationDocument } from './annotationDocument.js'

function sample(kind) {
  return {
    schemaVersion: 2,
    sources: [{ id: 'saved-src', kind, meta: { width: 800, height: 600, pageCount: 10 } }],
    annotations: [{
      id: 'a', sourceId: 'saved-src', type: 'rect',
      geometry: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      locator: kind === 'pdf' ? { physicalPage: 5, bookPageLabel: 'iii' } : kind === 'video' ? { time: 2.345 } : {},
    }],
    entities: [{ id: 'b', aObjectIds: ['a'] }],
    simpleNotes: [],
    collections: [],
  }
}

test('each media loader accepts v2 with direct locations and no Frame session state', async () => {
  const loaders = {
    image: loadImageEditorSessionFromAnnotationResult,
    video: loadVideoEditorSessionFromAnnotationResult,
    pdf: loadPdfEditorSessionFromAnnotationResult,
  }
  for (const [kind, loader] of Object.entries(loaders)) {
    const stored = sample(kind)
    const session = await loader({
      ok: true,
      annotationFilePath: 'note.annotation.json',
      data: hydrateAnnotationDocument(stored),
      media: { ok: true, filePath: 'source', fileName: 'source', fileUrl: 'source', width: 800, height: 600 },
    })
    assert.equal(session.ok, true)
    assert.equal(session.source.id, 'saved-src')
    assert.equal(session.annotations[0].sourceId, session.source.id)
    assert.equal('frames' in session, false)
    assert.equal('frame' in session, false)
    assert.equal('frameId' in session.annotations[0], false)
    const again = serializeAnnotationDocument({ ...stored, sources: [session.source], annotations: session.annotations })
    assert.deepEqual(again.annotations, hydrateAnnotationDocument(stored).annotations)
  }
})

test('save wrapper sends current storage data and refuses incomplete PDF location', async () => {
  const previousWindow = globalThis.window
  let payload = null
  globalThis.window = { labApi: { saveAnnotations: async (value) => { payload = value; return { ok: true } } } }
  try {
    const result = await saveAnnotationDocument('source', hydrateAnnotationDocument(sample('video')), 'note')
    assert.equal(result.ok, true)
    assert.equal(payload.data.schemaVersion, 3.1)
    assert.equal('frames' in payload.data, false)
    assert.equal('frameId' in payload.data.annotations[0], false)
    payload = null
    const invalid = sample('pdf')
    invalid.annotations[0].locator = {}
    assert.equal((await saveAnnotationDocument('source', invalid, 'note')).ok, false)
    assert.equal(payload, null)
  } finally {
    globalThis.window = previousWindow
  }
})

test('opening media refuses unreadable adjacent notes rather than starting an empty session', async () => {
  const previousWindow = globalThis.window
  globalThis.window = { labApi: { loadAnnotations: async () => ({ ok: false, reason: 'unsupported-annotation-schema-version:4' }) } }
  try {
    for (const loader of [loadImageEditorSessionFromResult, loadVideoEditorSessionFromResult, loadPdfEditorSessionFromResult]) {
      const result = await loader({ ok: true, filePath: 'source', fileName: 'source' })
      assert.equal(result.ok, false)
      assert.match(result.reason, /unsupported/)
    }
  } finally {
    globalThis.window = previousWindow
  }
})

test('video loader and save wrapper retain a v3.1 interval and per-A properties', async () => {
  const previousWindow = globalThis.window
  let payload
  globalThis.window = { labApi: { saveAnnotations: async (value) => { payload = value; return { ok: true } } } }
  try {
    const data = sample('video')
    data.schemaVersion = 3.1
    data.annotations[0].locator = { start: 2.345678, end: 99.123456 }
    data.annotations[0].comment = 'preserve interval'
    const session = await loadVideoEditorSessionFromAnnotationResult({
      ok: true, data, annotationFilePath: 'source.mp4.annotation.json',
      media: { ok: true, filePath: 'source.mp4', fileName: 'source.mp4', fileUrl: 'source', width: 800, height: 600 },
    })
    assert.equal(session.ok, true)
    const result = await saveAnnotationDocument(session.source.filePath, {
      ...data, sources: [session.source], annotations: session.annotations,
    }, session.annotationFilePath)
    assert.equal(result.ok, true)
    assert.equal(payload.data.schemaVersion, 3.1)
    assert.deepEqual(payload.data.annotations[0].locator, data.annotations[0].locator)
    assert.deepEqual(payload.data.entities, data.entities)
    assert.equal(payload.data.annotations[0].comment, 'preserve interval')
  } finally {
    globalThis.window = previousWindow
  }
})
