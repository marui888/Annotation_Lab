// Cursor feedback only: it does not move objects or change drag/selection state.
const allowed = new Set(['move', 'nwse-resize', 'nesw-resize', 'ns-resize', 'ew-resize'])
const cursorOf = (node) => {
  const cursor = node?.getAttr?.('interactionCursor')
  return allowed.has(cursor) ? cursor : ''
}

export function createRectCursorFeedback(stage, documentObject) {
  const container = stage.container()
  const previousContainerCursor = container.style.cursor
  const bodyStyle = documentObject?.body?.style
  let previousBodyCursor = ''
  let dragCursor = ''
  let hoverCursor = ''
  let inside = false
  let disabled = false
  let lastContainerCursor = previousContainerCursor

  const apply = () => {
    lastContainerCursor = dragCursor || (!disabled && inside ? hoverCursor : '') || previousContainerCursor
    container.style.cursor = lastContainerCursor
  }
  const restoreBody = () => {
    if (dragCursor && bodyStyle?.cursor === dragCursor) bodyStyle.cursor = previousBodyCursor
    dragCursor = ''
  }
  const refreshHover = () => {
    const position = stage.getPointerPosition()
    hoverCursor = inside && position ? cursorOf(stage.getIntersection(position)) : ''
  }

  return {
    move(event) {
      inside = true
      hoverCursor = cursorOf(event.target)
      apply()
    },
    leave() {
      inside = false
      hoverCursor = ''
      apply()
    },
    start(cursor) {
      if (disabled || !allowed.has(cursor)) return
      if (!dragCursor) previousBodyCursor = bodyStyle?.cursor || ''
      dragCursor = cursor
      if (bodyStyle) bodyStyle.cursor = cursor
      apply()
    },
    finish() {
      restoreBody()
      refreshHover()
      apply()
    },
    refresh(nextDisabled = false) {
      disabled = nextDisabled
      if (disabled) restoreBody()
      refreshHover()
      apply()
    },
    destroy() {
      restoreBody()
      if (container.style.cursor === lastContainerCursor) container.style.cursor = previousContainerCursor
    },
  }
}
