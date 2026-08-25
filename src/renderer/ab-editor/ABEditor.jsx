import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MediaAnnotationLayer from '../annotation/MediaAnnotationLayer'
import BWorkflow from '../workflow/BWorkflow'
import { denormalizeArrow, denormalizeRect } from '../core/geometryTransform'
import { createVideoFrame } from '../media/videoAdapter'
import VideoPlayer from '../video/VideoPlayer'
import APreviewCard from './APreviewCard'
import { loadEditorSessionFromInput } from './abEditorLoader'

const A_OBJECT_DRAG_TYPE = 'application/x-annotation-lab-a-object'
const VIDEO_CONTROL_ROW_HEIGHT = 38
const B_WORKFLOW_MIN_WIDTH = 260
const B_WORKFLOW_MAX_WIDTH = 760
const INSPECTOR_MIN_WIDTH = 220
const INSPECTOR_MAX_WIDTH = 520
const MIN_MEDIA_VIEW_HEIGHT = 80
const MIN_A_PREVIEW_HEIGHT = 80
const DEFAULT_AB_LAYOUT = {
  bWorkflowWidth: 420,
  inspectorWidth: 300,
  aPreviewHeight: 128,
  bWorkflowBottomPanelHeight: 118,
}

function VideoFramePanel({
  annotations,
  bindFrameRequest,
  cancelTextEdit,
  commitTextEdit,
  currentFrame,
  displayScale,
  editingTextAnnotation,
  editingTextBox,
  frameSurfaceStyle,
  imageDisplaySize,
  onAddAnnotation,
  onAddTextAnnotation,
  onBindCurrentVideoFrame,
  onAObjectContextMenu,
  onCanvasContextMenu,
  onClearSelection,
  onEditTextAnnotation,
  onMetadata,
  onSelectAnnotation,
  onToolModeChange,
  onUpdateAnnotation,
  onUseVideoFrame,
  playPauseRequestId,
  selectedAnnotationIds,
  showBindFrameOverlay,
  source,
  textDraft,
  toolMode,
  updateTextDraft,
  videoSeekRequest,
}) {
  const playerRef = useRef(null)
  const bindRequestRef = useRef(bindFrameRequest?.id)
  const onMetadataRef = useRef(onMetadata)
  const playPauseRequestRef = useRef(playPauseRequestId)
  const seekRequestRef = useRef(videoSeekRequest?.id)
  const transientTimerRef = useRef(null)
  const [playState, setPlayState] = useState('Paused')
  const [statusText, setStatusText] = useState('Ready')
  const [transientAnnotationIds, setTransientAnnotationIds] = useState([])
  const canAnnotate = Boolean(
    imageDisplaySize
    && (
      ((playState !== 'Playing' || transientAnnotationIds.length > 0) && currentFrame?.id)
      || showBindFrameOverlay
    )
  )
  const visibleAnnotations = showBindFrameOverlay
    ? annotations.filter((annotation) => selectedAnnotationIds.includes(annotation.id))
    : transientAnnotationIds.length > 0
    ? annotations.filter((annotation) => transientAnnotationIds.includes(annotation.id))
    : canAnnotate
      ? annotations.filter((annotation) => annotation.frameId === currentFrame.id)
      : []

  useEffect(() => {
    onMetadataRef.current = onMetadata
  }, [onMetadata])

  const handleVideoReady = () => {
    setStatusText('Video ready')
  }

  const handleVideoLoadedMetadata = (player) => {
    const techElement = player?.tech?.(true)?.el?.() || null
    onMetadataRef.current?.({
      width: techElement?.videoWidth || null,
      height: techElement?.videoHeight || null,
      duration: player.duration() || null,
    })
    setStatusText('Metadata loaded')
  }

  const toggleVideoJsPlay = useCallback(() => {
    const player = playerRef.current
    if (!player) return
    if (player.isPaused()) {
      player.play()
      return
    }
    player.pause()
  }, [])

  const setCurrentPlaybackFrame = useCallback((options = {}) => {
    if (!source || !playerRef.current) return
    const currentTime = playerRef.current.getCurrentTime()
    const videoSize = playerRef.current.getVideoSize()
    const duration = playerRef.current.getDuration()
    const previewUrl = playerRef.current.getFrameDataUrl()
    const nextFrame = createVideoFrame(source, {
      time: currentTime,
      width: videoSize.width,
      height: videoSize.height,
      duration,
    })
    onUseVideoFrame?.(nextFrame, videoSize, previewUrl, { previewOnly: options.previewOnly !== false })
    setPlayState('Paused')
    setStatusText(`Frame ready ${currentTime.toFixed(2)}s`)
  }, [onUseVideoFrame, source])

  const sendBindFrameCandidate = useCallback((annotationIds = []) => {
    if (!source || !playerRef.current) {
      onBindCurrentVideoFrame?.({
        annotationIds,
        time: Number.NaN,
      })
      return
    }

    const currentTime = playerRef.current.getCurrentTime()
    const videoSize = playerRef.current.getVideoSize()
    const duration = playerRef.current.getDuration()
    const previewUrl = playerRef.current.getFrameDataUrl()
    onBindCurrentVideoFrame?.({
      annotationIds,
      duration,
      previewUrl,
      time: currentTime,
      videoSize,
    })
  }, [onBindCurrentVideoFrame, source])

  useEffect(() => {
    if (!bindFrameRequest?.id || bindFrameRequest.id === bindRequestRef.current) return
    bindRequestRef.current = bindFrameRequest.id
    const annotationIds = bindFrameRequest.annotationIds || []
    if (!source || !playerRef.current) {
      sendBindFrameCandidate(annotationIds)
      return
    }

    if (Number.isFinite(bindFrameRequest.time)) {
      playerRef.current.seek(bindFrameRequest.time)
      window.setTimeout(() => sendBindFrameCandidate(annotationIds), 180)
      return
    }

    sendBindFrameCandidate(annotationIds)
  }, [bindFrameRequest, sendBindFrameCandidate, source])

  const rebuildPreviewAtCurrentTime = useCallback((targetFrame) => {
    if (!source || !playerRef.current || !targetFrame) return
    const videoSize = playerRef.current.getVideoSize()
    const duration = playerRef.current.getDuration()
    const previewUrl = playerRef.current.getFrameDataUrl()
    const nextFrame = {
      ...targetFrame,
      meta: {
        ...targetFrame.meta,
        width: videoSize.width || targetFrame.meta?.width || null,
        height: videoSize.height || targetFrame.meta?.height || null,
        duration: duration || targetFrame.meta?.duration || null,
      },
      updatedAt: new Date().toISOString(),
    }
    onUseVideoFrame?.(nextFrame, videoSize, previewUrl)
  }, [onUseVideoFrame, source])

  useEffect(() => {
    if (!playPauseRequestId || playPauseRequestId === playPauseRequestRef.current) return
    playPauseRequestRef.current = playPauseRequestId
    toggleVideoJsPlay()
  }, [playPauseRequestId, toggleVideoJsPlay])

  useEffect(() => {
    if (!videoSeekRequest?.id || videoSeekRequest.id === seekRequestRef.current) return
    seekRequestRef.current = videoSeekRequest.id
    if (!playerRef.current || !Number.isFinite(videoSeekRequest.time)) return

    if (transientTimerRef.current) {
      clearTimeout(transientTimerRef.current)
      transientTimerRef.current = null
    }

    const wasPaused = playerRef.current.isPaused()
    playerRef.current.seek(videoSeekRequest.time)

    const rebuildPreview = () => {
      rebuildPreviewAtCurrentTime({
        id: videoSeekRequest.frameId,
        sourceId: source?.id,
        kind: 'video-frame',
        locator: {
          time: videoSeekRequest.time,
        },
      })
    }

    setTimeout(rebuildPreview, 180)

    if (wasPaused) {
      setTransientAnnotationIds([])
      setStatusText(`Seek ${videoSeekRequest.time.toFixed(2)}s`)
      return
    }

    setTransientAnnotationIds([videoSeekRequest.annotationId])
    setStatusText(`Highlight ${videoSeekRequest.time.toFixed(2)}s`)
    transientTimerRef.current = setTimeout(() => {
      setTransientAnnotationIds([])
      transientTimerRef.current = null
    }, 2000)
  }, [rebuildPreviewAtCurrentTime, source?.id, videoSeekRequest])

  useEffect(() => () => {
    if (transientTimerRef.current) clearTimeout(transientTimerRef.current)
  }, [])

  return (
    <div className="video-viewer">
      <div className="video-frame-viewer" style={frameSurfaceStyle}>
        <VideoPlayer
          onCanPlay={() => setStatusText('Can play')}
          onEnded={() => {
            setPlayState('Ended')
            setStatusText('Ended')
          }}
          onError={(player) => setStatusText(`Error ${player.error()?.code || ''}`)}
          onLoadedData={() => {
            setStatusText('Loaded data')
            if (playerRef.current?.isPaused()) setCurrentPlaybackFrame()
          }}
          onLoadedMetadata={handleVideoLoadedMetadata}
          onPause={() => {
            setPlayState('Paused')
            setCurrentPlaybackFrame()
          }}
          onPlay={() => {
            setPlayState('Playing')
            setTransientAnnotationIds([])
            setStatusText('Playing - annotations hidden')
          }}
          onPlaying={() => setPlayState('Playing')}
          onReady={handleVideoReady}
          onStalled={() => setStatusText('Stalled')}
          onWaiting={() => setStatusText('Waiting')}
          ref={playerRef}
          src={source?.fileUrl}
        />
        {canAnnotate && (showBindFrameOverlay || playState !== 'Playing' || transientAnnotationIds.length > 0) ? (
          <div
            className={transientAnnotationIds.length > 0 ? 'annotation-layer-host video-annotation-layer transient' : 'annotation-layer-host video-annotation-layer'}
            style={frameSurfaceStyle}
          >
            <MediaAnnotationLayer
              annotations={visibleAnnotations}
              displayScale={displayScale}
              frameId={currentFrame?.id || 'bind-preview-frame'}
              mode={toolMode}
              onAddAnnotation={onAddAnnotation}
              onAddTextAnnotation={onAddTextAnnotation}
              onAObjectContextMenu={onAObjectContextMenu}
              onCanvasContextMenu={onCanvasContextMenu}
              onCanvasDoubleClick={() => onToolModeChange('select')}
              onClearSelection={onClearSelection}
              onEditTextAnnotation={onEditTextAnnotation}
              onSelectAnnotation={onSelectAnnotation}
              onUpdateAnnotation={onUpdateAnnotation}
              selectedAnnotationIds={selectedAnnotationIds}
              size={imageDisplaySize}
            />
            {editingTextAnnotation && editingTextBox ? (
              <textarea
                autoFocus
                className="inline-freetext-editor"
                onBlur={commitTextEdit}
                onChange={(event) => updateTextDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelTextEdit()
                  }
                  if (event.key === 'Enter' && event.ctrlKey) {
                    event.preventDefault()
                    commitTextEdit()
                  }
                }}
                onMouseDown={(event) => event.stopPropagation()}
                style={{
                  left: editingTextBox.x,
                  top: editingTextBox.y,
                  width: editingTextBox.width,
                  height: editingTextBox.height,
                  color: editingTextAnnotation.style?.fill || '#ff4d4d',
                  fontSize: `${(editingTextAnnotation.style?.fontSize || 18) * displayScale}px`,
                  padding: `${6 * displayScale}px`,
                }}
                value={textDraft}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="video-debug-bar">
        <button onClick={toggleVideoJsPlay} type="button">Play / Pause</button>
        <span>{playState}</span>
        <span>{statusText}</span>
        <small title={source?.fileUrl}>{source?.fileName || '--'}</small>
      </div>
    </div>
  )
}

export default function ABEditor({
  annotationFilePath,
  annotations,
  bindFrameRequest,
  cancelTextEdit,
  commitTextEdit,
  displayInput,
  displayMessage,
  entities = [],
  editingTextAnnotation,
  ensureAnnotationPreview,
  inspectorContent,
  formatEntityLabel = (entity) => entity.label || entity.id,
  frame,
  framePreviewUrl,
  getAnnotationPreview,
  imageSize,
  initialInput,
  isDirty,
  layoutState = DEFAULT_AB_LAYOUT,
  onAddAnnotation,
  onAddTextAnnotation,
  onBindCurrentVideoFrame,
  onClearSelection,
  onCreateEntity,
  onDeleteSelectedAnnotations,
  onEditTextAnnotation,
  onExportSelectedAnnotationCrop,
  onExportSelectedEntity,
  onImageSizeChange,
  onLayoutStateChange,
  onSessionLoadError,
  onSessionLoaded,
  onSessionLoadStart,
  onSaveAnnotations,
  onOpenAddToEntityDialog,
  onOpenEntityDialog,
  onSelectAnnotation,
  onSelectAnnotations,
  onToolModeChange,
  onUpdateAnnotation,
  onUpdateEntity,
  onUseVideoFrame,
  playPauseRequestId,
  previewAnnotationId,
  saveStatus,
  selectedAnnotationIds,
  selectedEntity,
  showBindFrameOverlay = false,
  source,
  textDraft,
  toolMode,
  updateTextDraft,
  videoSeekRequest,
  zoom,
  zoomMode,
}) {
  const mediaViewRef = useRef(null)
  const workspacePanelsRef = useRef(null)
  const effectiveLayoutState = useMemo(() => ({
    ...DEFAULT_AB_LAYOUT,
    ...layoutState,
  }), [layoutState])
  const [viewSize, setViewSize] = useState(null)
  const bWorkflowWidth = effectiveLayoutState.bWorkflowWidth
  const inspectorWidth = effectiveLayoutState.inspectorWidth
  const aPreviewHeight = effectiveLayoutState.aPreviewHeight
  const bWorkflowBottomPanelHeight = effectiveLayoutState.bWorkflowBottomPanelHeight
  const [resizingWorkspacePart, setResizingWorkspacePart] = useState(null)
  const [isResizingAPreview, setIsResizingAPreview] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)

  const updateLayoutState = useCallback((patch) => {
    onLayoutStateChange?.({
      ...effectiveLayoutState,
      ...patch,
    })
  }, [effectiveLayoutState, onLayoutStateChange])

  useEffect(() => {
    if (!initialInput) return undefined

    let canceled = false
    onSessionLoadStart?.(initialInput)

    loadEditorSessionFromInput(initialInput).then((session) => {
      if (canceled) return
      if (session?.ok) {
        onSessionLoaded?.(session)
        return
      }
      onSessionLoadError?.(session || { ok: false, reason: 'unknown-error' })
    }).catch((error) => {
      if (canceled) return
      onSessionLoadError?.({
        ok: false,
        reason: error?.message || String(error),
      })
    })

    return () => {
      canceled = true
    }
  }, [initialInput])

  useEffect(() => {
    if (!mediaViewRef.current) return undefined

    const updateViewSize = () => {
      const rect = mediaViewRef.current.getBoundingClientRect()
      setViewSize({
        width: rect.width,
        height: rect.height,
      })
    }

    updateViewSize()
    const observer = new ResizeObserver(updateViewSize)
    observer.observe(mediaViewRef.current)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!resizingWorkspacePart) return undefined

    const handleMouseMove = (event) => {
      const rect = workspacePanelsRef.current?.getBoundingClientRect()
      if (!rect) return

      if (resizingWorkspacePart === 'bWorkflow') {
        const nextWidth = Math.max(
          B_WORKFLOW_MIN_WIDTH,
          Math.min(B_WORKFLOW_MAX_WIDTH, rect.right - inspectorWidth - 6 - event.clientX)
        )
        updateLayoutState({ bWorkflowWidth: nextWidth })
        return
      }

      if (resizingWorkspacePart === 'inspector') {
        const nextWidth = Math.max(
          INSPECTOR_MIN_WIDTH,
          Math.min(INSPECTOR_MAX_WIDTH, rect.right - event.clientX)
        )
        updateLayoutState({ inspectorWidth: nextWidth })
      }
    }

    const handleMouseUp = () => setResizingWorkspacePart(null)

    document.body.classList.add('panel-resizing')
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.body.classList.remove('panel-resizing')
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [inspectorWidth, resizingWorkspacePart, updateLayoutState])

  useEffect(() => {
    if (!isResizingAPreview) return undefined

    const handleMouseMove = (event) => {
      const rect = mediaViewRef.current?.parentElement?.getBoundingClientRect()
      if (!rect) return
      const maxPreviewHeight = Math.max(
        MIN_A_PREVIEW_HEIGHT,
        rect.height - MIN_MEDIA_VIEW_HEIGHT - 6,
      )
      const nextHeight = Math.max(
        MIN_A_PREVIEW_HEIGHT,
        Math.min(maxPreviewHeight, rect.bottom - event.clientY)
      )
      updateLayoutState({ aPreviewHeight: nextHeight })
    }

    const handleMouseUp = () => setIsResizingAPreview(false)

    document.body.classList.add('panel-resizing')
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.body.classList.remove('panel-resizing')
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizingAPreview, updateLayoutState])

  const imageDisplayStyle = imageSize && zoomMode === 'manual'
    ? {
        width: `${imageSize.width * zoom}px`,
        height: `${imageSize.height * zoom}px`,
      }
    : undefined

  const isVideoSource = source?.kind === 'video'
  const isImageSource = source?.kind === 'image'

  const fitImageDisplayStyle = useMemo(() => {
    if (!imageSize || !viewSize?.width || !viewSize?.height) return undefined
    const availableHeight = source?.kind === 'video'
      ? Math.max(1, viewSize.height - VIDEO_CONTROL_ROW_HEIGHT)
      : viewSize.height

    const scale = Math.min(
      viewSize.width / imageSize.width,
      availableHeight / imageSize.height
    )

    return {
      width: `${Math.max(1, Math.floor(imageSize.width * scale))}px`,
      height: `${Math.max(1, Math.floor(imageSize.height * scale))}px`,
    }
  }, [imageSize, source?.kind, viewSize])

  const currentImageDisplayStyle = zoomMode === 'fit'
    ? fitImageDisplayStyle
    : imageDisplayStyle

  const imageDisplaySize = currentImageDisplayStyle
    ? {
        width: Number.parseFloat(currentImageDisplayStyle.width),
        height: Number.parseFloat(currentImageDisplayStyle.height),
      }
    : null

  const displayScale = imageDisplaySize && imageSize?.width
    ? imageDisplaySize.width / imageSize.width
    : 1

  const editingTextBox = editingTextAnnotation && imageDisplaySize
    ? denormalizeRect(editingTextAnnotation.geometry, imageDisplaySize)
    : null

  const getAnnotationById = (annotationId) => (
    annotations.find((annotation) => annotation.id === annotationId) || null
  )

  const selectedAnnotations = selectedAnnotationIds
    .map((annotationId) => getAnnotationById(annotationId))
    .filter(Boolean)
  const previewAnnotation = selectedAnnotations.length === 1
    ? selectedAnnotations[0]
    : selectedAnnotationIds.length === 0
      ? getAnnotationById(previewAnnotationId)
      : null
  const previewAnnotationPreview = previewAnnotation
    ? getAnnotationPreview?.(previewAnnotation)
    : null
  const shouldShowAPreview = isImageSource || isVideoSource

  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds)) return '--'
    const safeSeconds = Math.max(0, seconds)
    const hours = Math.floor(safeSeconds / 3600)
    const minutes = Math.floor((safeSeconds % 3600) / 60)
    const secs = Math.floor(safeSeconds % 60)
    const millis = Math.floor((safeSeconds - Math.floor(safeSeconds)) * 1000)
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
  }

  const getSelectedFrameLabel = (annotation) => {
    if (!annotation) return '--'
    if (frame?.id !== annotation.frameId) return annotation.frameId || '--'
    if (frame.kind === 'video-frame') return formatTime(frame.locator?.time)
    return 'image'
  }

  const startAObjectDrag = (event, annotationIds) => {
    const ids = annotationIds.filter((id) => annotations.some((annotation) => annotation.id === id))
    if (ids.length === 0) return
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(A_OBJECT_DRAG_TYPE, JSON.stringify({ ids }))
    event.dataTransfer.setData('text/plain', ids[0])
  }

  const getAnnotationDragChipStyle = (annotation) => {
    if (!imageDisplaySize) return null

    if (annotation.type === 'rect' || annotation.type === 'text') {
      const rect = denormalizeRect(annotation.geometry, imageDisplaySize)
      return {
        left: Math.max(2, rect.x + 4),
        top: Math.max(2, rect.y + 4),
      }
    }

    if (annotation.type === 'arrow') {
      const arrow = denormalizeArrow(annotation.geometry, imageDisplaySize)
      return {
        left: Math.max(2, Math.min(arrow.x1, arrow.x2) + 4),
        top: Math.max(2, Math.min(arrow.y1, arrow.y2) + 4),
      }
    }

    return null
  }

  const updateImageSize = (event) => {
    const image = event.currentTarget
    onImageSizeChange({
      width: image.naturalWidth,
      height: image.naturalHeight,
    })
  }

  const closeContextMenu = () => {
    setContextMenu(null)
  }

  const switchCanvasMode = (nextMode) => {
    onToolModeChange(nextMode)
    closeContextMenu()
  }

  const saveFromCanvasMenu = () => {
    onSaveAnnotations?.()
    closeContextMenu()
  }

  const openAObjectContextMenu = (_annotationId, x, y) => {
    setContextMenu({
      type: 'a-object',
      annotationIds: selectedAnnotationIds,
      x,
      y,
    })
  }

  const openNewEntityFromAObjectMenu = () => {
    onOpenEntityDialog({ sourceAObjectIds: contextMenu?.annotationIds || [] })
    closeContextMenu()
  }

  const openAddToEntityFromAObjectMenu = (entityId) => {
    onOpenAddToEntityDialog(entityId, contextMenu?.annotationIds || [])
    closeContextMenu()
  }

  const deleteSelectedFromAObjectMenu = () => {
    onDeleteSelectedAnnotations()
    closeContextMenu()
  }

  const exportSelectedFromAObjectMenu = () => {
    onExportSelectedAnnotationCrop?.(contextMenu?.annotationIds || [])
    closeContextMenu()
  }

  return (
    <section className="media-workspace">
      <div
        className="workspace-panels"
        ref={workspacePanelsRef}
        style={{
          gridTemplateColumns: `minmax(0, 1fr) 6px ${bWorkflowWidth}px 6px ${inspectorWidth}px`,
        }}
      >
        <div
          className="canvas-panel"
          style={{
            gridTemplateRows: shouldShowAPreview
              ? `minmax(0, 1fr) 6px ${aPreviewHeight}px`
              : 'minmax(0, 1fr)',
          }}
        >
            <div
              className={zoomMode === 'fit' ? 'media-view-area fit' : 'media-view-area manual'}
              ref={mediaViewRef}
            >
              {isImageSource ? (
                <div className={zoomMode === 'fit' ? 'image-viewer fit' : 'image-viewer manual'}>
                  <img
                    alt={source.fileName}
                    onLoad={updateImageSize}
                    src={source.fileUrl}
                    style={currentImageDisplayStyle}
                  />
                  {imageDisplaySize ? (
                    <div className="annotation-layer-host" style={currentImageDisplayStyle}>
                      <MediaAnnotationLayer
                        annotations={annotations}
                        frameId={frame?.id}
                        mode={toolMode}
                        onAddAnnotation={onAddAnnotation}
                        onAddTextAnnotation={onAddTextAnnotation}
                        onAObjectContextMenu={openAObjectContextMenu}
                        onCanvasContextMenu={(x, y) => setContextMenu({ type: 'canvas', x, y })}
                        onCanvasDoubleClick={() => onToolModeChange('select')}
                        onClearSelection={onClearSelection}
                        onEditTextAnnotation={onEditTextAnnotation}
                        onSelectAnnotation={onSelectAnnotation}
                        onUpdateAnnotation={onUpdateAnnotation}
                        selectedAnnotationIds={selectedAnnotationIds}
                        size={imageDisplaySize}
                        displayScale={displayScale}
                      />
                      {editingTextAnnotation && editingTextBox ? (
                        <textarea
                          autoFocus
                          className="inline-freetext-editor"
                          onBlur={commitTextEdit}
                          onChange={(event) => updateTextDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              cancelTextEdit()
                            }
                            if (event.key === 'Enter' && event.ctrlKey) {
                              event.preventDefault()
                              commitTextEdit()
                            }
                          }}
                          onMouseDown={(event) => event.stopPropagation()}
                          style={{
                            left: editingTextBox.x,
                            top: editingTextBox.y,
                            width: editingTextBox.width,
                            height: editingTextBox.height,
                            color: editingTextAnnotation.style?.fill || '#ff4d4d',
                            fontSize: `${(editingTextAnnotation.style?.fontSize || 18) * displayScale}px`,
                            padding: `${6 * displayScale}px`,
                          }}
                          value={textDraft}
                        />
                      ) : null}
                      {selectedAnnotationIds.map((annotationId) => {
                        const annotation = getAnnotationById(annotationId)
                        const chipStyle = annotation ? getAnnotationDragChipStyle(annotation) : null
                        if (!annotation || !chipStyle) return null
                        return (
                          <button
                            className="a-object-drag-chip"
                            draggable
                            key={annotation.id}
                            onClick={(event) => event.stopPropagation()}
                            onDragStart={(event) => startAObjectDrag(event, selectedAnnotationIds)}
                            style={chipStyle}
                            title="Drag selected A object to B Workflow"
                            type="button"
                          >
                            A
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              ) : isVideoSource ? (
                <div className="video-stage">
                  <VideoFramePanel
                    annotations={annotations}
                    bindFrameRequest={bindFrameRequest}
                    cancelTextEdit={cancelTextEdit}
                    commitTextEdit={commitTextEdit}
                    currentFrame={frame}
                    displayScale={displayScale}
                    editingTextAnnotation={editingTextAnnotation}
                    editingTextBox={editingTextBox}
                    frameSurfaceStyle={currentImageDisplayStyle || { width: '100%', height: '100%' }}
                    imageDisplaySize={imageDisplaySize}
                    onAddAnnotation={onAddAnnotation}
                    onAddTextAnnotation={onAddTextAnnotation}
                    onBindCurrentVideoFrame={onBindCurrentVideoFrame}
                    onAObjectContextMenu={openAObjectContextMenu}
                    onCanvasContextMenu={(x, y) => setContextMenu({ type: 'canvas', x, y })}
                    onClearSelection={onClearSelection}
                    onEditTextAnnotation={onEditTextAnnotation}
                    onMetadata={onImageSizeChange}
                    playPauseRequestId={playPauseRequestId}
                    onSelectAnnotation={onSelectAnnotation}
                    onToolModeChange={onToolModeChange}
                    onUpdateAnnotation={onUpdateAnnotation}
                    onUseVideoFrame={onUseVideoFrame}
                    selectedAnnotationIds={selectedAnnotationIds}
                    showBindFrameOverlay={showBindFrameOverlay}
                    source={source}
                    textDraft={textDraft}
                    toolMode={toolMode}
                    updateTextDraft={updateTextDraft}
                    videoSeekRequest={videoSeekRequest}
                  />
                </div>
              ) : (
                <div className="media-stage-placeholder">
                  {displayMessage || 'Open an image or video to start.'}
                </div>
              )}
            </div>
            {shouldShowAPreview ? (
              <div
                aria-label="Resize A Preview"
                className="a-preview-splitter"
                onMouseDown={(event) => {
                  event.preventDefault()
                  setIsResizingAPreview(true)
                }}
                role="separator"
                title="Resize A Preview"
              />
            ) : null}
            {previewAnnotation ? (
              <div className="a-preview-panel" style={{ height: aPreviewHeight }}>
                <div className="a-preview-header">
                  <strong>A Preview</strong>
                  <span>{previewAnnotation.type}</span>
                  <span title={previewAnnotation.id}>{previewAnnotation.id}</span>
                  <span>{getSelectedFrameLabel(previewAnnotation)}</span>
                  <small>{previewAnnotation.type === 'text' ? previewAnnotation.text || 'FreeText' : ''}</small>
                </div>
                <APreviewCard
                  annotation={previewAnnotation}
                  imageUrl={previewAnnotationPreview?.imageUrl}
                  imageSize={previewAnnotationPreview?.imageSize}
                  missingPreviewText={isVideoSource ? 'Building frame preview...' : 'Preview unavailable.'}
                  showInfo={false}
                />
              </div>
            ) : selectedAnnotationIds.length > 1 ? (
              <div className="a-preview-panel compact-message" style={{ height: aPreviewHeight }}>
                Multiple A objects selected. Open B Preview or select one A object.
              </div>
            ) : shouldShowAPreview ? (
              <div className="a-preview-panel compact-message" style={{ height: aPreviewHeight }}>
                No A object selected.
              </div>
            ) : null}
        </div>
        <div
          aria-label="Resize source area and B Entity area"
          className="workspace-panel-splitter"
          onMouseDown={(event) => {
            event.preventDefault()
            setResizingWorkspacePart('bWorkflow')
          }}
          role="separator"
          title="Resize source / B Entity"
        />
        <BWorkflow
          annotations={annotations}
          bottomPanelHeight={bWorkflowBottomPanelHeight}
          getAnnotationPreview={getAnnotationPreview}
          ensureAnnotationPreview={ensureAnnotationPreview}
          imageUrl={isVideoSource ? undefined : framePreviewUrl}
          imageSize={isVideoSource ? undefined : imageSize}
          onExportEntity={onExportSelectedEntity}
          selectedAnnotationIds={selectedAnnotationIds}
          selectedEntity={selectedEntity}
          onCreateEntity={onCreateEntity}
          onBottomPanelHeightChange={(nextHeight) => {
            updateLayoutState({ bWorkflowBottomPanelHeight: nextHeight })
          }}
          onSelectAnnotations={onSelectAnnotations}
          onUpdateEntity={onUpdateEntity}
        />
        <div
          aria-label="Resize AB Inspector"
          className="workspace-panel-splitter inspector-splitter"
          onMouseDown={(event) => {
            event.preventDefault()
            setResizingWorkspacePart('inspector')
          }}
          role="separator"
          title="Resize AB Inspector"
        />
        <aside className="ab-inspector-panel">
          {inspectorContent}
        </aside>
      </div>
      {contextMenu?.type === 'canvas' ? (
        <div
          className="context-menu canvas-context-menu"
          onContextMenu={(event) => event.preventDefault()}
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
        >
          <button className={toolMode === 'select' ? 'active-menu-item' : ''} onClick={() => switchCanvasMode('select')} type="button">Select</button>
          <button className={toolMode === 'rect' ? 'active-menu-item' : ''} onClick={() => switchCanvasMode('rect')} type="button">Rect</button>
          <button className={toolMode === 'arrow' ? 'active-menu-item' : ''} onClick={() => switchCanvasMode('arrow')} type="button">Arrow</button>
          <button className={toolMode === 'text' ? 'active-menu-item' : ''} onClick={() => switchCanvasMode('text')} type="button">Text</button>
          <div className="context-menu-separator" />
          <button disabled={!source || !isDirty} onClick={saveFromCanvasMenu} type="button">Save JSON</button>
          <div className="context-menu-separator" />
          <button onClick={closeContextMenu} type="button">Cancel</button>
        </div>
      ) : null}
      {contextMenu?.type === 'a-object' ? (
        <div
          className="context-menu a-object-context-menu"
          onContextMenu={(event) => event.preventDefault()}
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
        >
          <button onClick={openNewEntityFromAObjectMenu} type="button">
            New Entity From Selected ({contextMenu.annotationIds.length})
          </button>
          <div className="context-menu-separator" />
          <button disabled={entities.length === 0} type="button">Add To Entity</button>
          {entities.map((entity) => (
            <button className="submenu-button" key={entity.id} onClick={() => openAddToEntityFromAObjectMenu(entity.id)} type="button">
              {formatEntityLabel(entity)}
            </button>
          ))}
          <div className="context-menu-separator" />
          <button disabled={contextMenu.annotationIds.length !== 1} onClick={exportSelectedFromAObjectMenu} type="button">Export Crop...</button>
          <div className="context-menu-separator" />
          <button disabled={contextMenu.annotationIds.length === 0} onClick={deleteSelectedFromAObjectMenu} type="button">Delete</button>
          <div className="context-menu-separator" />
          <button onClick={closeContextMenu} type="button">Cancel</button>
        </div>
      ) : null}
      <footer className="media-statusbar">
        <span>Source: <strong title={source?.filePath || ''}>{source?.fileName || '--'}</strong></span>
        <span>Media: <strong>{imageSize ? `${imageSize.width} x ${imageSize.height}` : '--'}</strong></span>
        <span>Stage: <strong>{imageDisplaySize ? `${Math.round(imageDisplaySize.width)} x ${Math.round(imageDisplaySize.height)}` : '--'}</strong></span>
        <span>View: <strong>{viewSize ? `${Math.round(viewSize.width)} x ${Math.round(viewSize.height)}` : '--'}</strong></span>
        <span>Fit: <strong>contain</strong></span>
        <span>Zoom: <strong>{zoomMode === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`}</strong></span>
        <span>Input: <strong>{displayInput?.kind || '--'}</strong></span>
        <span>Entity: <strong title={displayInput?.entityId || ''}>{displayInput?.entityId || '--'}</strong></span>
        <span>
          JSON:{' '}
          <strong
            className={saveStatus === 'Unsaved' ? 'status-unsaved' : ''}
            title={annotationFilePath}
          >
            {saveStatus}
          </strong>
        </span>
      </footer>
    </section>
  )
}
