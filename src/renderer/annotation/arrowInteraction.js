const HANDLE_SIZE = 8
const HANDLE_HIT_SIZE = 22
const LINE_HIT_TOLERANCE = 8

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y)
  }

  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)
  )
  const nearest = {
    x: start.x + projection * dx,
    y: start.y + projection * dy,
  }

  return Math.hypot(point.x - nearest.x, point.y - nearest.y)
}

function getBoxAroundPoint(name, point, size) {
  return {
    name,
    x: point.x - size / 2,
    y: point.y - size / 2,
    width: size,
    height: size,
  }
}

export function getArrowHandles(arrow, size = HANDLE_SIZE) {
  return [
    getBoxAroundPoint('start', { x: arrow.x1, y: arrow.y1 }, size),
    getBoxAroundPoint('end', { x: arrow.x2, y: arrow.y2 }, size),
  ]
}

export function getArrowHandleHitZones(arrow, size = HANDLE_HIT_SIZE) {
  return [
    getBoxAroundPoint('start', { x: arrow.x1, y: arrow.y1 }, size),
    getBoxAroundPoint('end', { x: arrow.x2, y: arrow.y2 }, size),
  ]
}

export function isPointInsideBox(point, box) {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  )
}

export function findArrowHandle(point, arrow) {
  const hitZone = getArrowHandleHitZones(arrow).find((handle) => isPointInsideBox(point, handle))
  return hitZone?.name || null
}

export function isPointNearArrow(point, arrow, tolerance = LINE_HIT_TOLERANCE) {
  return distanceToSegment(
    point,
    { x: arrow.x1, y: arrow.y1 },
    { x: arrow.x2, y: arrow.y2 }
  ) <= tolerance
}

export function getArrowLength(arrow) {
  return Math.hypot(arrow.x2 - arrow.x1, arrow.y2 - arrow.y1)
}
