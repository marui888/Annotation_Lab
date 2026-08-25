import { denormalizeArrow, denormalizeRect } from '../core/geometryTransform'

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function createStrictCropRect(rect, imageSize) {
  const left = clamp(rect.x, 0, imageSize.width)
  const top = clamp(rect.y, 0, imageSize.height)
  const right = clamp(rect.x + rect.width, left + 1, imageSize.width)
  const bottom = clamp(rect.y + rect.height, top + 1, imageSize.height)

  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  }
}

export function getAnnotationCropRect(annotation, imageSize) {
  if (!annotation || !imageSize?.width || !imageSize?.height) return null

  if (annotation.type === 'rect' || annotation.type === 'text') {
    return createStrictCropRect(denormalizeRect(annotation.geometry, imageSize), imageSize)
  }

  if (annotation.type === 'arrow') {
    const arrow = denormalizeArrow(annotation.geometry, imageSize)
    return createStrictCropRect({
      x: Math.min(arrow.x1, arrow.x2),
      y: Math.min(arrow.y1, arrow.y2),
      width: Math.abs(arrow.x2 - arrow.x1),
      height: Math.abs(arrow.y2 - arrow.y1),
    }, imageSize)
  }

  return null
}

export function createAnnotationCropLayout(annotation, imageSize, previewSize = null, options = {}) {
  if (!annotation || !imageSize) {
    return {
      ok: false,
      reason: 'image-not-ready',
    }
  }

  const crop = getAnnotationCropRect(annotation, imageSize)
  if (!crop) {
    return {
      ok: false,
      reason: 'invalid-geometry',
    }
  }

  const maxWidth = previewSize?.width || crop.width
  const maxHeight = previewSize?.height || crop.height
  const scale = Number.isFinite(options.scale)
    ? options.scale
    : Math.min(maxWidth / crop.width, maxHeight / crop.height)
  const width = Math.max(1, Math.round(crop.width * scale))
  const height = Math.max(1, Math.round(crop.height * scale))

  return {
    ok: true,
    crop,
    scale,
    width,
    height,
    imageWidth: imageSize.width * scale,
    imageHeight: imageSize.height * scale,
    imageLeft: -crop.x * scale,
    imageTop: -crop.y * scale,
  }
}

export function calculateSharedAnnotationCropScale(items, options = {}) {
  const cropRects = items
    .map((item) => getAnnotationCropRect(item.annotation, item.imageSize))
    .filter(Boolean)

  if (cropRects.length === 0) return null

  const maxCropWidth = Math.max(...cropRects.map((crop) => crop.width))
  const maxCropHeight = Math.max(...cropRects.map((crop) => crop.height))
  const maxWidth = options.maxWidth || 300
  const maxHeight = options.maxHeight || 180
  const maxScale = Number.isFinite(options.maxScale) ? options.maxScale : 1
  const scaleFactor = Number.isFinite(options.scaleFactor) ? options.scaleFactor : 1

  return Math.min(maxWidth / maxCropWidth, maxHeight / maxCropHeight, maxScale) * scaleFactor
}
