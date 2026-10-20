import assert from 'node:assert/strict'
import test from 'node:test'
import { createRectCursorFeedback } from './rectCursorFeedback.js'
import { getRectHandles, getRectResizeCursor, RECT_HANDLE_NAMES } from './rectInteraction.js'

const node = (cursor) => ({ getAttr: (key) => key === 'interactionCursor' ? cursor : undefined })
function fixture() {
  const container = { style: { cursor: '' } }
  const documentObject = { body: { style: { cursor: 'auto' } } }
  let target = null
  const stage = {
    container: () => container,
    getPointerPosition: () => ({ x: 5, y: 5 }),
    getIntersection: () => target,
  }
  const feedback = createRectCursorFeedback(stage, documentObject)
  return { feedback, container, documentObject, hit: (cursor) => { target = node(cursor); feedback.move({ target }) } }
}

test('all eight rectangle handles map to the correct resize direction', () => {
  assert.deepEqual(RECT_HANDLE_NAMES.map(getRectResizeCursor), [
    'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize',
    'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize',
  ])
  assert.equal(getRectResizeCursor('unknown'), '')
  assert.deepEqual(getRectHandles({ x: 0, y: 0, width: 1920, height: 1080 }).map((handle) => getRectResizeCursor(handle.name)), RECT_HANDLE_NAMES.map(getRectResizeCursor))
})

test('hover shows move/resize immediately and restores default outside the hot zones', () => {
  const { feedback, container, documentObject, hit } = fixture()
  hit('move')
  assert.equal(container.style.cursor, 'move')
  hit('ew-resize')
  assert.equal(container.style.cursor, 'ew-resize')
  hit(undefined)
  assert.equal(container.style.cursor, '')
  assert.equal(documentObject.body.style.cursor, 'auto')
  feedback.destroy()
})

test('drag keeps its original direction when crossing other shapes or leaving the canvas', () => {
  const { feedback, container, documentObject, hit } = fixture()
  hit('ew-resize')
  feedback.start('ew-resize')
  hit('move')
  assert.equal(container.style.cursor, 'ew-resize')
  feedback.leave()
  assert.equal(container.style.cursor, 'ew-resize')
  assert.equal(documentObject.body.style.cursor, 'ew-resize')
  feedback.finish()
  assert.equal(container.style.cursor, '')
  assert.equal(documentObject.body.style.cursor, 'auto')
})

test('release inside restores the current hover cursor without retaining the drag override', () => {
  const { feedback, container, documentObject, hit } = fixture()
  feedback.start('nwse-resize')
  hit('move')
  feedback.finish()
  assert.equal(container.style.cursor, 'move')
  assert.equal(documentObject.body.style.cursor, 'auto')
  feedback.leave()
  assert.equal(container.style.cursor, '')
})

test('polygon repair disables rectangle feedback without modifying any interaction state', () => {
  const { feedback, container, documentObject, hit } = fixture()
  hit('move')
  feedback.start('move')
  feedback.refresh(true)
  assert.equal(container.style.cursor, '')
  assert.equal(documentObject.body.style.cursor, 'auto')
  feedback.start('ew-resize')
  hit('ew-resize')
  assert.equal(container.style.cursor, '')
  feedback.refresh(false)
  assert.equal(container.style.cursor, 'ew-resize')
})

test('unmount releases both cursor overrides and preserves a different later owner', () => {
  const first = fixture()
  first.feedback.start('move')
  first.feedback.destroy()
  assert.equal(first.container.style.cursor, '')
  assert.equal(first.documentObject.body.style.cursor, 'auto')
  const second = fixture()
  second.feedback.start('move')
  second.container.style.cursor = 'crosshair'
  second.documentObject.body.style.cursor = 'wait'
  second.feedback.destroy()
  assert.equal(second.container.style.cursor, 'crosshair')
  assert.equal(second.documentObject.body.style.cursor, 'wait')
})

test('pre-existing container cursor is restored rather than replaced with a forced default', () => {
  const container = { style: { cursor: 'crosshair' } }
  const feedback = createRectCursorFeedback({ container: () => container, getPointerPosition: () => null }, {})
  feedback.move({ target: node('ns-resize') })
  assert.equal(container.style.cursor, 'ns-resize')
  feedback.leave()
  assert.equal(container.style.cursor, 'crosshair')
  feedback.destroy()
})
