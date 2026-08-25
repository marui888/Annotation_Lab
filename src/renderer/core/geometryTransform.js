export function normalizeRect(rect, size) {
  if (!size?.width || !size?.height) return null

  const x = Math.min(rect.x, rect.x + rect.width)
  const y = Math.min(rect.y, rect.y + rect.height)
  const width = Math.abs(rect.width)
  const height = Math.abs(rect.height)

  return {
    x: x / size.width,
    y: y / size.height,
    width: width / size.width,
    height: height / size.height,
  }
}

export function denormalizeRect(geometry, size) {
  return {
    x: geometry.x * size.width,
    y: geometry.y * size.height,
    width: geometry.width * size.width,
    height: geometry.height * size.height,
  }
}

export function normalizePoint(point, size) {
  if (!size?.width || !size?.height) return null

  return {
    x: point.x / size.width,
    y: point.y / size.height,
  }
}

export function denormalizePoint(geometry, size) {
  return {
    x: geometry.x * size.width,
    y: geometry.y * size.height,
  }
}

export function normalizeArrow(arrow, size) {
  if (!size?.width || !size?.height) return null

  return {
    x1: arrow.x1 / size.width,
    y1: arrow.y1 / size.height,
    x2: arrow.x2 / size.width,
    y2: arrow.y2 / size.height,
  }
}

export function denormalizeArrow(geometry, size) {
  return {
    x1: geometry.x1 * size.width,
    y1: geometry.y1 * size.height,
    x2: geometry.x2 * size.width,
    y2: geometry.y2 * size.height,
  }
}

export function clampPointToSize(point, size) {
  return {
    x: Math.max(0, Math.min(point.x, size.width)),
    y: Math.max(0, Math.min(point.y, size.height)),
  }
}

export function moveArrowByDelta(arrow, dx, dy, size) {
  const minX = Math.min(arrow.x1, arrow.x2)
  const maxX = Math.max(arrow.x1, arrow.x2)
  const minY = Math.min(arrow.y1, arrow.y2)
  const maxY = Math.max(arrow.y1, arrow.y2)
  const safeDx = Math.max(-minX, Math.min(dx, size.width - maxX))
  const safeDy = Math.max(-minY, Math.min(dy, size.height - maxY))

  return {
    x1: arrow.x1 + safeDx,
    y1: arrow.y1 + safeDy,
    x2: arrow.x2 + safeDx,
    y2: arrow.y2 + safeDy,
  }
}

export function resizeArrowByHandle(arrow, handle, point, size) {
  const nextPoint = clampPointToSize(point, size)

  if (handle === 'start') {
    return {
      ...arrow,
      x1: nextPoint.x,
      y1: nextPoint.y,
    }
  }

  return {
    ...arrow,
    x2: nextPoint.x,
    y2: nextPoint.y,
  }
}

export function clampRectToSize(rect, size, minSize = 4) {
  const width = Math.max(minSize, Math.min(rect.width, size.width))
  const height = Math.max(minSize, Math.min(rect.height, size.height))
  const x = Math.max(0, Math.min(rect.x, size.width - width))
  const y = Math.max(0, Math.min(rect.y, size.height - height))

  return { x, y, width, height }
}

export function resizeRectByHandle(rect, handle, point, minSize = 4) {
  const left = rect.x
  const right = rect.x + rect.width
  const top = rect.y
  const bottom = rect.y + rect.height

  let nextLeft = left
  let nextRight = right
  let nextTop = top
  let nextBottom = bottom

  if (handle.includes('left')) nextLeft = Math.min(point.x, right - minSize)
  if (handle.includes('right')) nextRight = Math.max(point.x, left + minSize)
  if (handle.includes('top')) nextTop = Math.min(point.y, bottom - minSize)
  if (handle.includes('bottom')) nextBottom = Math.max(point.y, top + minSize)

  return {
    x: nextLeft,
    y: nextTop,
    width: nextRight - nextLeft,
    height: nextBottom - nextTop,
  }
}
