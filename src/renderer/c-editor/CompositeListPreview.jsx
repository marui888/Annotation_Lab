import { useEffect, useState } from 'react'
import PreviewControlOverlay from '../components/preview/PreviewControlOverlay'
import EntityRawPreview from '../workflow/EntityRawPreview'
import CItemTreePanel from './CItemTreePanel'
import { getTextPreviewInfo } from './cEditorUtils'

const MAX_C_REF_PREVIEW_DEPTH = 3
const DEFAULT_PREVIEW_BACKGROUND = '#ffffff'
const C_DOCUMENT_DISPLAY_TABS = [
  { id: 'list', label: 'List' },
  { id: 'preview', label: 'Preview' },
]

function toLabFileUrl(filePath) {
  return `lab-file://local/${encodeURIComponent(filePath)}`
}

function collectPreviewLoadTasks(items, options = {}) {
  const depth = options.depth || 0
  const visitedCFiles = options.visitedCFiles || []
  return items.flatMap((item) => {
    const childTasks = collectPreviewLoadTasks(item.children || [], { depth, visitedCFiles })
    if (item.type === 'b-ref' && item.ref?.dataFilePath && item.ref?.entityId) {
      return [
        {
          depth,
          id: item.id,
          kind: 'b-entity',
          filePath: item.ref.dataFilePath,
          entityId: item.ref.entityId,
        },
        ...childTasks,
      ]
    }
    if (item.type === 'file-ref' && item.fileKind === 'text' && item.ref?.filePath) {
      return [
        {
          depth,
          id: item.id,
          kind: 'text-file',
          filePath: item.ref.filePath,
        },
        ...childTasks,
      ]
    }
    if (item.type === 'c-ref' && item.ref?.cFilePath) {
      return [
        {
          depth,
          id: item.id,
          kind: 'c-file',
          filePath: item.ref.cFilePath,
          visitedCFiles,
        },
        ...childTasks,
      ]
    }
    return childTasks
  })
}

function CPreviewNode({
  currentCFilePath = '',
  node,
  depth = 0,
  maxDepth = MAX_C_REF_PREVIEW_DEPTH,
  previewBackgroundColor = DEFAULT_PREVIEW_BACKGROUND,
  previewData,
  previewScaleFactor = 1,
  showAnnotationFrame = true,
  visitedCFiles = [],
}) {
  const data = previewData[node.id]
  const textPreviewInfo = node.type === 'file-ref' && node.fileKind === 'text' && data?.ok
    ? getTextPreviewInfo(data.text)
    : null
  const cRefPath = node.type === 'c-ref' ? node.ref?.cFilePath || '' : ''
  const cRefVisited = cRefPath && visitedCFiles.includes(cRefPath)
  const cRefTooDeep = node.type === 'c-ref' && depth >= maxDepth
  const nextVisitedCFiles = cRefPath ? [...visitedCFiles, cRefPath] : visitedCFiles

  return (
    <li className="c-preview-tree-item">
      <article
        className="c-preview-source raw"
        style={{ '--preview-depth': depth }}
      >
        {node.type === 'b-ref' ? (
          data?.ok && data.entity ? (
            <EntityRawPreview
              annotations={data.annotations}
              entity={data.entity}
              imageSize={data.imageSize}
              imageUrl={data.imageUrl}
              previewBackgroundColor={previewBackgroundColor}
              previewScaleFactor={previewScaleFactor}
              showAnnotationFrame={showAnnotationFrame}
              useSharedScale
            />
          ) : (
            <div className="c-preview-load-state">{data?.reason || 'Loading Entity preview...'}</div>
          )
        ) : null}

        {node.type === 'text' ? (
          <pre className="c-preview-text">{node.text || ''}</pre>
        ) : null}

        {node.type === 'file-ref' && node.fileKind === 'image' ? (
          <div className="c-preview-image-ref">
            <div className="c-preview-image-frame fit">
              <img alt={node.display?.title || 'image ref'} src={toLabFileUrl(node.ref.filePath)} />
            </div>
          </div>
        ) : null}

        {node.type === 'file-ref' && node.fileKind === 'text' ? (
          <div className="c-preview-real-block">
            {data?.ok ? (
              <pre className="c-preview-text">{textPreviewInfo.text}</pre>
            ) : (
              <div className="c-preview-load-state">{data?.reason || 'Loading text file...'}</div>
            )}
          </div>
        ) : null}

        {node.type === 'c-ref' ? (
          <div className="c-preview-real-block">
            {cRefVisited || node.ref.cFilePath === currentCFilePath ? (
              <div className="c-preview-cycle-warning">Circular C reference stopped.</div>
            ) : cRefTooDeep ? (
              <div className="c-preview-cycle-warning">Max C reference depth reached.</div>
            ) : data?.ok ? (
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
                        previewBackgroundColor={previewBackgroundColor}
                        previewData={previewData}
                        previewScaleFactor={previewScaleFactor}
                        showAnnotationFrame={showAnnotationFrame}
                        visitedCFiles={nextVisitedCFiles}
                      />
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <div className="c-preview-load-state">{data?.reason || 'Loading C document...'}</div>
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
              previewBackgroundColor={previewBackgroundColor}
              previewData={previewData}
              previewScaleFactor={previewScaleFactor}
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
  selectedCItemId,
}) {
  const [previewData, setPreviewData] = useState({})
  const [previewBackgroundColor, setPreviewBackgroundColor] = useState(DEFAULT_PREVIEW_BACKGROUND)
  const [previewScaleFactor, setPreviewScaleFactor] = useState(1)
  const [showAnnotationFrame, setShowAnnotationFrame] = useState(true)
  const [internalViewTab, setInternalViewTab] = useState('list')
  const viewTab = activeView || internalViewTab
  const setViewTab = (nextViewTab) => {
    if (!activeView) setInternalViewTab(nextViewTab)
    onActiveViewChange?.(nextViewTab)
  }

  const changePreviewScale = (delta) => {
    setPreviewScaleFactor((current) => Math.max(0.5, Math.min(3, Number((current + delta).toFixed(2)))))
  }

  useEffect(() => {
    let canceled = false
    async function loadPreviewData() {
      const entries = []
      const loadedTaskIds = new Set()
      const cFileCache = new Map()
      let queue = collectPreviewLoadTasks(cDocument.items, {
        depth: 0,
        visitedCFiles: cDocumentFilePath ? [cDocumentFilePath] : [],
      })

      while (queue.length > 0) {
        const task = queue.shift()
        const taskKey = `${task.id}:${task.kind}:${task.filePath || ''}:${task.entityId || ''}`
        if (loadedTaskIds.has(taskKey)) continue
        loadedTaskIds.add(taskKey)

        if (task.kind === 'b-entity') {
          const result = await window.labApi?.loadAnnotationFileByPath?.(task.filePath)
          if (!result?.ok) {
            entries.push([task.id, result || { ok: false, reason: 'loadAnnotationFileByPath-unavailable' }])
            continue
          }
          const entity = (result.data?.entities || []).find((item) => item.id === task.entityId) || null
          entries.push([task.id, {
            ok: Boolean(entity),
            annotations: result.data?.annotations || [],
            entity,
            imageSize: result.image?.width && result.image?.height
              ? {
                  width: result.image.width,
                  height: result.image.height,
                }
              : null,
            imageUrl: result.image?.fileUrl || '',
            reason: entity ? '' : 'entity-not-found',
          }])
          continue
        }
        if (task.kind === 'text-file') {
          const result = await window.labApi?.readTextFile?.(task.filePath)
          entries.push([task.id, result || { ok: false, reason: 'readTextFile-unavailable' }])
          continue
        }

        if ((task.visitedCFiles || []).includes(task.filePath)) {
          entries.push([task.id, { ok: false, reason: 'circular-c-reference' }])
          continue
        }

        if (task.depth >= MAX_C_REF_PREVIEW_DEPTH) {
          entries.push([task.id, { ok: false, reason: 'max-c-reference-depth-reached' }])
          continue
        }

        const result = cFileCache.has(task.filePath)
          ? cFileCache.get(task.filePath)
          : await window.labApi?.readCDocumentFile?.(task.filePath)
        cFileCache.set(task.filePath, result)
        entries.push([task.id, result || { ok: false, reason: 'readCDocumentFile-unavailable' }])
        if (result?.ok && Array.isArray(result.data?.items)) {
          queue = [
            ...queue,
            ...collectPreviewLoadTasks(result.data.items, {
              depth: task.depth + 1,
              visitedCFiles: [...(task.visitedCFiles || []), task.filePath],
            }),
          ]
        }
      }

      if (!canceled) setPreviewData(Object.fromEntries(entries))
    }

    loadPreviewData()
    return () => {
      canceled = true
    }
  }, [cDocument.items, cDocumentFilePath])

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
            style={{
              '--c-preview-background': previewBackgroundColor,
            }}
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
            <div className="c-preview-scroll">
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
                      previewBackgroundColor={previewBackgroundColor}
                      previewData={previewData}
                      previewScaleFactor={previewScaleFactor}
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
