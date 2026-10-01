import {
  denormalizeArrow,
  denormalizePolygon,
  denormalizeRect,
  getPolygonBounds,
} from '../core/geometryTransform'

const ARROW_EXPORT_PADDING = 16

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function toIntegerCrop(rect, imageSize) {
  const left = clamp(Math.floor(rect.x), 0, imageSize.width - 1)
  const top = clamp(Math.floor(rect.y), 0, imageSize.height - 1)
  const right = clamp(Math.ceil(rect.x + rect.width), left + 1, imageSize.width)
  const bottom = clamp(Math.ceil(rect.y + rect.height), top + 1, imageSize.height)

  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  }
}

function expandRect(rect, padding) {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  }
}

export function createAnnotationExportTask(annotation, imageSize, options = {}) {
  if (!annotation) return null

  const baseTask = {
    annotationId: annotation.id,
    index: Number.isFinite(options.index) ? options.index : 0,
    role: options.role || '',
    type: annotation.type,
  }

  if (annotation.type === 'text') {
    return {
      ...baseTask,
      text: annotation.text || '',
    }
  }

  if (!imageSize?.width || !imageSize?.height) return null

  if (annotation.type === 'rect') {
    return {
      ...baseTask,
      crop: toIntegerCrop(denormalizeRect(annotation.geometry, imageSize), imageSize),
    }
  }

  if (annotation.type === 'arrow') {
    const arrow = denormalizeArrow(annotation.geometry, imageSize)
    const rect = expandRect({
      x: Math.min(arrow.x1, arrow.x2),
      y: Math.min(arrow.y1, arrow.y2),
      width: Math.max(1, Math.abs(arrow.x2 - arrow.x1)),
      height: Math.max(1, Math.abs(arrow.y2 - arrow.y1)),
    }, ARROW_EXPORT_PADDING)

    return {
      ...baseTask,
      crop: toIntegerCrop(rect, imageSize),
    }
  }

  if (annotation.type === 'polygon') {
    const points = denormalizePolygon(annotation.geometry, imageSize)
    const bounds = getPolygonBounds(points)
    if (!bounds || points.length < 3) return null
    return {
      ...baseTask,
      crop: toIntegerCrop(bounds, imageSize),
      polygonPoints: points,
    }
  }

  return null
}
