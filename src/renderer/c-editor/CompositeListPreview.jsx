import { useEffect, useRef, useState } from 'react'
import PreviewControlOverlay from '../components/preview/PreviewControlOverlay'
import usePreviewWheelZoom from '../components/preview/usePreviewWheelZoom'
import { VIDEO_PREVIEW_PRIORITIES } from '../media/videoFramePreviewCache'
import EntityRawPreview from '../workflow/EntityRawPreview'
import CItemTreePanel from './CItemTreePanel'
import { getTextPreviewInfo } from './cEditorUtils'
import {
  applyEntityPreviewSnapshot,
  prepareEntityPreview,
} from './entityPreviewResources'
import usePreviewVisibility from './usePreviewVisibility'

const MAX_C_REF_PREVIEW_DEPTH = 3
const DEFAULT_PREVIEW_BACKGROUND = '#ffffff'
const EMPTY_FRAME_KEYS = []
const C_DOCUMENT_DISPLAY_TABS = [
  { id: 'list', label: 'List' },
  { id: 'preview', label: 'Preview' },
]

function toLabFileUrl(filePath) {
  return `lab-file://local/${encodeURIComponent(filePath)}`
}

function CPreviewNode({
  currentCFilePath = '',
  node,
  depth = 0,
  maxDepth = MAX_C_REF_PREVIEW_DEPTH,
  previewBackgroundColor = DEFAULT_PREVIEW_BACKGROUND,
  previewResources,
  previewScaleFactor = 1,
  nodePath,
  scopePrefix,
  showAnnotationFrame = true,
  visitedCFiles = [],
}) {
  const { elementRef, isNear, isVisible } = usePreviewVisibility()
  const [data, setData] = useState({ status: 'idle' })
  const requestIdRef = useRef(0)
  const cRefPath = node.type === 'c-ref' ? node.ref?.cFilePath || '' : ''
  const cRefVisited = cRefPath && visitedCFiles.includes(cRefPath)
  const cRefTooDeep = node.type === 'c-ref' && depth >= maxDepth
  const nextVisitedCFiles = cRefPath ? [...visitedCFiles, cRefPath] : visitedCFiles
  const scopeId = `${scopePrefix}:${nodePath}`
  const priority = isVisible
    ? VIDEO_PREVIEW_PRIORITIES.visible
    : VIDEO_PREVIEW_PRIORITIES.prefetch
  const frameKeys = data.frameKeys || EMPTY_FRAME_KEYS

  useEffect(() => {
    if (node.type !== 'b-ref' || !isNear) return
    previewResources.videoFrames.setActiveKeys(scopeId, frameKeys, priority)
  }, [frameKeys, isNear, node.type, previewResources, priority, scopeId])

  useEffect(() => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    if (!isNear) {
      previewResources.videoFrames.releaseScope(scopeId)
      const resetTimer = window.setTimeout(() => setData({ status: 'idle' }), 0)
      return () => window.clearTimeout(resetTimer)
    }

    let canceled = false
    const isCurrent = () => !canceled && requestId === requestIdRef.current

    async function loadNodePreview() {
      if (node.type === 'b-ref') {
        setData({ status: 'loading' })
        const result = await previewResources.annotationFiles.load(node.ref?.dataFilePath)
        if (!isCurrent()) return
        const prepared = prepareEntityPreview(result, node.ref?.entityId, previewResources.videoFrames)
        if (!prepared.ok) {
          previewResources.videoFrames.releaseScope(scopeId)
          setData({ status: 'ready', ...prepared })
          return
        }

        const { activeFrameKeys, targets, ...previewState } = prepared
        const nextFrameKeys = [...activeFrameKeys]
        previewResources.videoFrames.setActiveKeys(
          scopeId,
          nextFrameKeys,
          VIDEO_PREVIEW_PRIORITIES.prefetch,
        )
        setData({
          ...previewState,
          frameKeys: nextFrameKeys,
          status: 'ready',
        })
        targets.forEach((target) => {
          previewResources.videoFrames.request({
            key: target.frameKey,
            mediaKind: target.mediaKind,
            page: target.page,
            priority: VIDEO_PREVIEW_PRIORITIES.prefetch,
            renderScale: target.renderScale,
            src: target.src,
            time: target.time,
          }).then((snapshot) => {
            if (!isCurrent()) return
            setData((current) => ({
              ...current,
              annotationPreviews: applyEntityPreviewSnapshot(
                current.annotationPreviews,
                target,
                snapshot,
              ),
            }))
          })
        })
        return
      }

      previewResources.videoFrames.releaseScope(scopeId)
      if (node.type === 'file-ref' && node.fileKind === 'text') {
        setData({ status: 'loading' })
        const result = await window.labApi?.readTextFile?.(node.ref?.filePath)
        if (isCurrent()) {
          setData({
            status: 'ready',
            ...(result || { ok: false, reason: 'readTextFile-unavailable' }),
          })
        }
        return
      }

      if (node.type === 'c-ref' && !cRefVisited && !cRefTooDeep && cRefPath !== currentCFilePath) {
        setData({ status: 'loading' })
        const result = await window.labApi?.readCDocumentFile?.(cRefPath)
        if (isCurrent()) {
          setData({
            status: 'ready',
            ...(result || { ok: false, reason: 'readCDocumentFile-unavailable' }),
          })
        }
        return
      }

      setData({ status: 'ready', ok: true })
    }

    loadNodePreview()
    return () => {
      canceled = true
      previewResources.videoFrames.releaseScope(scopeId)
    }
  }, [
    cRefPath,
    cRefTooDeep,
    cRefVisited,
    currentCFilePath,
    isNear,
    node.fileKind,
    node.id,
    node.ref?.dataFilePath,
    node.ref?.entityId,
    node.ref?.filePath,
    node.type,
    previewResources,
    scopeId,
  ])

  const textPreviewInfo = node.type === 'file-ref' && node.fileKind === 'text' && data.ok
    ? getTextPreviewInfo(data.text)
    : null
  const getAnnotationPreview = (annotation) => data.annotationPreviews?.[annotation?.id] || null

  return (
    <li className="c-preview-tree-item">
      <article
        className="c-preview-source raw"
        ref={elementRef}
        style={{ '--preview-depth': depth }}
      >
        {node.type === 'b-ref' ? (
          data.ok && data.entity ? (
            <EntityRawPreview
              annotations={data.annotations}
              entity={data.entity}
              getAnnotationPreview={getAnnotationPreview}
              imageSize={data.imageSize}
              imageUrl={data.imageUrl}
              previewBackgroundColor={previewBackgroundColor}
              previewScaleFactor={previewScaleFactor}
              showAnnotationFrame={showAnnotationFrame}
              useSharedScale
            />
          ) : (
            <div className="c-preview-load-state">
              {data.reason || (isNear ? 'Loading Entity preview...' : 'Waiting for preview...')}
            </div>
          )
        ) : null}

        {node.type === 'text' ? (
          <pre className="c-preview-text">{node.text || ''}</pre>
        ) : null}

        {node.type === 'file-ref' && node.fileKind === 'image' ? (
          <div className="c-preview-image-ref">
            {isNear ? (
              <div className="c-preview-image-frame fit">
                <img alt={node.display?.title || 'image ref'} src={toLabFileUrl(node.ref.filePath)} />
              </div>
            ) : (
              <div className="c-preview-load-state">Waiting for preview...</div>
            )}
          </div>
        ) : null}

        {node.type === 'file-ref' && node.fileKind === 'text' ? (
          <div className="c-preview-real-block">
            {data.ok ? (
              <pre className="c-preview-text">{textPreviewInfo.text}</pre>
            ) : (
              <div className="c-preview-load-state">
                {data.reason || (isNear ? 'Loading text file...' : 'Waiting for preview...')}
              </div>
            )}
          </div>
        ) : null}

        {node.type === 'c-ref' ? (
          <div className="c-preview-real-block">
            {cRefVisited || node.ref.cFilePath === currentCFilePath ? (
              <div className="c-preview-cycle-warning">Circular C reference stopped.</div>
            ) : cRefTooDeep ? (
              <div className="c-preview-cycle-warning">Max C reference depth reached.</div>
            ) : data.ok ? (
              <div className="c-ref-preview">
                {Array.isArray(data.data?.items) && data.data.items.length ? (
                  <ul className="c-preview-tree c-ref-preview-tree">
                    {data.data.items.map((child) => (
                      <CPreviewNode
                        currentCFilePath={node.ref.cFilePath}
                        depth={depth + 1}
                        key={child.id}
                        maxDepth={maxDepth}
                        node={child}
                        nodePath={`${nodePath}/${child.id}`}
                        previewBackgroundColor={previewBackgroundColor}
                        previewResources={previewResources}
                        previewScaleFactor={previewScaleFactor}
                        scopePrefix={scopePrefix}
                        showAnnotationFrame={showAnnotationFrame}
                        visitedCFiles={nextVisitedCFiles}
                      />
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <div className="c-preview-load-state">
                {data.reason || (isNear ? 'Loading C document...' : 'Waiting for preview...')}
              </div>
            )}
          </div>
        ) : null}
      </article>
      {node.children?.length ? (
        <ul className="c-preview-tree-children">
          {node.children.map((child) => (
            <CPreviewNode
              currentCFilePath={currentCFilePath}
              depth={depth + 1}
              key={child.id}
              maxDepth={maxDepth}
              node={child}
              nodePath={`${nodePath}/${child.id}`}
              previewBackgroundColor={previewBackgroundColor}
              previewResources={previewResources}
              previewScaleFactor={previewScaleFactor}
              scopePrefix={scopePrefix}
              showAnnotationFrame={showAnnotationFrame}
              visitedCFiles={visitedCFiles}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export default function CompositeListPreview({
  activeView,
  cDocument,
  cDocumentFilePath,
  onChangeItems,
  onDeleteItem,
  onActiveViewChange,
  onOpenBRef,
  onSelectItem,
  onUpdateItemText,
  previewResources,
  selectedCItemId,
  workspaceId = '',
}) {
  const [previewBackgroundColor, setPreviewBackgroundColor] = useState(DEFAULT_PREVIEW_BACKGROUND)
  const [previewScaleFactor, setPreviewScaleFactor] = useState(1)
  const [showAnnotationFrame, setShowAnnotationFrame] = useState(true)
  const [internalViewTab, setInternalViewTab] = useState('list')
  const viewTab = activeView || internalViewTab
  const previewScrollRef = usePreviewWheelZoom({
    enabled: viewTab === 'preview',
    scale: previewScaleFactor,
    setScale: setPreviewScaleFactor,
  })
  const scopePrefix = `${workspaceId || 'c-workspace'}:composite:${cDocumentFilePath || cDocument.id}`
  const setViewTab = (nextViewTab) => {
    if (!activeView) setInternalViewTab(nextViewTab)
    onActiveViewChange?.(nextViewTab)
  }

  const changePreviewScale = (delta) => {
    setPreviewScaleFactor((current) => Math.max(0.5, Math.min(3, Number((current + delta).toFixed(2)))))
  }

  return (
    <div className="c-document-display">
      <div className="c-document-tabs">
        {C_DOCUMENT_DISPLAY_TABS.map((tab) => (
          <button
            className={viewTab === tab.id ? 'active' : ''}
            key={tab.id}
            onClick={() => setViewTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      {viewTab === 'list' ? (
        <CItemTreePanel
          items={cDocument.items}
          onChangeItems={onChangeItems}
          onDeleteItem={onDeleteItem}
          onOpenBRef={onOpenBRef}
          onSelectItem={onSelectItem}
          onUpdateItemText={onUpdateItemText}
          readOnly={!onChangeItems || !onDeleteItem}
          selectedCItemId={selectedCItemId}
          showSelectedActions={Boolean(onChangeItems && onDeleteItem)}
        />
      ) : (
        <div className="composite-raw-preview">
          <div
            className="c-preview-paper"
            style={{ '--c-preview-background': previewBackgroundColor }}
          >
            <PreviewControlOverlay
              backgroundColor={previewBackgroundColor}
              onBackgroundColorChange={setPreviewBackgroundColor}
              onScaleChange={changePreviewScale}
              onScaleReset={() => setPreviewScaleFactor(1)}
              onShowFrameChange={setShowAnnotationFrame}
              scale={previewScaleFactor}
              showFrame={showAnnotationFrame}
            />
            <div className="c-preview-scroll" ref={previewScrollRef}>
              {cDocument.items.length === 0 ? (
                <div className="c-preview-empty">No C items.</div>
              ) : (
                <ul className="c-preview-tree">
                  {cDocument.items.map((item) => (
                    <CPreviewNode
                      currentCFilePath={cDocumentFilePath}
                      key={item.id}
                      maxDepth={MAX_C_REF_PREVIEW_DEPTH}
                      node={item}
                      nodePath={item.id}
                      previewBackgroundColor={previewBackgroundColor}
                      previewResources={previewResources}
                      previewScaleFactor={previewScaleFactor}
                      scopePrefix={scopePrefix}
                      showAnnotationFrame={showAnnotationFrame}
                      visitedCFiles={cDocumentFilePath ? [cDocumentFilePath] : []}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
