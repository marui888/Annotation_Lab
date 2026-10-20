import assert from 'node:assert/strict'
import test from 'node:test'
import { initialCardProperties, normalizeAObjectProperties } from './aObjectProperties.js'
import { createCardsFromAnnotations, getInitialCardProperties } from '../renderer/domain/aObjectDefaults.js'
import { cloneACardTree, createACardPatch, flattenACardTree, getEntityACardTree, updateACardProperties } from '../renderer/domain/aCardTree.js'
import { getEntityAObjectRefs } from '../renderer/domain/domainSchemas.js'
import { moveSiblingDown, removeNodes } from '../renderer/components/tree-list/treeOperations.js'
import { hydrateAnnotationDocument, serializeAnnotationDocument } from './annotationDocument.js'

const roles = [{ value: 'stem', label: 'Stem' }, { value: 'answer', label: 'Answer' }]
const context = { subject: 'math', kind: 'question' }
const schemas = [{ id: 'math', label: 'Math', kinds: [{ value: 'question' }], rolesByKind: { question: roles } }]
const original = {
  id: 'a', sourceId: 's', locator: {}, type: 'rect',
  geometry: { x: 0, y: 0, width: 1, height: 1 },
  defaultRole: { ...context, role: 'answer' }, comment: 'original\ncomment',
}

test('matching default is copied; incompatible context, deleted role and missing defaults use target fallback', () => {
  assert.deepEqual(initialCardProperties(original, context, roles), { role: 'answer', comment: original.comment })
  assert.equal(initialCardProperties(original, { subject: 'english', kind: 'question' }, roles).role, 'stem')
  assert.equal(initialCardProperties(original, { subject: 'math', kind: 'other' }, roles).role, 'stem')
  assert.equal(initialCardProperties({ ...original, defaultRole: { ...context, role: 'gone' } }, context, roles).role, 'stem')
  assert.equal(initialCardProperties({}, context, roles).role, 'stem')
})

test('explicit Add To Entity role overrides only the new reference role, keeping comment', () => {
  assert.deepEqual(getInitialCardProperties(original, context, schemas, 'stem'), { role: 'stem', comment: original.comment })
  assert.equal(original.defaultRole.role, 'answer')
})

test('same A in two Entities has independent snapshots and original edits do not propagate', () => {
  const a = structuredClone(original)
  const first = createCardsFromAnnotations([a], context, schemas)
  const second = createCardsFromAnnotations([a], context, schemas)
  const updated = updateACardProperties(first, first[0].id, { role: 'stem', comment: 'first only' })
  assert.equal(updated[0].comment, 'first only')
  assert.equal(second[0].comment, original.comment)
  assert.equal(a.comment, original.comment)
  a.defaultRole.role = 'stem'
  a.comment = 'new original'
  assert.equal(second[0].role, 'answer')
  assert.equal(second[0].comment, original.comment)
  assert.equal(createCardsFromAnnotations([a], context, schemas)[0].comment, 'new original')
})

test('nested node edits affect exactly its Card ID, including intentionally empty comment', () => {
  const parent = createCardsFromAnnotations([original], context, schemas)[0]
  const child = createCardsFromAnnotations([original], context, schemas)[0]
  parent.children = [child]
  const updated = updateACardProperties([parent], child.id, { role: 'stem', comment: '' })
  assert.equal(updated[0].role, 'answer')
  assert.equal(updated[0].comment, original.comment)
  assert.equal(updated[0].children[0].comment, '')
  assert.equal(parent.children[0].comment, original.comment)
})

test('tree, flattened refs, ordering, deletion snapshots and cloning preserve per-reference comment', () => {
  const tree = createCardsFromAnnotations([original, { ...original, id: 'a2', comment: 'second' }], context, schemas)
  const patch = createACardPatch(moveSiblingDown(tree, tree[0].id))
  assert.equal(patch.aObjectRefs[0].comment, 'second')
  assert.equal(getEntityAObjectRefs(patch)[1].comment, original.comment)
  assert.equal(getEntityACardTree({ aObjectRefs: patch.aObjectRefs })[0].comment, 'second')
  const snapshot = JSON.parse(JSON.stringify(patch))
  assert.equal(removeNodes(patch.aCards, [tree[0].id]).length, 1)
  assert.equal(snapshot.aCards.length, 2)
  tree[0].children = [tree[1]]
  const cloned = cloneACardTree([tree[0]])
  assert.notEqual(cloned[0].id, tree[0].id)
  assert.notEqual(cloned[0].children[0].id, tree[1].id)
  assert.deepEqual(flattenACardTree(cloned).map((c) => c.comment), [original.comment, 'second'])
})

test('reset uses current original defaults, not Entity overrides', () => {
  const updatedA = { ...original, comment: 'updated original' }
  assert.deepEqual(getInitialCardProperties(updatedA, context, schemas), { role: 'answer', comment: 'updated original' })
})

test('v3 round trip preserves defaults, reference overrides and locator without Frames', () => {
  const cards = createCardsFromAnnotations([original], context, schemas)
  cards[0].comment = 'Entity override'
  const data = {
    schemaVersion: 3, sources: [{ id: 's', kind: 'image' }], annotations: [original],
    entities: [{ id: 'e', ...context, ...createACardPatch(cards) }], simpleNotes: [],
  }
  const stored = serializeAnnotationDocument(data)
  const loaded = hydrateAnnotationDocument(JSON.parse(JSON.stringify(stored)))
  assert.equal(loaded.schemaVersion, 3.1)
  assert.deepEqual(loaded.annotations[0], original)
  assert.equal(loaded.entities[0].aCards[0].comment, 'Entity override')
  assert.equal(loaded.entities[0].aObjectRefs[0].comment, 'Entity override')
  assert.equal('frames' in loaded, false)
})

test('v2 migration adds empty defaults without inferring or changing Entity roles', () => {
  const a = { ...original }
  delete a.defaultRole
  delete a.comment
  const data = { schemaVersion: 2, sources: [{ id: 's', kind: 'image' }], annotations: [a], entities: [{ aObjectRefs: [{ aObjectId: 'a', role: 'answer' }] }] }
  const loaded = hydrateAnnotationDocument(data)
  assert.deepEqual(normalizeAObjectProperties(loaded.annotations[0]), { defaultRole: null, comment: '' })
  assert.equal(loaded.entities[0].aObjectRefs[0].role, 'answer')
  assert.equal(loaded.annotations[0].defaultRole, null)
})
