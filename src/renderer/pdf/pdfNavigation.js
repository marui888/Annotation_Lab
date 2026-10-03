const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0))

function normalizeBounds(left, top, right, bottom) {
  const x1 = clamp01(Math.min(left, right))
  const y1 = clamp01(Math.min(top, bottom))
  const x2 = clamp01(Math.max(left, right))
  const y2 = clamp01(Math.max(top, bottom))
  return {
    x: x1,
    y: y1,
    width: Math.max(0.001, x2 - x1),
    height: Math.max(0.001, y2 - y1),
  }
}

export function getAnnotationNormalizedBounds(annotation) {
  const geometry = annotation?.geometry
  if (!geometry) return null

  if (annotation.type === 'rect' || annotation.type === 'text') {
    return normalizeBounds(
      geometry.x,
      geometry.y,
      Number(geometry.x) + Number(geometry.width),
      Number(geometry.y) + Number(geometry.height),
    )
  }

  if (annotation.type === 'arrow') {
    const padding = 0.015
    return normalizeBounds(
      Math.min(Number(geometry.x1), Number(geometry.x2)) - padding,
      Math.min(Number(geometry.y1), Number(geometry.y2)) - padding,
      Math.max(Number(geometry.x1), Number(geometry.x2)) + padding,
      Math.max(Number(geometry.y1), Number(geometry.y2)) + padding,
    )
  }

  if (annotation.type === 'polygon') {
    const points = Array.isArray(geometry.points) ? geometry.points : []
    if (!points.length) return null
    const xs = points.map((point) => Number(point.x)).filter(Number.isFinite)
    const ys = points.map((point) => Number(point.y)).filter(Number.isFinite)
    if (!xs.length || !ys.length) return null
    return normalizeBounds(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys))
  }

  return null
}
