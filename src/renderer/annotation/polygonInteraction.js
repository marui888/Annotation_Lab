const EPSILON = 0.000001

export function getPointDistance(left, right) {
  return Math.hypot(right.x - left.x, right.y - left.y)
}

export function constrainPointToOrthogonal(start, point) {
  if (!start || !point) return point
  const dx = point.x - start.x
  const dy = point.y - start.y
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: point.x, y: start.y }
    : { x: start.x, y: point.y }
}

export function getPolygonArea(points = []) {
  if (points.length < 3) return 0
  let twiceArea = 0
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]
    twiceArea += point.x * next.y - next.x * point.y
  })
  return Math.abs(twiceArea) / 2
}

function cross(left, middle, right) {
  return (middle.x - left.x) * (right.y - left.y)
    - (middle.y - left.y) * (right.x - left.x)
}

function isPointOnSegment(point, start, end) {
  if (Math.abs(cross(start, end, point)) > EPSILON) return false
  return point.x >= Math.min(start.x, end.x) - EPSILON
    && point.x <= Math.max(start.x, end.x) + EPSILON
    && point.y >= Math.min(start.y, end.y) - EPSILON
    && point.y <= Math.max(start.y, end.y) + EPSILON
}

export function doSegmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const firstA = cross(firstStart, firstEnd, secondStart)
  const firstB = cross(firstStart, firstEnd, secondEnd)
  const secondA = cross(secondStart, secondEnd, firstStart)
  const secondB = cross(secondStart, secondEnd, firstEnd)

  if (((firstA > EPSILON && firstB < -EPSILON) || (firstA < -EPSILON && firstB > EPSILON))
    && ((secondA > EPSILON && secondB < -EPSILON) || (secondA < -EPSILON && secondB > EPSILON))) {
    return true
  }

  return (Math.abs(firstA) <= EPSILON && isPointOnSegment(secondStart, firstStart, firstEnd))
    || (Math.abs(firstB) <= EPSILON && isPointOnSegment(secondEnd, firstStart, firstEnd))
    || (Math.abs(secondA) <= EPSILON && isPointOnSegment(firstStart, secondStart, secondEnd))
    || (Math.abs(secondB) <= EPSILON && isPointOnSegment(firstEnd, secondStart, secondEnd))
}

export function hasPolygonSelfIntersection(points = [], closed = true) {
  const segmentCount = closed ? points.length : points.length - 1
  if (segmentCount < 2) return false

  for (let firstIndex = 0; firstIndex < segmentCount; firstIndex += 1) {
    const firstStart = points[firstIndex]
    const firstEnd = points[(firstIndex + 1) % points.length]

    for (let secondIndex = firstIndex + 1; secondIndex < segmentCount; secondIndex += 1) {
      const adjacent = secondIndex === firstIndex + 1
        || (closed && firstIndex === 0 && secondIndex === segmentCount - 1)
      if (adjacent) continue

      const secondStart = points[secondIndex]
      const secondEnd = points[(secondIndex + 1) % points.length]
      if (doSegmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) return true
    }
  }

  return false
}

export function isPointInPolygon(point, points = []) {
  if (points.length < 3) return false
  let inside = false

  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const currentPoint = points[index]
    const previousPoint = points[previous]
    if (isPointOnSegment(point, previousPoint, currentPoint)) return true
    const crosses = (currentPoint.y > point.y) !== (previousPoint.y > point.y)
      && point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y))
        / (previousPoint.y - currentPoint.y) + currentPoint.x
    if (crosses) inside = !inside
  }

  return inside
}

export function toFlatPoints(points = []) {
  return points.flatMap((point) => [point.x, point.y])
}
