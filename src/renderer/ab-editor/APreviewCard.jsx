import { useEffect, useId, useRef, useState } from 'react'
import { denormalizeArrow, denormalizePolygon, denormalizeRect } from '../core/geometryTransform'
import { createAnnotationCropLayout } from './previewCrop'

function formatGeometryValue(value) {
  return Number.isFinite(value) ? value.toFixed(3) : '--'
}

function getAnnotationInfo(annotation) {
  if (!annotation) return []
  if (annotation.type === 'rect') {
    return [
      `x ${formatGeometryValue(annotation.geometry.x)}`,
      `y ${formatGeometryValue(annotation.geometry.y)}`,
      `w ${formatGeometryValue(annotation.geometry.width)}`,
      `h ${formatGeometryValue(annotation.geometry.height)}`,
    ]
  }
  if (annotation.type === 'arrow') {
    return [
      `x1 ${formatGeometryValue(annotation.geometry.x1)}`,
      `y1 ${formatGeometryValue(annotation.geometry.y1)}`,
      `x2 ${formatGeometryValue(annotation.geometry.x2)}`,
      `y2 ${formatGeometryValue(annotation.geometry.y2)}`,
    ]
  }
  if (annotation.type === 'text') {
    return [
      annotation.text || 'FreeText',
      `x ${formatGeometryValue(annotation.geometry.x)}`,
      `y ${formatGeometryValue(annotation.geometry.y)}`,
      `w ${formatGeometryValue(annotation.geometry.width)}`,
      `h ${formatGeometryValue(annotation.geometry.height)}`,
    ]
  }
  if (annotation.type === 'polygon') {
    return [`${annotation.geometry?.points?.length || 0} vertices`]
  }
  return [annotation.id]
}

function splitTextLines(text) {
  return String(text || '').split(/\r?\n/)
}

function getPreviewStrokeWidth(crop) {
  return crop ? 2 : 1
}

function renderAnnotationSvgContent(annotation, crop, imageSize) {
  if (!annotation || !crop || !imageSize) return null
  const strokeWidth = getPreviewStrokeWidth(crop)

  if (annotation.type === 'rect') {
    const rect = denormalizeRect(annotation.geometry, imageSize)
    return (
      <rect
        fill="none"
        height={Math.max(1, rect.height)}
        stroke="#ff4949"
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
        width={Math.max(1, rect.width)}
        x={rect.x}
        y={rect.y}
      />
    )
  }

  if (annotation.type === 'arrow') {
    const arrow = denormalizeArrow(annotation.geometry, imageSize)
    return (
      <>
        <defs>
          <marker
            id={`arrow-head-${annotation.id}`}
            markerHeight="8"
            markerUnits="strokeWidth"
            markerWidth="8"
            orient="auto"
            refX="7"
            refY="3.5"
          >
            <polygon fill="#ff4949" points="0 0, 8 3.5, 0 7" />
          </marker>
        </defs>
        <line
          markerEnd={`url(#arrow-head-${annotation.id})`}
          stroke="#ff4949"
          strokeLinecap="round"
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
          x1={arrow.x1}
          x2={arrow.x2}
          y1={arrow.y1}
          y2={arrow.y2}
        />
      </>
    )
  }

  if (annotation.type === 'text') {
    const rect = denormalizeRect(annotation.geometry, imageSize)
    const textX = rect.x + 6
    const textY = rect.y + 6
    const fontSize = Math.max(8, annotation.style?.fontSize || 18)
    const lineHeight = fontSize * 1.2
    const lines = splitTextLines(annotation.text || '')
    return (
      <>
        <rect
          fill="rgba(255, 73, 73, 0.12)"
          height={Math.max(1, rect.height)}
          stroke="#ff4949"
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
          width={Math.max(1, rect.width)}
          x={rect.x}
          y={rect.y}
        />
        <text
          fill={annotation.style?.fill || '#ff4d4d'}
          fontFamily="Arial"
          fontSize={fontSize}
          x={textX}
          y={textY + fontSize}
        >
          {lines.map((line, index) => (
            <tspan
              key={`${index}-${line}`}
              x={textX}
              y={textY + fontSize + index * lineHeight}
            >
              {line}
            </tspan>
          ))}
        </text>
      </>
    )
  }

  if (annotation.type === 'polygon') {
    const points = denormalizePolygon(annotation.geometry, imageSize)
      .map((point) => `${point.x},${point.y}`)
      .join(' ')
    return (
      <polygon
        fill="none"
        points={points}
        stroke="#ff4949"
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
      />
    )
  }

  return null
}

export default function APreviewCard({
  annotation,
  imageUrl,
  imageSize,
  index,
  layoutScale,
  missingPreviewText = 'Preview unavailable',
  previewBackgroundColor,
  role,
  showAnnotationFrame = true,
  showInfo = true,
}) {
  const cropHostRef = useRef(null)
  const polygonClipId = `polygon-clip-${useId().replace(/:/g, '')}`
  const [cropHostSize, setCropHostSize] = useState(null)
  const hasLayoutScale = Number.isFinite(layoutScale)

  useEffect(() => {
    if (hasLayoutScale) return undefined
    if (!cropHostRef.current) return undefined

    const updateSize = () => {
      const rect = cropHostRef.current.getBoundingClientRect()
      setCropHostSize({
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height)),
      })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(cropHostRef.current)
    return () => observer.disconnect()
  }, [hasLayoutScale, showInfo])

  if (!annotation) {
    return (
      <article className="a-preview-card missing">
        <div className="a-preview-crop">Missing A object</div>
      </article>
    )
  }

  const infoItems = getAnnotationInfo(annotation)
  const cropResult = createAnnotationCropLayout(annotation, imageSize, cropHostSize, {
    scale: layoutScale,
  })
  const polygonPoints = annotation.type === 'polygon'
    ? denormalizePolygon(annotation.geometry, imageSize)
      .map((point) => `${point.x},${point.y}`)
      .join(' ')
    : ''

  return (
    <article className={[
      'a-preview-card',
      showInfo ? '' : 'raw',
      hasLayoutScale ? 'shared-scale' : '',
    ].filter(Boolean).join(' ')}
      style={previewBackgroundColor ? { '--a-preview-background': previewBackgroundColor } : undefined}
    >
      <div className="a-preview-crop" ref={cropHostRef}>
        {cropResult?.ok && imageUrl ? (
          <svg
            className="a-preview-image-frame"
            height={cropResult.height}
            preserveAspectRatio="none"
            style={{
              width: cropResult.width,
              height: cropResult.height,
            }}
            viewBox={`${cropResult.crop.x} ${cropResult.crop.y} ${cropResult.crop.width} ${cropResult.crop.height}`}
            width={cropResult.width}
          >
            {polygonPoints ? (
              <defs>
                <clipPath id={polygonClipId}>
                  <polygon points={polygonPoints} />
                </clipPath>
              </defs>
            ) : null}
            <image
              clipPath={polygonPoints ? `url(#${polygonClipId})` : undefined}
              height={imageSize.height}
              href={imageUrl}
              preserveAspectRatio="none"
              width={imageSize.width}
              x="0"
              y="0"
            />
            {showAnnotationFrame ? renderAnnotationSvgContent(annotation, cropResult.crop, imageSize) : null}
          </svg>
        ) : (
          <span>{imageUrl ? cropResult?.reason || missingPreviewText : missingPreviewText}</span>
        )}
      </div>
      {showInfo ? (
        <div className="a-preview-info">
          <div className="a-preview-title">
            {Number.isFinite(index) ? `${index + 1}. ` : ''}
            {annotation.type}
          </div>
          {role ? <div className="a-preview-role">{role}</div> : null}
          {infoItems.map((item, itemIndex) => (
            <div key={`${itemIndex}-${item}`}>{item}</div>
          ))}
          <small title={annotation.id}>{annotation.id}</small>
        </div>
      ) : null}
    </article>
  )
}
