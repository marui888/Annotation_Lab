import { useState } from 'react'
import { Arrow, Group, Layer, Rect, Stage, Text as KonvaText } from 'react-konva'
import { createId } from '../core/id'
import {
  clampRectToSize,
  denormalizeArrow,
  denormalizeRect,
  moveArrowByDelta,
  normalizeArrow,
  normalizeRect,
  resizeArrowByHandle,
  resizeRectByHandle,
} from '../core/geometryTransform'
import {
  findArrowHandle,
  getArrowHandles,
  getArrowLength,
  isPointNearArrow,
} from './arrowInteraction'
import ResizableRect from './ResizableRect'

const MIN_RECT_SIZE = 4
const MIN_ARROW_SIZE = 6
const DEFAULT_TEXT_WIDTH = 160
const DEFAULT_TEXT_HEIGHT = 64
const TEXT_PADDING = 6

function getTextRect(annotation) {
  return {
    x: annotation.geometry.x,
    y: annotation.geometry.y,
    width: annotation.geometry.width,
    height: annotation.geometry.height,
  }
}

export default function MediaAnnotationLayer({
  annotations,
  frameId,
  mode,
  onAddAnnotation,
  onAddTextAnnotation,
  onClearSelection,
  onAObjectContextMenu,
  onCanvasContextMenu,
  onCanvasDoubleClick,
  onEditTextAnnotation,
  onSelectAnnotation,
  onUpdateAnnotation,
  selectedAnnotationIds = [],
  size,
  displayScale = 1,
}) {
  const [draftRect, setDraftRect] = useState(null)
  const [draftArrow, setDraftArrow] = useState(null)
  const [dragState, setDragState] = useState(null)

  const canUseStage = frameId && size?.width > 0 && size?.height > 0

  const getPointerPosition = (event) => {
    const stage = event.target.getStage()
    return stage?.getPointerPosition() || null
  }

  const createTextAnnotation = (position) => {
    const scaledTextWidth = DEFAULT_TEXT_WIDTH * displayScale
    const scaledTextHeight = DEFAULT_TEXT_HEIGHT * displayScale
    const textRect = clampRectToSize(
      {
        x: position.x,
        y: position.y - scaledTextHeight / 2,
        width: scaledTextWidth,
        height: scaledTextHeight,
      },
      size,
      MIN_RECT_SIZE
    )
    const geometry = normalizeRect(textRect, size)
    if (!geometry) return

    const now = new Date().toISOString()
    const annotation = {
      id: createId('a'),
      frameId,
      type: 'text',
      geometry,
      text: 'FreeText',
      style: {
        fill: '#ff4d4d',
        fontSize: 18,
      },
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }

    onAddTextAnnotation?.(annotation)
  }

  const handleMouseDown = (event) => {
    if (event.evt?.button === 2) return
    if (event.target !== event.target.getStage()) return
    const position = getPointerPosition(event)
    if (!position || !canUseStage) return

    if (mode === 'select') {
      onClearSelection?.()
      return
    }

    if (mode === 'rect') {
      setDraftRect({
        x: position.x,
        y: position.y,
        width: 0,
        height: 0,
      })
      return
    }

    if (mode === 'arrow') {
      setDraftArrow({
        x1: position.x,
        y1: position.y,
        x2: position.x,
        y2: position.y,
      })
      return
    }

    if (mode === 'text') {
      createTextAnnotation(position)
    }
  }

  const handleContextMenu = (event) => {
    event.evt?.preventDefault?.()
    if (event.target !== event.target.getStage()) return
    onCanvasContextMenu?.(event.evt.clientX, event.evt.clientY)
  }

  const handleDoubleClick = (event) => {
    if (event.target !== event.target.getStage()) return
    onCanvasDoubleClick?.()
  }

  const handleMouseMove = (event) => {
    const position = getPointerPosition(event)
    if (!position) return

    if (dragState) {
      const dx = position.x - dragState.startPoint.x
      const dy = position.y - dragState.startPoint.y

      if (dragState.type === 'rect' || dragState.type === 'text') {
        if (dragState.kind === 'move') {
          const nextRect = clampRectToSize({
            ...dragState.originalRect,
            x: dragState.originalRect.x + dx,
            y: dragState.originalRect.y + dy,
          }, size, MIN_RECT_SIZE)
          const geometry = normalizeRect(nextRect, size)
          if (geometry) onUpdateAnnotation(dragState.annotationId, { geometry })
          return
        }

        const nextRect = clampRectToSize(
          resizeRectByHandle(dragState.originalRect, dragState.handle, position, MIN_RECT_SIZE),
          size,
          MIN_RECT_SIZE
        )
        const geometry = normalizeRect(nextRect, size)
        if (geometry) onUpdateAnnotation(dragState.annotationId, { geometry })
        return
      }

      if (dragState.type === 'arrow') {
        const nextArrow = dragState.kind === 'move'
          ? moveArrowByDelta(dragState.originalArrow, dx, dy, size)
          : resizeArrowByHandle(dragState.originalArrow, dragState.handle, position, size)
        const geometry = normalizeArrow(nextArrow, size)
        if (geometry) onUpdateAnnotation(dragState.annotationId, { geometry })
      }

      return
    }

    if (draftRect) {
      setDraftRect((current) => ({
        ...current,
        width: position.x - current.x,
        height: position.y - current.y,
      }))
      return
    }

    if (draftArrow) {
      setDraftArrow((current) => ({
        ...current,
        x2: position.x,
        y2: position.y,
      }))
    }
  }

  const handleMouseUp = () => {
    if (dragState) {
      onUpdateAnnotation(dragState.annotationId, {
        updatedAt: new Date().toISOString(),
      })
      setDragState(null)
      return
    }

    if (draftRect) {
      const geometry = normalizeRect(draftRect, size)
      setDraftRect(null)

      if (!geometry) return
      if (geometry.width * size.width < MIN_RECT_SIZE || geometry.height * size.height < MIN_RECT_SIZE) return

      onAddAnnotation({
        id: createId('a'),
        frameId,
        type: 'rect',
        geometry,
        text: '',
        style: {
          stroke: '#ffd45a',
          fill: 'rgba(255, 212, 90, 0.12)',
          strokeWidth: 2,
        },
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      return
    }

    if (draftArrow) {
      const geometry = normalizeArrow(draftArrow, size)
      setDraftArrow(null)

      if (!geometry) return
      if (getArrowLength(draftArrow) < MIN_ARROW_SIZE) return

      onAddAnnotation({
        id: createId('a'),
        frameId,
        type: 'arrow',
        geometry,
        text: '',
        style: {
          stroke: '#ff4d4d',
          fill: '#ff4d4d',
          strokeWidth: 3,
          pointerLength: 12,
          pointerWidth: 12,
        },
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    }
  }

  const startRectMove = (annotationId, event) => {
    const annotation = annotations.find((item) => item.id === annotationId)
    const pointer = event.target.getStage()?.getPointerPosition?.()
    if (!annotation || !pointer) return

    setDragState({
      type: annotation.type,
      kind: 'move',
      annotationId,
      originalRect: denormalizeRect(annotation.geometry, size),
      startPoint: pointer,
    })
  }

  const startRectResize = (annotationId, handle, event) => {
    const annotation = annotations.find((item) => item.id === annotationId)
    const pointer = event.target.getStage()?.getPointerPosition?.()
    if (!annotation || !pointer) return

    setDragState({
      type: annotation.type,
      kind: 'resize',
      annotationId,
      handle,
      originalRect: denormalizeRect(annotation.geometry, size),
      startPoint: pointer,
    })
  }

  const startArrowDrag = (annotationId, kind, handle, event) => {
    const annotation = annotations.find((item) => item.id === annotationId)
    const pointer = event.target.getStage()?.getPointerPosition?.()
    if (!annotation || !pointer) return

    setDragState({
      type: 'arrow',
      kind,
      handle,
      annotationId,
      originalArrow: denormalizeArrow(annotation.geometry, size),
      startPoint: pointer,
    })
  }

  const openAnnotationContextMenu = (annotationId, event) => {
    event.evt?.preventDefault?.()
    event.cancelBubble = true
    if (!selectedAnnotationIds.includes(annotationId)) return
    onAObjectContextMenu?.(annotationId, event.evt.clientX, event.evt.clientY)
  }

  return (
    <Stage
      className="annotation-stage"
      height={size.height}
      onContextMenu={handleContextMenu}
      onDblClick={handleDoubleClick}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      width={size.width}
    >
      <Layer>
        {annotations.map((annotation) => {
          const isSelected = selectedAnnotationIds.includes(annotation.id)

          if (annotation.type === 'rect') {
            const rect = denormalizeRect(annotation.geometry, size)
            return (
              <ResizableRect
                annotation={annotation}
                isSelected={isSelected}
                key={annotation.id}
                onContextMenu={openAnnotationContextMenu}
                onDragStart={startRectMove}
                onHandleDragStart={startRectResize}
                onSelect={onSelectAnnotation}
                rect={rect}
              />
            )
          }

          if (annotation.type === 'text') {
            const rect = denormalizeRect(getTextRect(annotation), size)
            const textPadding = TEXT_PADDING * displayScale
            const fontSize = (annotation.style?.fontSize || 18) * displayScale
            return (
              <Group
                key={annotation.id}
                onDblClick={() => onEditTextAnnotation?.(annotation.id)}
                onContextMenu={(event) => openAnnotationContextMenu(annotation.id, event)}
                onMouseDown={(event) => {
                  event.cancelBubble = true
                  if (event.evt?.button === 2) return
                  onSelectAnnotation(annotation.id, event)
                  startRectMove(annotation.id, event)
                }}
              >
                <Rect
                  dash={isSelected ? undefined : [3, 3]}
                  fill="rgba(255, 255, 255, 0.01)"
                  height={rect.height}
                  stroke={isSelected ? 'rgba(255, 0, 0, 0.9)' : 'rgba(255, 0, 0, 0.2)'}
                  strokeWidth={isSelected ? 2 : 1}
                  width={rect.width}
                  x={rect.x}
                  y={rect.y}
                />
                <KonvaText
                  fill={annotation.style?.fill || '#ff4d4d'}
                  fontFamily="Arial"
                  fontSize={fontSize}
                  height={Math.max(1, rect.height - textPadding * 2)}
                  listening={false}
                  text={annotation.text || ''}
                  width={Math.max(1, rect.width - textPadding * 2)}
                  x={rect.x + textPadding}
                  y={rect.y + textPadding}
                />
                {isSelected ? (
                  <ResizableRect
                    annotation={annotation}
                    bodyVisible={false}
                    isSelected
                    onDragStart={startRectMove}
                    onHandleDragStart={startRectResize}
                    onSelect={onSelectAnnotation}
                    rect={rect}
                  />
                ) : null}
              </Group>
            )
          }

          if (annotation.type === 'arrow') {
            const arrow = denormalizeArrow(annotation.geometry, size)
            const strokeWidth = (annotation.style?.strokeWidth || 3) * displayScale
            const selectedStrokeWidth = Math.max(strokeWidth + displayScale, 4 * displayScale)
            const pointerLength = (annotation.style?.pointerLength || 12) * displayScale
            const pointerWidth = (annotation.style?.pointerWidth || 12) * displayScale
            return (
              <Group key={annotation.id}>
                <Arrow
                  fill={annotation.style?.fill || '#ff4d4d'}
                  onContextMenu={(event) => openAnnotationContextMenu(annotation.id, event)}
                  onMouseDown={(event) => {
                    const position = getPointerPosition(event)
                    event.cancelBubble = true
                    if (event.evt?.button === 2) return
                    onSelectAnnotation(annotation.id, event)

                    if (!position) return
                    const handle = findArrowHandle(position, arrow)
                    if (handle) {
                      startArrowDrag(annotation.id, 'resize', handle, event)
                      return
                    }
                    if (isPointNearArrow(position, arrow)) {
                      startArrowDrag(annotation.id, 'move', null, event)
                    }
                  }}
                  pointerLength={pointerLength}
                  pointerWidth={pointerWidth}
                  points={[arrow.x1, arrow.y1, arrow.x2, arrow.y2]}
                  stroke={isSelected ? '#111' : annotation.style?.stroke || '#ff4d4d'}
                  strokeWidth={isSelected ? selectedStrokeWidth : strokeWidth}
                />
                <Arrow
                  fill="rgba(0, 0, 0, 0)"
                  onContextMenu={(event) => openAnnotationContextMenu(annotation.id, event)}
                  onMouseDown={(event) => {
                    event.cancelBubble = true
                    if (event.evt?.button === 2) return
                    onSelectAnnotation(annotation.id, event)
                    startArrowDrag(annotation.id, 'move', null, event)
                  }}
                  pointerLength={pointerLength}
                  pointerWidth={pointerWidth}
                  points={[arrow.x1, arrow.y1, arrow.x2, arrow.y2]}
                  stroke="rgba(0, 0, 0, 0)"
                  strokeWidth={18}
                />
                {isSelected ? getArrowHandles(arrow).map((handle) => (
                  <Rect
                    fill="#000"
                    height={handle.height}
                    key={handle.name}
                    onMouseDown={(event) => {
                      event.cancelBubble = true
                      if (event.evt?.button === 2) return
                      startArrowDrag(annotation.id, 'resize', handle.name, event)
                    }}
                    stroke="#fff"
                    strokeWidth={1}
                    width={handle.width}
                    x={handle.x}
                    y={handle.y}
                  />
                )) : null}
              </Group>
            )
          }

          return null
        })}

        {draftRect ? (
          <Rect
            fill="rgba(255, 212, 90, 0.08)"
            height={draftRect.height}
            stroke="#ffd45a"
            strokeWidth={2}
            width={draftRect.width}
            x={draftRect.x}
            y={draftRect.y}
          />
        ) : null}

        {draftArrow ? (
          <Arrow
            fill="#ff4d4d"
            pointerLength={12 * displayScale}
            pointerWidth={12 * displayScale}
            points={[draftArrow.x1, draftArrow.y1, draftArrow.x2, draftArrow.y2]}
            stroke="#ff4d4d"
            strokeWidth={2 * displayScale}
          />
        ) : null}
      </Layer>
    </Stage>
  )
}
