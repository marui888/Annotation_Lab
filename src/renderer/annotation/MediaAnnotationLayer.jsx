import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Arrow, Circle, Group, Layer, Line, Rect, Stage, Text as KonvaText } from 'react-konva'
import { createId } from '../core/id'
import {
  clampPointToSize,
  clampRectToSize,
  denormalizeArrow,
  denormalizePolygon,
  denormalizeRect,
  moveArrowByDelta,
  movePolygonByDelta,
  normalizeArrow,
  normalizePolygon,
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
import {
  constrainPointToOrthogonal,
  getPointDistance,
  getPolygonArea,
  hasPolygonSelfIntersection,
  isPointInPolygon,
  toFlatPoints,
} from './polygonInteraction'

const MIN_RECT_SIZE = 4
const MIN_ARROW_SIZE = 8
const MIN_POLYGON_POINT_DISTANCE = 8
const POLYGON_CLOSE_DISTANCE = 10
const POLYGON_EDGE_HIT_WIDTH = 14
const POLYGON_VERTEX_RADIUS = 5
const POLYGON_DRAG_THRESHOLD = 3
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

function areCircularEdgesContiguous(edgeIndices, edgeCount) {
  if (edgeIndices.length <= 1) return true
  const sorted = [...new Set(edgeIndices)].sort((left, right) => left - right)
  if (sorted.length >= edgeCount) return false
  let gapCount = 0
  sorted.forEach((edgeIndex, index) => {
    const nextIndex = sorted[(index + 1) % sorted.length]
    if ((edgeIndex + 1) % edgeCount !== nextIndex) gapCount += 1
  })
  return gapCount <= 1
}

function getRetainedPolygonPath(points, deletedEdgeIndices) {
  if (points.length < 3 || deletedEdgeIndices.length === 0) return []
  const deletedSet = new Set(deletedEdgeIndices)
  if (deletedSet.size >= points.length) return []
  const firstDeletedEdge = deletedEdgeIndices.find((edgeIndex) => (
    !deletedSet.has((edgeIndex - 1 + points.length) % points.length)
  ))
  if (!Number.isInteger(firstDeletedEdge)) return []

  let lastDeletedEdge = firstDeletedEdge
  while (deletedSet.has((lastDeletedEdge + 1) % points.length)) {
    lastDeletedEdge = (lastDeletedEdge + 1) % points.length
  }

  const retainedPoints = []
  let vertexIndex = (lastDeletedEdge + 1) % points.length
  retainedPoints.push(points[vertexIndex])
  while (vertexIndex !== firstDeletedEdge) {
    vertexIndex = (vertexIndex + 1) % points.length
    retainedPoints.push(points[vertexIndex])
  }
  return retainedPoints
}

function getRepairOpenPath(repair, candidatePoint = null) {
  if (!repair) return []
  const basePoints = repair.drawingFrom === 'start'
    ? [...repair.retainedPoints].reverse()
    : repair.retainedPoints
  return [
    ...basePoints,
    ...(repair.addedPoints || []),
    ...(candidatePoint ? [candidatePoint] : []),
  ]
}

function isOrthogonalSegment(start, end) {
  return Math.abs(start.x - end.x) < 0.5 || Math.abs(start.y - end.y) < 0.5
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
  onToolModeChange,
  onUpdateAnnotation,
  selectedAnnotationIds = [],
  size,
  displayScale = 1,
}) {
  const [draftRect, setDraftRect] = useState(null)
  const [draftArrow, setDraftArrow] = useState(null)
  const [draftPolygonPoints, setDraftPolygonPoints] = useState([])
  const [polygonHoverPoint, setPolygonHoverPoint] = useState(null)
  const [polygonHoverOrthogonal, setPolygonHoverOrthogonal] = useState(false)
  const [dragState, setDragState] = useState(null)
  const [hoveredPolygonEdge, setHoveredPolygonEdge] = useState(null)
  const [selectedPolygonEdges, setSelectedPolygonEdges] = useState(null)
  const [pendingPolygonEdgeDelete, setPendingPolygonEdgeDelete] = useState(null)
  const [polygonRepair, setPolygonRepair] = useState(null)
  const stageRef = useRef(null)
  const suppressPolygonClickRef = useRef(false)

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

  const selectPolygonEdge = (annotationId, edgeIndex, edgeCount, additive) => {
    setSelectedPolygonEdges((current) => {
      if (!additive || current?.annotationId !== annotationId) {
        return { annotationId, edgeIndices: [edgeIndex] }
      }

      const alreadySelected = current.edgeIndices.includes(edgeIndex)
      const nextEdgeIndices = alreadySelected
        ? current.edgeIndices.filter((index) => index !== edgeIndex)
        : [...current.edgeIndices, edgeIndex]
      if (nextEdgeIndices.length === 0) return null
      if (!areCircularEdgesContiguous(nextEdgeIndices, edgeCount)) return current
      return { annotationId, edgeIndices: nextEdgeIndices }
    })
  }

  const confirmPolygonEdgeDelete = () => {
    if (!pendingPolygonEdgeDelete) return
    if (pendingPolygonEdgeDelete.repairBoundaries?.length) {
      setPolygonRepair((current) => {
        if (!current || current.annotationId !== pendingPolygonEdgeDelete.annotationId) return current
        const deleteStart = pendingPolygonEdgeDelete.repairBoundaries.includes('start')
        const deleteEnd = pendingPolygonEdgeDelete.repairBoundaries.includes('end')
        const startIndex = deleteStart ? 1 : 0
        const endIndex = current.retainedPoints.length - (deleteEnd ? 1 : 0)
        const retainedPoints = current.retainedPoints.slice(startIndex, endIndex)
        if (retainedPoints.length < 2) return current
        return {
          ...current,
          retainedPoints,
          selectedBoundaryEdges: [],
          hoveredBoundaryEdge: null,
        }
      })
      setPendingPolygonEdgeDelete(null)
      return
    }

    const annotation = annotations.find((item) => item.id === pendingPolygonEdgeDelete.annotationId)
    const points = annotation?.type === 'polygon'
      ? denormalizePolygon(annotation.geometry, size)
      : []
    const retainedPoints = getRetainedPolygonPath(points, pendingPolygonEdgeDelete.edgeIndices)
    if (retainedPoints.length < 2) {
      setPendingPolygonEdgeDelete(null)
      return
    }

    setPolygonRepair({
      annotationId: annotation.id,
      retainedPoints,
      drawingFrom: null,
      addedPoints: [],
      hoverPoint: null,
      hoverOrthogonal: false,
      selectedBoundaryEdges: [],
      hoveredBoundaryEdge: null,
    })
    setDraftPolygonPoints([])
    setPolygonHoverPoint(null)
    setPolygonHoverOrthogonal(false)
    setDraftRect(null)
    setDraftArrow(null)
    setSelectedPolygonEdges(null)
    setHoveredPolygonEdge(null)
    setPendingPolygonEdgeDelete(null)
  }

  const startPolygonRepair = (endpoint) => {
    setPolygonRepair((current) => current ? {
      ...current,
      drawingFrom: endpoint,
      addedPoints: [],
      hoverPoint: null,
      hoverOrthogonal: false,
      selectedBoundaryEdges: [],
      hoveredBoundaryEdge: null,
    } : current)
  }

  const selectPolygonRepairBoundaryEdge = (boundary, additive) => {
    setPolygonRepair((current) => {
      if (!current || current.drawingFrom || current.retainedPoints.length <= 2) return current
      const selected = current.selectedBoundaryEdges || []
      const alreadySelected = selected.includes(boundary)
      const nextSelected = additive
        ? alreadySelected
          ? selected.filter((item) => item !== boundary)
          : [...selected, boundary]
        : [boundary]
      if (current.retainedPoints.length - nextSelected.length < 2) return current
      return {
        ...current,
        selectedBoundaryEdges: nextSelected,
      }
    })
  }

  const completePolygonRepair = (repair) => {
    const nextPoints = getRepairOpenPath(repair)
    if (nextPoints.length < 3 || hasPolygonSelfIntersection(nextPoints, true) || getPolygonArea(nextPoints) < 1) {
      return false
    }
    const geometry = normalizePolygon(nextPoints, size)
    if (!geometry) return false
    onUpdateAnnotation(repair.annotationId, {
      geometry,
      updatedAt: new Date().toISOString(),
    })
    setPolygonRepair(null)
    return true
  }

  const addPolygonRepairPoint = (position, constrainOrthogonal = false) => {
    if (!polygonRepair?.drawingFrom) return
    const targetPoint = polygonRepair.drawingFrom === 'start'
      ? polygonRepair.retainedPoints[polygonRepair.retainedPoints.length - 1]
      : polygonRepair.retainedPoints[0]
    const openPath = getRepairOpenPath(polygonRepair)
    const lastPoint = openPath[openPath.length - 1]
    const nextPosition = constrainOrthogonal && lastPoint
      ? clampPointToSize(constrainPointToOrthogonal(lastPoint, position), size)
      : position

    if (getPointDistance(nextPosition, targetPoint) <= POLYGON_CLOSE_DISTANCE
      && (!constrainOrthogonal || isOrthogonalSegment(lastPoint, targetPoint))) {
      completePolygonRepair(polygonRepair)
      return
    }
    if (lastPoint && getPointDistance(nextPosition, lastPoint) < MIN_POLYGON_POINT_DISTANCE) return
    const nextPath = getRepairOpenPath(polygonRepair, nextPosition)
    if (hasPolygonSelfIntersection(nextPath, false)) return
    setPolygonRepair((current) => current ? {
      ...current,
      addedPoints: [...current.addedPoints, clampPointToSize(nextPosition, size)],
      hoverPoint: nextPosition,
      hoverOrthogonal: constrainOrthogonal,
    } : current)
  }

  /* Selection can be changed by the canvas, object lists, or workflow panels. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (selectedPolygonEdges && !selectedAnnotationIds.includes(selectedPolygonEdges.annotationId)) {
      setSelectedPolygonEdges(null)
      setHoveredPolygonEdge(null)
    }
    if (polygonRepair && !selectedAnnotationIds.includes(polygonRepair.annotationId)) {
      if (annotations.some((annotation) => annotation.id === polygonRepair.annotationId)) {
        onSelectAnnotation?.(polygonRepair.annotationId)
      } else {
        setPolygonRepair(null)
      }
    }
  }, [annotations, onSelectAnnotation, polygonRepair, selectedAnnotationIds, selectedPolygonEdges])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!selectedPolygonEdges || pendingPolygonEdgeDelete || polygonRepair) return undefined

    const handleDeleteSelectedEdges = (event) => {
      const target = event.target
      const targetTag = target?.tagName?.toLowerCase()
      if (targetTag === 'textarea' || targetTag === 'input' || targetTag === 'select' || target?.isContentEditable) return
      if (event.key !== 'Delete') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
      setPendingPolygonEdgeDelete({
        annotationId: selectedPolygonEdges.annotationId,
        edgeIndices: [...selectedPolygonEdges.edgeIndices],
      })
    }

    window.addEventListener('keydown', handleDeleteSelectedEdges, true)
    return () => window.removeEventListener('keydown', handleDeleteSelectedEdges, true)
  }, [pendingPolygonEdgeDelete, polygonRepair, selectedPolygonEdges])

  useEffect(() => {
    if (!selectedPolygonEdges) return undefined

    const clearEdgeSelectionOutsideCanvas = (event) => {
      const stageContainer = stageRef.current?.container?.()
      if (stageContainer?.contains(event.target)) return
      if (event.target?.closest?.('.dialog-layer')) return
      setSelectedPolygonEdges(null)
      setHoveredPolygonEdge(null)
    }

    document.addEventListener('mousedown', clearEdgeSelectionOutsideCanvas, true)
    return () => document.removeEventListener('mousedown', clearEdgeSelectionOutsideCanvas, true)
  }, [selectedPolygonEdges])

  const completePolygon = useCallback((points = draftPolygonPoints) => {
    if (points.length < 3 || hasPolygonSelfIntersection(points, true) || getPolygonArea(points) < 1) return false
    const geometry = normalizePolygon(points, size)
    if (!geometry) return false

    const now = new Date().toISOString()
    onAddAnnotation?.({
      id: createId('a'),
      frameId,
      type: 'polygon',
      geometry,
      text: '',
      style: {
        stroke: '#ffd45a',
        fill: 'rgba(255, 212, 90, 0.12)',
        strokeWidth: 2,
      },
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    setDraftPolygonPoints([])
    setPolygonHoverPoint(null)
    setPolygonHoverOrthogonal(false)
    return true
  }, [draftPolygonPoints, frameId, onAddAnnotation, size])

  const addPolygonPoint = (position, constrainOrthogonal = false) => {
    const firstPoint = draftPolygonPoints[0]
    const lastPoint = draftPolygonPoints[draftPolygonPoints.length - 1]
    const nextPosition = constrainOrthogonal && lastPoint
      ? clampPointToSize(constrainPointToOrthogonal(lastPoint, position), size)
      : position

    if (firstPoint && draftPolygonPoints.length >= 3
      && getPointDistance(nextPosition, firstPoint) <= POLYGON_CLOSE_DISTANCE
      && (!constrainOrthogonal || isOrthogonalSegment(lastPoint, firstPoint))) {
      completePolygon()
      return
    }

    if (lastPoint && getPointDistance(nextPosition, lastPoint) < MIN_POLYGON_POINT_DISTANCE) return
    const nextPoints = [...draftPolygonPoints, nextPosition]
    if (hasPolygonSelfIntersection(nextPoints, false)) return
    setDraftPolygonPoints(nextPoints)
    setPolygonHoverPoint(nextPosition)
    setPolygonHoverOrthogonal(constrainOrthogonal)
  }

  useEffect(() => {
    if (mode !== 'polygon') return undefined

    const handlePolygonKeyDown = (event) => {
      const targetTag = event.target?.tagName?.toLowerCase()
      if (targetTag === 'textarea' || targetTag === 'input') return

      if (event.key === 'Backspace' && draftPolygonPoints.length > 0) {
        event.preventDefault()
        setDraftPolygonPoints((current) => current.slice(0, -1))
        return
      }

      if (event.key === 'Enter' && draftPolygonPoints.length >= 3) {
        event.preventDefault()
        if (event.ctrlKey && !isOrthogonalSegment(
          draftPolygonPoints[draftPolygonPoints.length - 1],
          draftPolygonPoints[0]
        )) return
        completePolygon()
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        if (draftPolygonPoints.length > 0) {
          setDraftPolygonPoints([])
          setPolygonHoverPoint(null)
          setPolygonHoverOrthogonal(false)
        } else {
          onToolModeChange?.('select')
        }
      }
    }

    window.addEventListener('keydown', handlePolygonKeyDown)
    return () => window.removeEventListener('keydown', handlePolygonKeyDown)
  }, [completePolygon, draftPolygonPoints, mode, onToolModeChange])

  useEffect(() => {
    if (!polygonRepair && !selectedPolygonEdges) return undefined

    const handlePolygonEditKeyDown = (event) => {
      const target = event.target
      const targetTag = target?.tagName?.toLowerCase()
      if (targetTag === 'textarea' || targetTag === 'input' || targetTag === 'select' || target?.isContentEditable) return

      if (event.key === 'Delete' && polygonRepair) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation?.()
        const repairBoundaries = polygonRepair.drawingFrom
          ? []
          : polygonRepair.selectedBoundaryEdges || []
        if (repairBoundaries.length > 0) {
          setPendingPolygonEdgeDelete({
            annotationId: polygonRepair.annotationId,
            repairBoundaries: [...repairBoundaries],
          })
        }
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (polygonRepair) setPolygonRepair(null)
        setSelectedPolygonEdges(null)
        setHoveredPolygonEdge(null)
        return
      }

      if (event.key === 'Backspace' && polygonRepair?.drawingFrom && polygonRepair.addedPoints.length > 0) {
        event.preventDefault()
        event.stopPropagation()
        setPolygonRepair((current) => current ? {
          ...current,
          addedPoints: current.addedPoints.slice(0, -1),
        } : current)
      }
    }

    window.addEventListener('keydown', handlePolygonEditKeyDown, true)
    return () => window.removeEventListener('keydown', handlePolygonEditKeyDown, true)
  }, [polygonRepair, selectedPolygonEdges])

  const handleMouseDown = (event) => {
    if (event.evt?.button === 2) return
    if (event.target !== event.target.getStage()) return
    const position = getPointerPosition(event)
    if (!position || !canUseStage) return

    if (polygonRepair) return

    if (mode === 'select') {
      setSelectedPolygonEdges(null)
      setHoveredPolygonEdge(null)
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

  const handleClick = (event) => {
    if (polygonRepair?.drawingFrom && event.target === event.target.getStage()) {
      const position = getPointerPosition(event)
      if (position && canUseStage) addPolygonRepairPoint(position, Boolean(event.evt?.ctrlKey))
      return
    }
    if (polygonRepair) return
    if (mode !== 'polygon' || event.target !== event.target.getStage()) return
    const position = getPointerPosition(event)
    if (!position || !canUseStage) return
    addPolygonPoint(position, Boolean(event.evt?.ctrlKey))
  }

  const handleContextMenu = (event) => {
    event.evt?.preventDefault?.()
    if (polygonRepair) return
    if (event.target !== event.target.getStage()) return
    onCanvasContextMenu?.(event.evt.clientX, event.evt.clientY)
  }

  const handleDoubleClick = (event) => {
    if (polygonRepair) return
    if (event.target !== event.target.getStage()) return
    if (mode === 'polygon') {
      if (event.evt?.ctrlKey && draftPolygonPoints.length >= 3
        && !isOrthogonalSegment(
          draftPolygonPoints[draftPolygonPoints.length - 1],
          draftPolygonPoints[0]
        )) return
      completePolygon()
      return
    }
    onCanvasDoubleClick?.()
  }

  const handleMouseMove = (event) => {
    const position = getPointerPosition(event)
    if (!position) return

    if (dragState) {
      const dx = position.x - dragState.startPoint.x
      const dy = position.y - dragState.startPoint.y
      const dragDistance = Math.hypot(dx, dy)

      if ((dragState.type === 'polygon' || dragState.type === 'polygon-repair')
        && !dragState.moved && dragDistance < POLYGON_DRAG_THRESHOLD) {
        return
      }
      if (!dragState.moved && (dragState.type === 'polygon' || dragState.type === 'polygon-repair')) {
        setDragState((current) => current ? { ...current, moved: true } : current)
      }

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
        return
      }

      if (dragState.type === 'polygon') {
        let nextPoints
        if (dragState.kind === 'move' || dragState.kind === 'edge') {
          nextPoints = movePolygonByDelta(dragState.originalPoints, dx, dy, size)
        } else {
          nextPoints = dragState.originalPoints.map((point, index) => (
            index === dragState.vertexIndex ? clampPointToSize(position, size) : point
          ))
          if (hasPolygonSelfIntersection(nextPoints, true) || getPolygonArea(nextPoints) < 1) return
        }
        const geometry = normalizePolygon(nextPoints, size)
        if (geometry) onUpdateAnnotation(dragState.annotationId, { geometry })
      }

      if (dragState.type === 'polygon-repair') {
        const nextRetainedPoints = dragState.originalPoints.map((point, index) => (
          index === dragState.vertexIndex ? clampPointToSize(position, size) : point
        ))
        const candidateRepair = {
          ...polygonRepair,
          retainedPoints: nextRetainedPoints,
        }
        const candidatePath = getRepairOpenPath(candidateRepair)
        if (hasPolygonSelfIntersection(candidatePath, false)) return
        setPolygonRepair(candidateRepair)
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
      return
    }

    if (polygonRepair?.drawingFrom) {
      const openPath = getRepairOpenPath(polygonRepair)
      const lastPoint = openPath[openPath.length - 1]
      const hoverPoint = event.evt?.ctrlKey && lastPoint
        ? clampPointToSize(constrainPointToOrthogonal(lastPoint, position), size)
        : position
      setPolygonRepair((current) => current ? {
        ...current,
        hoverPoint,
        hoverOrthogonal: Boolean(event.evt?.ctrlKey),
      } : current)
      return
    }

    if (mode === 'polygon' && draftPolygonPoints.length > 0) {
      const lastPoint = draftPolygonPoints[draftPolygonPoints.length - 1]
      setPolygonHoverPoint(event.evt?.ctrlKey && lastPoint
        ? clampPointToSize(constrainPointToOrthogonal(lastPoint, position), size)
        : position)
      setPolygonHoverOrthogonal(Boolean(event.evt?.ctrlKey))
    }
  }

  const handleMouseUp = () => {
    if (dragState) {
      if (dragState.type === 'polygon' && !dragState.moved) {
        if (dragState.kind === 'edge') {
          selectPolygonEdge(
            dragState.annotationId,
            dragState.edgeIndex,
            dragState.originalPoints.length,
            dragState.additive
          )
        } else if (dragState.kind === 'vertex') {
          setSelectedPolygonEdges(null)
          setHoveredPolygonEdge(null)
        }
      } else if (dragState.moved || (dragState.type !== 'polygon' && dragState.type !== 'polygon-repair')) {
        if (dragState.type !== 'polygon-repair') {
          onUpdateAnnotation(dragState.annotationId, {
            updatedAt: new Date().toISOString(),
          })
        }
      }
      suppressPolygonClickRef.current = Boolean(
        dragState.type === 'polygon-repair' && dragState.moved
      )
      if (suppressPolygonClickRef.current) {
        window.setTimeout(() => {
          suppressPolygonClickRef.current = false
        }, 0)
      }
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
      const arrowLength = getArrowLength(draftArrow)
      const geometry = normalizeArrow(draftArrow, size)
      setDraftArrow(null)

      if (arrowLength < MIN_ARROW_SIZE) {
        onToolModeChange?.('select')
        return
      }
      if (!geometry) return

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
    if (polygonRepair) return
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
    if (polygonRepair) return
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
    if (polygonRepair) return
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

  const startPolygonDrag = (annotationId, kind, vertexIndex, event, edgeIndex = null) => {
    if (polygonRepair) return
    const annotation = annotations.find((item) => item.id === annotationId)
    const pointer = event.target.getStage()?.getPointerPosition?.()
    if (!annotation || !pointer) return

    setDragState({
      type: 'polygon',
      kind,
      vertexIndex,
      edgeIndex,
      additive: Boolean(event.evt?.ctrlKey || event.evt?.metaKey),
      annotationId,
      originalPoints: denormalizePolygon(annotation.geometry, size),
      startPoint: pointer,
      moved: false,
    })
  }

  const startPolygonRepairVertexDrag = (vertexIndex, event) => {
    const pointer = event.target.getStage()?.getPointerPosition?.()
    if (!polygonRepair || !pointer) return
    setPolygonRepair((current) => current ? {
      ...current,
      selectedBoundaryEdges: [],
      hoveredBoundaryEdge: null,
    } : current)
    setDragState({
      type: 'polygon-repair',
      kind: 'vertex',
      vertexIndex,
      annotationId: polygonRepair.annotationId,
      originalPoints: polygonRepair.retainedPoints,
      startPoint: pointer,
      moved: false,
    })
  }

  const selectInnermostPolygon = (point, event) => {
    if (polygonRepair) return
    const candidates = annotations
      .map((annotation, index) => ({
        annotation,
        index,
        points: annotation.type === 'polygon' ? denormalizePolygon(annotation.geometry, size) : [],
      }))
      .filter((entry) => entry.annotation.type === 'polygon' && isPointInPolygon(point, entry.points))
      .sort((left, right) => getPolygonArea(left.points) - getPolygonArea(right.points) || right.index - left.index)
    const target = candidates[0]?.annotation
    if (target) {
      setSelectedPolygonEdges(null)
      setHoveredPolygonEdge(null)
      onSelectAnnotation(target.id, event)
    }
  }

  const polygonHoverCloses = Boolean(
    polygonHoverPoint
    && draftPolygonPoints.length >= 3
    && getPointDistance(polygonHoverPoint, draftPolygonPoints[0]) <= POLYGON_CLOSE_DISTANCE
    && (!polygonHoverOrthogonal || isOrthogonalSegment(
      draftPolygonPoints[draftPolygonPoints.length - 1],
      draftPolygonPoints[0]
    ))
  )
  const polygonHoverInvalid = polygonHoverPoint && draftPolygonPoints.length > 0
    ? polygonHoverCloses
      ? hasPolygonSelfIntersection(draftPolygonPoints, true)
      : hasPolygonSelfIntersection([...draftPolygonPoints, polygonHoverPoint], false)
    : false
  const polygonRepairTarget = polygonRepair?.drawingFrom === 'start'
    ? polygonRepair.retainedPoints[polygonRepair.retainedPoints.length - 1]
    : polygonRepair?.drawingFrom === 'end'
      ? polygonRepair.retainedPoints[0]
      : null
  const polygonRepairHoverCloses = Boolean(
    polygonRepair?.hoverPoint
    && polygonRepairTarget
    && getPointDistance(polygonRepair.hoverPoint, polygonRepairTarget) <= POLYGON_CLOSE_DISTANCE
    && (!polygonRepair.hoverOrthogonal || isOrthogonalSegment(
      getRepairOpenPath(polygonRepair)[getRepairOpenPath(polygonRepair).length - 1],
      polygonRepairTarget
    ))
  )
  const polygonRepairHoverInvalid = polygonRepair?.drawingFrom && polygonRepair?.hoverPoint
    ? polygonRepairHoverCloses
      ? hasPolygonSelfIntersection(getRepairOpenPath(polygonRepair), true)
        || getPolygonArea(getRepairOpenPath(polygonRepair)) < 1
      : hasPolygonSelfIntersection(getRepairOpenPath(polygonRepair, polygonRepair.hoverPoint), false)
    : false

  const openAnnotationContextMenu = (annotationId, event) => {
    event.evt?.preventDefault?.()
    event.cancelBubble = true
    if (polygonRepair) return
    if (!selectedAnnotationIds.includes(annotationId)) return
    onAObjectContextMenu?.(annotationId, event.evt.clientX, event.evt.clientY)
  }

  const selectAnnotationUnlessRepairing = (annotationId, event) => {
    if (polygonRepair) return
    onSelectAnnotation?.(annotationId, event)
  }

  return (
    <>
    <Stage
      className="annotation-stage"
      height={size.height}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onDblClick={handleDoubleClick}
      onMouseLeave={() => {
        setPolygonHoverPoint(null)
        setPolygonHoverOrthogonal(false)
        setHoveredPolygonEdge(null)
        if (polygonRepair?.drawingFrom) {
          setPolygonRepair((current) => current ? {
            ...current,
            hoverPoint: null,
            hoverOrthogonal: false,
          } : current)
        }
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      ref={stageRef}
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
                onSelect={selectAnnotationUnlessRepairing}
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
                onDblClick={() => {
                  if (!polygonRepair) onEditTextAnnotation?.(annotation.id)
                }}
                onContextMenu={(event) => openAnnotationContextMenu(annotation.id, event)}
                onMouseDown={(event) => {
                  event.cancelBubble = true
                  if (event.evt?.button === 2) return
                  selectAnnotationUnlessRepairing(annotation.id, event)
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
                    onSelect={selectAnnotationUnlessRepairing}
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
                    selectAnnotationUnlessRepairing(annotation.id, event)

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
                    selectAnnotationUnlessRepairing(annotation.id, event)
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

          if (annotation.type === 'polygon') {
            const points = denormalizePolygon(annotation.geometry, size)
            const flatPoints = toFlatPoints(points)
            const activeRepair = polygonRepair?.annotationId === annotation.id ? polygonRepair : null
            const selectedEdgeIndices = selectedPolygonEdges?.annotationId === annotation.id
              ? selectedPolygonEdges.edgeIndices
              : []

            if (activeRepair) {
              const firstEndpointIndex = 0
              const lastEndpointIndex = activeRepair.retainedPoints.length - 1
              const drawingSource = activeRepair.drawingFrom === 'start'
                ? activeRepair.retainedPoints[firstEndpointIndex]
                : activeRepair.drawingFrom === 'end'
                  ? activeRepair.retainedPoints[lastEndpointIndex]
                  : null
              const drawnRepairPoints = drawingSource
                ? [drawingSource, ...activeRepair.addedPoints]
                : []
              const repairBoundaryEdges = !activeRepair.drawingFrom && activeRepair.retainedPoints.length > 2
                ? [
                    {
                      boundary: 'start',
                      points: [activeRepair.retainedPoints[0], activeRepair.retainedPoints[1]],
                    },
                    {
                      boundary: 'end',
                      points: [
                        activeRepair.retainedPoints[activeRepair.retainedPoints.length - 2],
                        activeRepair.retainedPoints[activeRepair.retainedPoints.length - 1],
                      ],
                    },
                  ]
                : []
              return (
                <Group key={annotation.id}>
                  <Line
                    points={toFlatPoints(activeRepair.retainedPoints)}
                    stroke="#ffd45a"
                    strokeWidth={3}
                  />
                  {repairBoundaryEdges.map((edge) => {
                    const selected = activeRepair.selectedBoundaryEdges?.includes(edge.boundary)
                    const hovered = activeRepair.hoveredBoundaryEdge === edge.boundary
                    if (!selected && !hovered) return null
                    return (
                      <Line
                        key={`repair-boundary-highlight-${edge.boundary}`}
                        listening={false}
                        points={toFlatPoints(edge.points)}
                        stroke={selected ? '#ff4d4d' : '#4dd0e1'}
                        strokeWidth={selected ? 5 : 3}
                      />
                    )
                  })}
                  {repairBoundaryEdges.map((edge) => (
                    <Line
                      key={`repair-boundary-${edge.boundary}`}
                      onMouseEnter={() => setPolygonRepair((current) => current ? {
                        ...current,
                        hoveredBoundaryEdge: edge.boundary,
                      } : current)}
                      onMouseLeave={() => setPolygonRepair((current) => (
                        current?.hoveredBoundaryEdge === edge.boundary
                          ? { ...current, hoveredBoundaryEdge: null }
                          : current
                      ))}
                      onMouseDown={(event) => {
                        event.cancelBubble = true
                        if (event.evt?.button === 2) return
                        selectPolygonRepairBoundaryEdge(edge.boundary, Boolean(event.evt?.ctrlKey))
                      }}
                      points={toFlatPoints(edge.points)}
                      stroke="rgba(0, 0, 0, 0)"
                      strokeWidth={POLYGON_EDGE_HIT_WIDTH}
                    />
                  ))}
                  {drawnRepairPoints.length > 1 ? (
                    <Line
                      points={toFlatPoints(drawnRepairPoints)}
                      stroke="#ffd45a"
                      strokeWidth={3}
                    />
                  ) : null}
                  {drawingSource && activeRepair.hoverPoint ? (
                    <Line
                      dash={[6, 4]}
                      points={[
                        drawnRepairPoints[drawnRepairPoints.length - 1].x,
                        drawnRepairPoints[drawnRepairPoints.length - 1].y,
                        activeRepair.hoverPoint.x,
                        activeRepair.hoverPoint.y,
                      ]}
                      stroke={polygonRepairHoverInvalid ? '#ff4949' : '#4dd0e1'}
                      strokeWidth={2}
                    />
                  ) : null}
                  {activeRepair.addedPoints.map((point, index) => (
                    <Circle
                      fill="#ffd45a"
                      key={`repair-added-${index}`}
                      listening={false}
                      radius={4}
                      stroke="#111"
                      strokeWidth={1}
                      x={point.x}
                      y={point.y}
                    />
                  ))}
                  {activeRepair.retainedPoints.map((point, index) => {
                    const endpoint = index === firstEndpointIndex
                      ? 'start'
                      : index === lastEndpointIndex
                        ? 'end'
                        : null
                    const isTarget = endpoint && polygonRepairTarget === point
                    return (
                      <Circle
                        fill={endpoint ? isTarget && polygonRepairHoverCloses
                          ? polygonRepairHoverInvalid ? '#ff4949' : '#4caf50'
                          : '#4caf50' : '#ffd45a'}
                        hitStrokeWidth={POLYGON_EDGE_HIT_WIDTH}
                        key={`repair-vertex-${index}`}
                        onClick={(event) => {
                          event.cancelBubble = true
                          if (suppressPolygonClickRef.current) {
                            suppressPolygonClickRef.current = false
                            return
                          }
                          if (!endpoint) return
                          if (!activeRepair.drawingFrom) {
                            startPolygonRepair(endpoint)
                            return
                          }
                          if (isTarget) {
                            const openPath = getRepairOpenPath(activeRepair)
                            const lastPoint = openPath[openPath.length - 1]
                            if (!event.evt?.ctrlKey || isOrthogonalSegment(lastPoint, polygonRepairTarget)) {
                              completePolygonRepair(activeRepair)
                            }
                          }
                        }}
                        onMouseDown={(event) => {
                          event.cancelBubble = true
                          if (event.evt?.button === 2) return
                          startPolygonRepairVertexDrag(index, event)
                        }}
                        radius={endpoint ? 7 : POLYGON_VERTEX_RADIUS}
                        stroke="#fff"
                        strokeWidth={1}
                        x={point.x}
                        y={point.y}
                      />
                    )
                  })}
                </Group>
              )
            }

            return (
              <Group
                key={annotation.id}
                onContextMenu={(event) => openAnnotationContextMenu(annotation.id, event)}
              >
                <Line
                  closed
                  fill={annotation.style?.fill || 'rgba(255, 212, 90, 0.12)'}
                  onMouseDown={(event) => {
                    event.cancelBubble = true
                    if (event.evt?.button === 2) return
                    const pointer = getPointerPosition(event)
                    if (pointer) selectInnermostPolygon(pointer, event)
                  }}
                  points={flatPoints}
                  stroke={isSelected ? '#ffd45a' : annotation.style?.stroke || '#ffd45a'}
                  strokeWidth={isSelected ? 3 : annotation.style?.strokeWidth || 2}
                />
                {isSelected ? points.map((point, index) => {
                  const nextPoint = points[(index + 1) % points.length]
                  const isEdgeSelected = selectedEdgeIndices.includes(index)
                  const isEdgeHovered = hoveredPolygonEdge?.annotationId === annotation.id
                    && hoveredPolygonEdge.edgeIndex === index
                  if (!isEdgeSelected && !isEdgeHovered) return null
                  return (
                    <Line
                      key={`edge-highlight-${index}`}
                      listening={false}
                      points={[point.x, point.y, nextPoint.x, nextPoint.y]}
                      stroke={isEdgeSelected ? '#ff4d4d' : '#4dd0e1'}
                      strokeWidth={isEdgeSelected ? 5 : 3}
                    />
                  )
                }) : null}
                {isSelected ? points.map((point, index) => {
                  const nextPoint = points[(index + 1) % points.length]
                  return (
                    <Line
                      key={`edge-${index}`}
                      onMouseEnter={() => setHoveredPolygonEdge({ annotationId: annotation.id, edgeIndex: index })}
                      onMouseLeave={() => setHoveredPolygonEdge((current) => (
                        current?.annotationId === annotation.id && current.edgeIndex === index ? null : current
                      ))}
                      onMouseDown={(event) => {
                        event.cancelBubble = true
                        if (event.evt?.button === 2) return
                        startPolygonDrag(annotation.id, 'edge', null, event, index)
                      }}
                      points={[point.x, point.y, nextPoint.x, nextPoint.y]}
                      stroke="rgba(0, 0, 0, 0)"
                      strokeWidth={POLYGON_EDGE_HIT_WIDTH}
                    />
                  )
                }) : null}
                {isSelected ? points.map((point, index) => {
                  const touchesSelectedEdge = selectedEdgeIndices.includes(index)
                    || selectedEdgeIndices.includes((index - 1 + points.length) % points.length)
                  return (
                    <Circle
                    fill={selectedEdgeIndices.length > 0
                      ? touchesSelectedEdge ? '#ff4d4d' : '#8a7430'
                      : '#ffd45a'}
                    hitStrokeWidth={POLYGON_EDGE_HIT_WIDTH}
                    key={`vertex-${index}`}
                    onMouseDown={(event) => {
                      event.cancelBubble = true
                      if (event.evt?.button === 2) return
                      setSelectedPolygonEdges(null)
                      setHoveredPolygonEdge(null)
                      startPolygonDrag(annotation.id, 'vertex', index, event)
                    }}
                    radius={POLYGON_VERTEX_RADIUS}
                    stroke="#111"
                    strokeWidth={1}
                    x={point.x}
                    y={point.y}
                  />
                  )
                }) : null}
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

        {mode === 'polygon' && draftPolygonPoints.length > 0 ? (
          <Group listening={false}>
            <Line
              closed={draftPolygonPoints.length >= 3}
              fill={draftPolygonPoints.length >= 3 ? 'rgba(255, 212, 90, 0.08)' : undefined}
              points={toFlatPoints(draftPolygonPoints)}
              stroke="#ffd45a"
              strokeWidth={2}
            />
            {polygonHoverPoint ? (
              <Line
                dash={[6, 4]}
                points={[
                  draftPolygonPoints[draftPolygonPoints.length - 1].x,
                  draftPolygonPoints[draftPolygonPoints.length - 1].y,
                  polygonHoverPoint.x,
                  polygonHoverPoint.y,
                ]}
                stroke={polygonHoverInvalid ? '#ff4949' : '#ffd45a'}
                strokeWidth={2}
              />
            ) : null}
            {draftPolygonPoints.map((point, index) => (
              <Circle
                fill={index === 0 && polygonHoverCloses
                  ? polygonHoverInvalid ? '#ff4949' : '#4caf50'
                  : '#ffd45a'}
                key={`draft-vertex-${index}`}
                radius={index === 0 ? 6 : 4}
                stroke="#111"
                strokeWidth={1}
                x={point.x}
                y={point.y}
              />
            ))}
          </Group>
        ) : null}
      </Layer>
    </Stage>
    {pendingPolygonEdgeDelete && typeof document !== 'undefined' ? createPortal(
      <div className="dialog-layer">
        <div className="entity-dialog">
          <div className="dialog-title">Delete Polygon Edge</div>
          <dl className="dialog-info">
            <dt>Edges</dt>
            <dd>{pendingPolygonEdgeDelete.repairBoundaries?.length || pendingPolygonEdgeDelete.edgeIndices?.length || 0}</dd>
          </dl>
          <div className="dialog-message">
            {pendingPolygonEdgeDelete.repairBoundaries?.length
              ? 'The selected adjacent edge(s) will extend the current opening. Reconnect its two open endpoints to complete the edit.'
              : 'The Polygon will enter an open repair state. Reconnect its two open endpoints to complete the edit.'}
          </div>
          <div className="dialog-actions">
            <button autoFocus onClick={confirmPolygonEdgeDelete} type="button">Delete</button>
            <button onClick={() => setPendingPolygonEdgeDelete(null)} type="button">Cancel</button>
          </div>
        </div>
      </div>,
      document.body
    ) : null}
    </>
  )
}
