import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Document, Page } from 'react-pdf'
import { PDF_DOCUMENT_OPTIONS } from './pdfConfig'

const DEFAULT_PAGE_SIZE = { width: 612, height: 792 }
const MIN_SCALE = 0.1
const MAX_SCALE = 6
const ZOOM_STEP = 0.05

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

function getPageSize(pageSizes, pageNumber) {
  return pageSizes[pageNumber] || pageSizes[1] || DEFAULT_PAGE_SIZE
}

function runAfterLayout(action, maxAttempts = 18, onExhausted) {
  let canceled = false
  let frameId = 0
  let attempts = 0
  const run = () => {
    if (canceled) return
    attempts += 1
    if (action()) return
    if (attempts >= maxAttempts) {
      onExhausted?.()
      return
    }
    frameId = window.requestAnimationFrame(run)
  }
  frameId = window.requestAnimationFrame(run)
  return () => {
    canceled = true
    window.cancelAnimationFrame(frameId)
  }
}

function BufferedPdfPage({
  height,
  onLoadSuccess,
  onVisibleRenderSuccess,
  pageNumber,
  width,
}) {
  const targetWidth = Math.max(1, Math.round(width))
  const [activeWidth, setActiveWidth] = useState(targetWidth)
  const activeWidthRef = useRef(activeWidth)
  const targetWidthRef = useRef(targetWidth)
  const renderCallbackRef = useRef(onVisibleRenderSuccess)

  useEffect(() => {
    activeWidthRef.current = activeWidth
    targetWidthRef.current = targetWidth
  }, [activeWidth, targetWidth])

  useEffect(() => {
    renderCallbackRef.current = onVisibleRenderSuccess
  }, [onVisibleRenderSuccess])

  const handleLayerRender = (layerWidth) => {
    if (layerWidth !== activeWidthRef.current) {
      if (layerWidth !== targetWidthRef.current) return
      setActiveWidth(layerWidth)
      window.requestAnimationFrame(() => renderCallbackRef.current?.())
      return
    }
    renderCallbackRef.current?.()
  }

  const layerWidths = targetWidth !== activeWidth
    ? [activeWidth, targetWidth]
    : [activeWidth]

  return (
    <div className="pdf-page-buffer" style={{ width: targetWidth, height }}>
      {layerWidths.map((layerWidth) => {
        const isActive = layerWidth === activeWidth
        return (
          <div
            className={`pdf-page-buffer-layer ${isActive ? 'active' : 'pending'}`}
            key={layerWidth}
            style={{
              transform: isActive ? `scale(${targetWidth / layerWidth})` : 'none',
              width: layerWidth,
            }}
          >
            <Page
              onLoadSuccess={onLoadSuccess}
              onRenderSuccess={() => handleLayerRender(layerWidth)}
              pageNumber={pageNumber}
              renderAnnotationLayer={false}
              renderTextLayer={false}
              width={layerWidth}
            />
          </div>
        )
      })}
    </div>
  )
}

export default function PdfViewer({
  currentPage = 1,
  fileUrl,
  fileName = 'PDF document',
  interactionLockedPage = null,
  navigationRequest = null,
  onActualSize,
  onDocumentInfo,
  onFit,
  onPageChange,
  onPageInfo,
  onPageSnapshot,
  onViewModeChange,
  onZoomChange,
  renderSinglePageOverlay,
  renderContinuousPageOverlay,
  viewMode = 'single',
  zoom = 1,
  zoomMode = 'fit',
}) {
  const viewportRef = useRef(null)
  const singlePageSurfaceRef = useRef(null)
  const pageElementsRef = useRef(new Map())
  const currentPageRef = useRef(currentPage)
  const onPageChangeRef = useRef(onPageChange)
  const onPageSnapshotRef = useRef(onPageSnapshot)
  const lastNavigationRequestIdRef = useRef('')
  const pendingViewAnchorRef = useRef(null)
  const requestedZoomRef = useRef(null)
  const suppressPageSyncRef = useRef(false)
  const [documentError, setDocumentError] = useState('')
  const [activeNavigationHighlightId, setActiveNavigationHighlightId] = useState('')
  const [numPages, setNumPages] = useState(0)
  const [pageInput, setPageInput] = useState('')
  const [pageLabels, setPageLabels] = useState([])
  const [pageSizes, setPageSizes] = useState({})
  const [nearPages, setNearPages] = useState(() => new Set([currentPage]))
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })

  const safeCurrentPage = clamp(Math.round(Number(currentPage) || 1), 1, Math.max(1, numPages))

  useEffect(() => {
    currentPageRef.current = safeCurrentPage
    onPageChangeRef.current = onPageChange
    onPageSnapshotRef.current = onPageSnapshot
  }, [onPageChange, onPageSnapshot, safeCurrentPage])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return undefined
    const updateSize = () => {
      const rect = viewport.getBoundingClientRect()
      setViewportSize({ width: rect.width, height: rect.height })
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  const registerPageElement = useCallback((pageNumber, element) => {
    if (element) pageElementsRef.current.set(pageNumber, element)
    else pageElementsRef.current.delete(pageNumber)
  }, [])

  useEffect(() => {
    if (viewMode !== 'continuous' || !numPages || !viewportRef.current) return undefined
    const viewport = viewportRef.current
    const visibilityRatios = new Map()
    const nearObserver = new IntersectionObserver((entries) => {
      setNearPages((current) => {
        const next = new Set(current)
        let changed = false
        entries.forEach((entry) => {
          const pageNumber = Number(entry.target.dataset.pageNumber)
          if (!pageNumber) return
          if (entry.isIntersecting && !next.has(pageNumber)) {
            next.add(pageNumber)
            changed = true
          } else if (!entry.isIntersecting && next.delete(pageNumber)) {
            changed = true
          }
        })
        return changed ? next : current
      })
    }, {
      root: viewport,
      rootMargin: '900px 0px',
      threshold: 0,
    })
    const visibleObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const pageNumber = Number(entry.target.dataset.pageNumber)
        if (pageNumber) visibilityRatios.set(pageNumber, entry.intersectionRatio)
      })
      let bestPage = 0
      let bestRatio = 0
      visibilityRatios.forEach((ratio, pageNumber) => {
        if (ratio > bestRatio) {
          bestPage = pageNumber
          bestRatio = ratio
        }
      })
      if (
        !interactionLockedPage
        && !suppressPageSyncRef.current
        && bestPage
        && bestPage !== currentPageRef.current
      ) onPageChangeRef.current?.(bestPage)
    }, {
      root: viewport,
      threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
    })

    pageElementsRef.current.forEach((element) => {
      nearObserver.observe(element)
      visibleObserver.observe(element)
    })
    return () => {
      nearObserver.disconnect()
      visibleObserver.disconnect()
    }
  }, [interactionLockedPage, numPages, viewMode])

  const currentPageSize = getPageSize(pageSizes, safeCurrentPage)
  const largestPageWidth = Math.max(
    DEFAULT_PAGE_SIZE.width,
    ...Object.values(pageSizes).map((size) => size.width || 0),
  )
  const displayScale = useMemo(() => {
    if (zoomMode !== 'fit') return clamp(Number(zoom) || 1, MIN_SCALE, MAX_SCALE)
    const availableWidth = Math.max(1, viewportSize.width - 32)
    if (viewMode === 'continuous') {
      return clamp(availableWidth / largestPageWidth, MIN_SCALE, MAX_SCALE)
    }
    const availableHeight = Math.max(1, viewportSize.height - 32)
    return clamp(Math.min(
      availableWidth / currentPageSize.width,
      availableHeight / currentPageSize.height,
    ), MIN_SCALE, MAX_SCALE)
  }, [
    currentPageSize.height,
    currentPageSize.width,
    largestPageWidth,
    viewMode,
    viewportSize.height,
    viewportSize.width,
    zoom,
    zoomMode,
  ])

  const handleDocumentLoad = async (pdfDocument) => {
    setDocumentError('')
    setNumPages(pdfDocument.numPages)
    let labels
    try {
      labels = await pdfDocument.getPageLabels() || []
    } catch {
      labels = []
    }
    setPageLabels(labels)
    onDocumentInfo?.({ pageCount: pdfDocument.numPages, pageLabels: labels })
    try {
      const firstPage = await pdfDocument.getPage(1)
      const viewport = firstPage.getViewport({ scale: 1 })
      const size = { width: viewport.width, height: viewport.height }
      setPageSizes((current) => ({ ...current, 1: size }))
      onPageInfo?.({
        page: 1,
        ...size,
        rotation: viewport.rotation || 0,
        bookPageLabel: labels[0] ?? null,
      })
    } catch {
      // The Page component will report page dimensions when it renders.
    }
  }

  const handlePageLoad = (pageNumber, pdfPage) => {
    const viewport = pdfPage.getViewport({ scale: 1 })
    const size = { width: viewport.width, height: viewport.height }
    setPageSizes((current) => {
      const oldSize = current[pageNumber]
      if (oldSize?.width === size.width && oldSize?.height === size.height) return current
      return { ...current, [pageNumber]: size }
    })
    onPageInfo?.({
      page: pageNumber,
      ...size,
      rotation: viewport.rotation || 0,
      bookPageLabel: pageLabels[pageNumber - 1] ?? null,
    })
  }

  const scrollToPage = (page) => {
    const viewport = viewportRef.current
    const element = pageElementsRef.current.get(page)
    if (!viewport || !element) return
    viewport.scrollTo({ top: Math.max(0, element.offsetTop - 12) })
  }

  const getPageSurface = useCallback((page, mode = viewMode) => {
    if (mode === 'single') {
      return page === safeCurrentPage ? singlePageSurfaceRef.current : null
    }
    return pageElementsRef.current.get(page) || null
  }, [safeCurrentPage, viewMode])

  const captureViewAnchorAt = useCallback((clientX, clientY) => {
    const viewport = viewportRef.current
    if (!viewport) return null
    const viewportRect = viewport.getBoundingClientRect()
    const viewportX = Number.isFinite(clientX)
      ? clamp(clientX, viewportRect.left, viewportRect.right)
      : viewportRect.left + viewportRect.width / 2
    const viewportY = Number.isFinite(clientY)
      ? clamp(clientY, viewportRect.top, viewportRect.bottom)
      : viewportRect.top + viewportRect.height / 2
    let page = safeCurrentPage
    let surface = getPageSurface(page)

    if (viewMode === 'continuous') {
      let bestDistance = Number.POSITIVE_INFINITY
      pageElementsRef.current.forEach((element, pageNumber) => {
        const rect = element.getBoundingClientRect()
        const dx = viewportX < rect.left ? rect.left - viewportX : viewportX > rect.right ? viewportX - rect.right : 0
        const dy = viewportY < rect.top ? rect.top - viewportY : viewportY > rect.bottom ? viewportY - rect.bottom : 0
        const distance = dx * dx + dy * dy
        if (distance < bestDistance) {
          bestDistance = distance
          page = pageNumber
          surface = element
        }
      })
    }

    if (!surface) return null
    const surfaceRect = surface.getBoundingClientRect()
    if (!surfaceRect.width || !surfaceRect.height) return null
    return {
      page,
      normalizedX: clamp((viewportX - surfaceRect.left) / surfaceRect.width, 0, 1),
      normalizedY: clamp((viewportY - surfaceRect.top) / surfaceRect.height, 0, 1),
      viewportXRatio: clamp((viewportX - viewportRect.left) / viewportRect.width, 0, 1),
      viewportYRatio: clamp((viewportY - viewportRect.top) / viewportRect.height, 0, 1),
    }
  }, [getPageSurface, safeCurrentPage, viewMode])

  const captureViewAnchor = useCallback(() => captureViewAnchorAt(), [captureViewAnchorAt])

  const restoreViewAnchor = useCallback((anchor) => {
    const viewport = viewportRef.current
    const surface = getPageSurface(anchor?.page)
    if (!viewport || !surface) return false
    const viewportRect = viewport.getBoundingClientRect()
    const surfaceRect = surface.getBoundingClientRect()
    if (!viewportRect.width || !viewportRect.height || !surfaceRect.width || !surfaceRect.height) return false
    const targetX = surfaceRect.left + surfaceRect.width * clamp(anchor.normalizedX, 0, 1)
    const targetY = surfaceRect.top + surfaceRect.height * clamp(anchor.normalizedY, 0, 1)
    const desiredX = viewportRect.left + viewportRect.width * clamp(anchor.viewportXRatio, 0, 1)
    const desiredY = viewportRect.top + viewportRect.height * clamp(anchor.viewportYRatio, 0, 1)
    viewport.scrollBy({ left: targetX - desiredX, top: targetY - desiredY })
    return true
  }, [getPageSurface])

  const scrollBoundsIntoView = useCallback((page, bounds, margin = 32) => {
    const viewport = viewportRef.current
    const surface = getPageSurface(page)
    if (!viewport || !surface || !bounds) return false
    if (!surface.querySelector('canvas')) return false
    const viewportRect = viewport.getBoundingClientRect()
    const surfaceRect = surface.getBoundingClientRect()
    if (!surfaceRect.width || !surfaceRect.height) return false
    const targetRect = {
      left: surfaceRect.left + surfaceRect.width * bounds.x,
      top: surfaceRect.top + surfaceRect.height * bounds.y,
      right: surfaceRect.left + surfaceRect.width * (bounds.x + bounds.width),
      bottom: surfaceRect.top + surfaceRect.height * (bounds.y + bounds.height),
    }
    const availableWidth = Math.max(1, viewportRect.width - margin * 2)
    const availableHeight = Math.max(1, viewportRect.height - margin * 2)
    const targetWidth = targetRect.right - targetRect.left
    const targetHeight = targetRect.bottom - targetRect.top
    let deltaX = 0
    let deltaY = 0
    if (targetWidth > availableWidth) {
      deltaX = (targetRect.left + targetRect.right) / 2 - (viewportRect.left + viewportRect.right) / 2
    } else if (targetRect.left < viewportRect.left + margin) {
      deltaX = targetRect.left - viewportRect.left - margin
    } else if (targetRect.right > viewportRect.right - margin) {
      deltaX = targetRect.right - viewportRect.right + margin
    }
    if (targetHeight > availableHeight) {
      deltaY = (targetRect.top + targetRect.bottom) / 2 - (viewportRect.top + viewportRect.bottom) / 2
    } else if (targetRect.top < viewportRect.top + margin) {
      deltaY = targetRect.top - viewportRect.top - margin
    } else if (targetRect.bottom > viewportRect.bottom - margin) {
      deltaY = targetRect.bottom - viewportRect.bottom + margin
    }
    if (deltaX || deltaY) viewport.scrollBy({ left: deltaX, top: deltaY })
    return true
  }, [getPageSurface])

  const commitPageInput = () => {
    const page = clamp(Math.round(Number(pageInput) || safeCurrentPage), 1, Math.max(1, numPages))
    setPageInput('')
    onPageChange?.(page)
    if (viewMode === 'continuous') scrollToPage(page)
  }

  const changePage = (delta) => {
    const page = clamp(safeCurrentPage + delta, 1, Math.max(1, numPages))
    setPageInput('')
    onPageChange?.(page)
    if (viewMode === 'continuous') scrollToPage(page)
  }

  const changeViewMode = useCallback((nextMode) => {
    if (nextMode === viewMode) return
    const anchor = captureViewAnchor()
    pendingViewAnchorRef.current = anchor
    if (anchor?.page && anchor.page !== safeCurrentPage) onPageChange?.(anchor.page)
    suppressPageSyncRef.current = true
    onViewModeChange?.(nextMode)
  }, [captureViewAnchor, onPageChange, onViewModeChange, safeCurrentPage, viewMode])

  useEffect(() => {
    requestedZoomRef.current = displayScale
  }, [displayScale])

  const changePdfZoom = useCallback((delta, anchor = null) => {
    const baseScale = Number.isFinite(requestedZoomRef.current)
      ? requestedZoomRef.current
      : displayScale
    const nextScale = clamp(Number((baseScale + delta).toFixed(2)), MIN_SCALE, MAX_SCALE)
    if (nextScale === baseScale) return
    requestedZoomRef.current = nextScale
    if (anchor) {
      pendingViewAnchorRef.current = anchor
      suppressPageSyncRef.current = true
    }
    onZoomChange?.(nextScale)
  }, [displayScale, onZoomChange])

  const handleViewportWheel = useCallback((event) => {
    if (!event.ctrlKey || !event.deltaY) return
    event.preventDefault()
    event.stopPropagation()
    if (interactionLockedPage) return

    const delta = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP
    const anchor = captureViewAnchorAt(event.clientX, event.clientY)
    changePdfZoom(delta, anchor)
  }, [captureViewAnchorAt, changePdfZoom, interactionLockedPage])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return undefined
    viewport.addEventListener('wheel', handleViewportWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleViewportWheel)
  }, [handleViewportWheel])

  useEffect(() => {
    const anchor = pendingViewAnchorRef.current
    if (!anchor) return undefined
    return runAfterLayout(() => {
      if (viewMode === 'single' && safeCurrentPage !== anchor.page) return false
      const restored = restoreViewAnchor(anchor)
      if (restored) {
        pendingViewAnchorRef.current = null
        window.setTimeout(() => {
          suppressPageSyncRef.current = false
        }, 80)
      }
      return restored
    }, 240, () => {
      pendingViewAnchorRef.current = null
      suppressPageSyncRef.current = false
    })
  }, [displayScale, pageSizes, restoreViewAnchor, safeCurrentPage, viewMode, viewportSize])

  useEffect(() => {
    if (!navigationRequest?.id || navigationRequest.id === lastNavigationRequestIdRef.current) return undefined
    suppressPageSyncRef.current = true
    return runAfterLayout(() => {
      if (viewMode === 'single' && safeCurrentPage !== navigationRequest.page) return false
      const positioned = scrollBoundsIntoView(navigationRequest.page, navigationRequest.bounds)
      if (positioned) {
        lastNavigationRequestIdRef.current = navigationRequest.id
        setActiveNavigationHighlightId(navigationRequest.id)
        window.setTimeout(() => {
          suppressPageSyncRef.current = false
        }, 80)
        window.setTimeout(() => {
          setActiveNavigationHighlightId((current) => (
            current === navigationRequest.id ? '' : current
          ))
        }, 1250)
      }
      return positioned
    }, 600, () => {
      suppressPageSyncRef.current = false
    })
  }, [
    displayScale,
    navigationRequest,
    pageSizes,
    safeCurrentPage,
    scrollBoundsIntoView,
    viewMode,
    viewportSize,
  ])

  const handleSinglePageRender = useCallback(() => {
    const canvas = singlePageSurfaceRef.current?.querySelector('.pdf-page-buffer-layer.active canvas')
    if (!canvas) return
    try {
      onPageSnapshotRef.current?.({
        page: safeCurrentPage,
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
      })
    } catch {
      // A preview can request another render if canvas capture is unavailable.
    }
  }, [safeCurrentPage])

  const renderNavigationHighlight = (page, width, height) => {
    if (
      !navigationRequest?.id
      || activeNavigationHighlightId !== navigationRequest.id
      || navigationRequest.page !== page
      || !navigationRequest.bounds
    ) return null
    const bounds = navigationRequest.bounds
    return (
      <div
        className="pdf-navigation-highlight"
        key={navigationRequest.id}
        style={{
          left: bounds.x * width,
          top: bounds.y * height,
          width: Math.max(2, bounds.width * width),
          height: Math.max(2, bounds.height * height),
        }}
      />
    )
  }

  return (
    <div className="pdf-viewer">
      <div className="pdf-viewer-toolbar">
        <button className={viewMode === 'single' ? 'active' : ''} disabled={Boolean(interactionLockedPage) && viewMode !== 'single'} onClick={() => changeViewMode('single')} type="button">Single Page</button>
        <button className={viewMode === 'continuous' ? 'active' : ''} disabled={Boolean(interactionLockedPage) && viewMode !== 'continuous'} onClick={() => changeViewMode('continuous')} type="button">Continuous</button>
        <span className="pdf-toolbar-separator" />
        <button disabled={Boolean(interactionLockedPage) || safeCurrentPage <= 1} onClick={() => changePage(-1)} type="button">Previous</button>
        <label>
          Page
          <input
            aria-label="PDF page number"
            disabled={Boolean(interactionLockedPage)}
            min="1"
            max={Math.max(1, numPages)}
            onBlur={commitPageInput}
            onChange={(event) => setPageInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitPageInput()
            }}
            type="number"
            value={pageInput || String(safeCurrentPage)}
          />
        </label>
        <span>/ {numPages || '--'}</span>
        {pageLabels[safeCurrentPage - 1] != null ? (
          <span>Book page: {pageLabels[safeCurrentPage - 1]}</span>
        ) : null}
        <button disabled={Boolean(interactionLockedPage) || !numPages || safeCurrentPage >= numPages} onClick={() => changePage(1)} type="button">Next</button>
        <span className="pdf-toolbar-separator" />
        <button disabled={Boolean(interactionLockedPage)} onClick={onFit} type="button">Fit</button>
        <button disabled={Boolean(interactionLockedPage)} onClick={onActualSize} type="button">100%</button>
        <button disabled={Boolean(interactionLockedPage)} onClick={() => changePdfZoom(-ZOOM_STEP, captureViewAnchor())} type="button">−</button>
        <button disabled={Boolean(interactionLockedPage)} onClick={() => changePdfZoom(ZOOM_STEP, captureViewAnchor())} type="button">+</button>
        <span>{zoomMode === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`}</span>
      </div>

      <div
        className={`pdf-document-viewport ${viewMode}`}
        ref={viewportRef}
        title={fileName}
      >
        <Document
          error={<div className="pdf-load-message error">Unable to open PDF.</div>}
          file={fileUrl}
          loading={<div className="pdf-load-message">Loading PDF...</div>}
          onLoadError={(error) => setDocumentError(error?.message || String(error))}
          onLoadSuccess={handleDocumentLoad}
          options={PDF_DOCUMENT_OPTIONS}
        >
          {documentError ? <div className="pdf-load-message error">{documentError}</div> : null}
          {viewMode === 'single' && numPages ? (
            <div className="pdf-single-page">
              <div
                className="pdf-single-page-surface"
                ref={singlePageSurfaceRef}
                style={{
                  width: Math.max(1, Math.round(currentPageSize.width * displayScale)),
                  height: Math.max(1, Math.round(currentPageSize.height * displayScale)),
                }}
              >
                <BufferedPdfPage
                  height={Math.max(1, Math.round(currentPageSize.height * displayScale))}
                  key={`${fileUrl}:${safeCurrentPage}`}
                  onLoadSuccess={(pdfPage) => handlePageLoad(safeCurrentPage, pdfPage)}
                  onVisibleRenderSuccess={handleSinglePageRender}
                  pageNumber={safeCurrentPage}
                  width={Math.max(1, Math.round(currentPageSize.width * displayScale))}
                />
                {renderSinglePageOverlay?.({
                  width: Math.max(1, Math.round(currentPageSize.width * displayScale)),
                  height: Math.max(1, Math.round(currentPageSize.height * displayScale)),
                  displayScale,
                })}
                {renderNavigationHighlight(
                  safeCurrentPage,
                  Math.max(1, Math.round(currentPageSize.width * displayScale)),
                  Math.max(1, Math.round(currentPageSize.height * displayScale)),
                )}
              </div>
            </div>
          ) : null}

          {viewMode === 'continuous' && numPages ? (
            <div className="pdf-continuous-pages">
              {Array.from({ length: numPages }, (_value, index) => {
                const pageNumber = index + 1
                const pageSize = getPageSize(pageSizes, pageNumber)
                const width = Math.max(1, Math.round(pageSize.width * displayScale))
                const height = Math.max(1, Math.round(pageSize.height * displayScale))
                const shouldRender = nearPages.has(pageNumber)
                  || pageNumber === safeCurrentPage
                  || pageNumber === interactionLockedPage
                return (
                  <div
                    className={pageNumber === safeCurrentPage ? 'pdf-page-shell current' : 'pdf-page-shell'}
                    data-page-number={pageNumber}
                    key={pageNumber}
                    ref={(element) => registerPageElement(pageNumber, element)}
                    style={{ width, minHeight: height }}
                  >
                    <div className="pdf-page-number">
                      {pageLabels[pageNumber - 1] && pageLabels[pageNumber - 1] !== String(pageNumber)
                        ? `${pageNumber} · ${pageLabels[pageNumber - 1]}`
                        : pageNumber}
                    </div>
                    {shouldRender ? (
                      <>
                        <BufferedPdfPage
                          height={height}
                          onLoadSuccess={(pdfPage) => handlePageLoad(pageNumber, pdfPage)}
                          pageNumber={pageNumber}
                          width={width}
                        />
                        {renderContinuousPageOverlay?.({
                          page: pageNumber,
                          width,
                          height,
                          displayScale,
                        })}
                        {renderNavigationHighlight(pageNumber, width, height)}
                      </>
                    ) : (
                      <div className="pdf-page-placeholder">Page {pageNumber}</div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : null}
        </Document>
      </div>
    </div>
  )
}
