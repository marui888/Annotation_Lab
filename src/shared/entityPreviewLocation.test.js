import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareEntityPreview } from '../renderer/c-editor/entityPreviewResources.js'

function note(kind, locators) {
  return {
    ok: true,
    data: {
      schemaVersion: 2,
      sources: [{ id: 's', kind }],
      annotations: locators.map((locator, i) => ({ id: `a${i}`, sourceId: 's', locator, type: 'rect' })),
      entities: [{ id: 'e', aObjectIds: locators.map((_, i) => `a${i}`) }],
    },
    media: { fileName: 'source', fileUrl: 'source', size: 100, mtimeMs: 123 },
  }
}

test('CEditor video preview groups shared times and creates targets directly from A Object', () => {
  const result = prepareEntityPreview(note('video', [{ time: 0 }, { time: 0 }, { time: 2.345678 }]), 'e', { get: () => null })
  assert.equal(result.ok, true)
  assert.equal(result.targets.size, 2)
  assert.equal([...result.targets.values()][0].annotationIds.length, 2)
  assert.equal([...result.targets.values()][1].time, 2.345678)
  assert.equal('frameId' in result.annotationPreviews.a0, false)
})

test('CEditor PDF preview resolves page and cached pixels without Frames', () => {
  const result = prepareEntityPreview(note('pdf', [{ physicalPage: 7, bookPageLabel: 'iii' }]), 'e', {
    get: () => ({ ok: true, previewUrl: 'cached-image', imageSize: { width: 800, height: 600 } }),
  })
  assert.equal(result.targets.size, 0)
  assert.equal(result.annotationPreviews.a0.imageUrl, 'cached-image')
  assert.equal(result.annotationPreviews.a0.status, 'ready')
})

test('CEditor can read a legacy PDF Entity through the migration boundary', () => {
  const input = note('pdf', [])
  input.data.schemaVersion = 1
  input.data.frames = [{ id: 'f', sourceId: 's', locator: { physicalPage: 3 }, meta: { bookPageLabel: '1' } }]
  input.data.annotations = [{ id: 'a', frameId: 'f', type: 'rect' }]
  input.data.entities[0].aObjectIds = ['a']
  const result = prepareEntityPreview(input, 'e', { get: () => null })
  assert.equal([...result.targets.values()][0].page, 3)
  assert.equal(result.annotations[0].locator.bookPageLabel, '1')
  assert.equal('frameId' in result.annotations[0], false)
})

test('CEditor v3.1 preview shares start frames across different ends and supports legacy keys', () => {
  const input = note('video', [
    { start: 0, end: 2.55 }, { start: 0, end: 50 }, { start: 2.345678, end: 99 },
  ])
  input.data.schemaVersion = 3.1
  const result = prepareEntityPreview(input, 'e', { get: () => null })
  assert.equal(result.targets.size, 2)
  assert.deepEqual([...result.targets.values()].map((target) => target.time), [0, 2.345678])
  assert.deepEqual([...result.targets.values()][0].annotationIds, ['a0', 'a1'])
  assert.equal(result.annotations[1].locator.end, 50)

  const legacyResult = prepareEntityPreview(note('video', [{ time: 0 }]), 'e', { get: () => null })
  assert.equal([...legacyResult.targets.keys()][0], [...result.targets.keys()][0])
})
