import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './CompositeEditor.css'
import {
  C_DOCUMENT_KINDS,
  C_DOCUMENT_SUBJECTS,
  cloneCItemsForInsert,
} from '../domain/cDocument'
import CompositeBrowser from './CompositeBrowser'
import PickCompositeItemsDialog from './PickCompositeItemsDialog'
import CReferenceRepairDialog from './reference-repair/CReferenceRepairDialog'
import EntityRawPreview from '../workflow/EntityRawPreview'

const MIN_SOURCE_WIDTH = 220
const MIN_BUILDER_WIDTH = 300
const MIN_PREVIEW_WIDTH = 260
const DEFAULT_C_EDITOR_COLUMNS = {
  source: 'calc((100% - 10px) / 3)',
  builder: 'calc((100% - 10px) / 3)',
  preview: 'calc((100% - 10px) / 3)',
}
const MIN_BUILDER_CONTROL_HEIGHT = 48
const MIN_BUILDER_PREVIEW_HEIGHT = 80
const DEFAULT_BUILDER_CONTROL_HEIGHT = 142
const DEFAULT_COMPOSITE_LAYOUT = {
  columnWidths: DEFAULT_C_EDITOR_COLUMNS,
  builderControlHeight: DEFAULT_BUILDER_CONTROL_HEIGHT,
}
const SOURCE_TYPES = [
  { id: 'b-entity', icon: 'fa-solid fa-layer-group', label: 'B Entity', ready: true },
  { id: 'composite', icon: 'fa-solid fa-book-open', label: 'Composite files', ready: true },
  { id: 'image', icon: 'fa-solid fa-image', label: 'Image files', ready: true },
  { id: 'text', icon: 'fa-solid fa-file-lines', label: 'Text files', ready: true },
  { id: 'video', icon: 'fa-solid fa-film', label: 'Video files', ready: false },
]

const SOURCE_FILE_CONFIG = {
  composite: {
    title: 'Add Composite source file',
    folderTitle: 'Add Composite source folder',
    fileKind: 'c-ref',
  },
  image: {
    title: 'Add Image source file',
    folderTitle: 'Add Image source folder',
    fileKind: 'image-ref',
  },
  text: {
    title: 'Add Text source file',
    folderTitle: 'Add Text source folder',
    fileKind: 'text-ref',
  },
}

function getSourceSummary(source) {
  if (!source) return '--'
  if (source.type === 'folder') return source.folderPath
  if (source.type === 'annotation-file') return source.filePath
  return source.id || '--'
}

function getStatusClassName(status) {
  if (status === 'Unsaved') return 'status-unsaved'
  if (String(status || '').startsWith('Save failed')) return 'status-error'
  if (status === 'Saving...') return 'status-saving'
  return ''
}

function getBIndexItemKey(item) {
  return `${item.dataFilePath}:${item.entityId}`
}

function getUniqueValues(items, getValue) {
  return Array.from(new Set(items.map(getValue).filter(Boolean))).sort((a, b) => a.localeCompare(b))
}

function getFilteredBIndexItems(items, filter) {
  const subject = filter?.subject || 'all'
  const kind = filter?.kind || 'all'
  const source = filter?.source || 'all'
  const query = String(filter?.query || '').trim().toLowerCase()

  return items.filter((item) => {
    if (subject !== 'all' && item.subject !== subject) return false
    if (kind !== 'all' && item.kind !== kind) return false
    if (source !== 'all' && item.dataFilePath !== source) return false
    if (!query) return true
    return [
      item.label,
      item.subject,
      item.kind,
      item.entityId,
      item.dataFilePath,
      item.sourceFilePath,
    ].some((value) => String(value || '').toLowerCase().includes(query))
  })
}

export default function CompositeEditor({
  bIndexItems,
  bIndexFilter,
  bIndexSources,
  cDocument,
  cDocumentFilePath,
  cSaveStatus,
  layoutState = DEFAULT_COMPOSITE_LAYOUT,
  onAddBIndexItem,
  onAddCRefItem,
  onAddFileRefItem,
  onAddTextItem,
  onChangeItems,
  onDeleteItem,
  onOpenBRef,
  onOpenCRef,
  onScanAnnotationFiles,
  onScanFolders,
  onLayoutStateChange,
  onSelectBIndexItem,
  onSelectItem,
  onUpdateBIndexFilter,
  onUpdateDocumentField,
  onUpdateItemText,
  repairRequestId = 0,
  selectedBIndexItemKey,
  selectedCItemId,
}) {
  const builderRef = useRef(null)
  const selectedDetailRef = useRef(null)
  const sourceAreaRef = useRef(null)
  const effectiveLayoutState = useMemo(() => ({
    ...DEFAULT_COMPOSITE_LAYOUT,
    ...layoutState,
    columnWidths: {
      ...DEFAULT_C_EDITOR_COLUMNS,
      ...layoutState.columnWidths,
    },
  }), [layoutState])
  const [activeSourceType, setActiveSourceType] = useState('b-entity')
  const columnWidths = effectiveLayoutState.columnWidths
  const [externalSourceItems, setExternalSourceItems] = useState([])
  const builderControlHeight = effectiveLayoutState.builderControlHeight
  const [pickingCompositeSource, setPickingCompositeSource] = useState(null)
  const [repairDialogOpen, setRepairDialogOpen] = useState(false)
  const [resizingBuilderControl, setResizingBuilderControl] = useState(false)
  const [resizingColumn, setResizingColumn] = useState(null)
  const [expandedBSourcePreview, setExpandedBSourcePreview] = useState({ key: '', status: 'idle' })
  const filteredBIndexItems = getFilteredBIndexItems(bIndexItems, bIndexFilter)
  const subjectOptions = getUniqueValues(bIndexItems, (item) => item.subject)
  const kindOptions = getUniqueValues(
    bIndexItems.filter((item) => !bIndexFilter?.subject || bIndexFilter.subject === 'all' || item.subject === bIndexFilter.subject),
    (item) => item.kind,
  )
  const sourceOptions = getUniqueValues(bIndexItems, (item) => item.dataFilePath)
  const activeExternalSourceItems = externalSourceItems.filter((item) => item.sourceType === activeSourceType)
  const activeSourceLabel = SOURCE_TYPES.find((item) => item.id === activeSourceType)?.label || activeSourceType
  const activeSourceItemCount = activeSourceType === 'b-entity'
    ? filteredBIndexItems.length
    : activeExternalSourceItems.length
  const expandedBSourceKey = selectedBIndexItemKey
  const selectedBSourceItem = bIndexItems.find((item) => getBIndexItemKey(item) === expandedBSourceKey) || null
  const currentExpandedBSourcePreview = selectedBSourceItem && expandedBSourcePreview.key === expandedBSourceKey
    ? expandedBSourcePreview
    : { key: expandedBSourceKey, status: selectedBSourceItem ? 'loading' : 'idle' }

  const updateLayoutState = useCallback((patch) => {
    onLayoutStateChange?.({
      ...effectiveLayoutState,
      ...patch,
    })
  }, [effectiveLayoutState, onLayoutStateChange])

  useEffect(() => {
    if (!resizingColumn) return undefined

    const handleMouseMove = (event) => {
      const deltaX = event.clientX - resizingColumn.startX
      if (resizingColumn.column === 'source') {
        updateLayoutState({
          columnWidths: {
            ...columnWidths,
            source: Math.max(MIN_SOURCE_WIDTH, resizingColumn.startWidth + deltaX),
          },
        })
        return
      }

      updateLayoutState({
        columnWidths: {
          ...columnWidths,
          preview: Math.max(MIN_PREVIEW_WIDTH, resizingColumn.startWidth - deltaX),
        },
      })
    }

    const handleMouseUp = () => setResizingColumn(null)

    document.body.classList.add('c-editor-resizing')
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.body.classList.remove('c-editor-resizing')
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [columnWidths, resizingColumn, updateLayoutState])

  useEffect(() => {
    if (!resizingBuilderControl) return undefined

    const handleMouseMove = (event) => {
      const rect = builderRef.current?.getBoundingClientRect()
      if (!rect) return
      const maxControlHeight = Math.max(
        MIN_BUILDER_CONTROL_HEIGHT,
        rect.height - MIN_BUILDER_PREVIEW_HEIGHT - 6,
      )
      const nextHeight = Math.max(
        MIN_BUILDER_CONTROL_HEIGHT,
        Math.min(maxControlHeight, rect.bottom - event.clientY),
      )
      updateLayoutState({ builderControlHeight: nextHeight })
    }

    const handleMouseUp = () => setResizingBuilderControl(false)

    document.body.classList.add('c-editor-row-resizing')
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.body.classList.remove('c-editor-row-resizing')
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [resizingBuilderControl, updateLayoutState])

  useEffect(() => {
    if (!repairRequestId) return
    const timer = window.setTimeout(() => setRepairDialogOpen(true), 0)
    return () => window.clearTimeout(timer)
  }, [repairRequestId])

  useEffect(() => {
    const selectedBItem = selectedBSourceItem
    if (!selectedBItem) return undefined
    if (expandedBSourcePreview.key === expandedBSourceKey) return undefined

    let canceled = false
    async function loadBSourcePreview() {
      const result = await window.labApi?.loadAnnotationFileByPath?.(selectedBItem.dataFilePath)
      if (canceled) return
      if (!result?.ok) {
        setExpandedBSourcePreview({
          key: expandedBSourceKey,
          status: 'ready',
          ok: false,
          reason: result?.reason || 'loadAnnotationFileByPath-unavailable',
        })
        return
      }
      const entity = (result.data?.entities || []).find((item) => item.id === selectedBItem.entityId) || null
      setExpandedBSourcePreview({
        key: expandedBSourceKey,
        status: 'ready',
        ok: Boolean(entity),
        annotations: result.data?.annotations || [],
        entity,
        imageSize: result.image?.width && result.image?.height
          ? { width: result.image.width, height: result.image.height }
          : null,
        imageUrl: result.image?.fileUrl || '',
        reason: entity ? '' : 'entity-not-found',
      })
    }
    loadBSourcePreview()
    return () => {
      canceled = true
    }
  }, [expandedBSourceKey, expandedBSourcePreview.key, selectedBSourceItem])

  const startColumnResize = (column, event) => {
    event.preventDefault()
    const startWidth = column === 'source'
      ? selectedDetailRef.current?.getBoundingClientRect().width
      : sourceAreaRef.current?.getBoundingClientRect().width
    setResizingColumn({
      column,
      startX: event.clientX,
      startWidth: startWidth || (column === 'source' ? MIN_SOURCE_WIDTH : MIN_PREVIEW_WIDTH),
    })
  }

  const createExternalSourceItems = async (files, sourceType) => {
    const nextItems = await Promise.all(files.map(async (file) => {
      let meta = {}
      if (sourceType === 'composite') {
        const readResult = await window.labApi?.readCDocumentFile?.(file.filePath)
        if (readResult?.ok) {
          meta = {
            title: readResult.data?.title || file.fileName,
            itemCount: readResult.data?.items?.length || 0,
          }
        }
      }

      return {
        id: `${sourceType}:${file.filePath}`,
        sourceType,
        filePath: file.filePath,
        fileName: file.fileName,
        fileKind: sourceType,
        ...meta,
      }
    }))

    setExternalSourceItems((current) => [
      ...nextItems,
      ...current.filter((item) => !nextItems.some((nextItem) => nextItem.id === item.id)),
    ])
  }

  const addExternalSourceFile = async () => {
    const config = SOURCE_FILE_CONFIG[activeSourceType]
    if (!config) return
    const result = await window.labApi?.selectFileForReference?.({
      fileKind: config.fileKind,
      title: config.title,
      multiSelections: true,
    })
    if (!result?.ok) return

    await createExternalSourceItems(result.files || [result], activeSourceType)
  }

  const addExternalSourceFolder = async () => {
    const config = SOURCE_FILE_CONFIG[activeSourceType]
    if (!config) return
    const result = await window.labApi?.selectReferenceFolder?.({
      fileKind: config.fileKind,
      title: config.folderTitle,
    })
    if (!result?.ok) return
    await createExternalSourceItems(result.files || [], activeSourceType)
  }

  const clearActiveExternalSources = () => {
    setExternalSourceItems((current) => current.filter((item) => item.sourceType !== activeSourceType))
  }

  const renderExternalSourceActions = () => {
    const canAddFromFolder = Boolean(SOURCE_FILE_CONFIG[activeSourceType])
    return (
      <div className="c-source-actions">
        <button disabled={!canAddFromFolder} onClick={addExternalSourceFolder} type="button">From folder</button>
        <button disabled={!canAddFromFolder} onClick={addExternalSourceFile} type="button">Add File</button>
        <button disabled={activeExternalSourceItems.length === 0} onClick={clearActiveExternalSources} type="button">Clear</button>
      </div>
    )
  }

  const renderBEntitySourceActions = () => (
    <div className="c-source-actions">
      <button onClick={onScanFolders} type="button">From folder</button>
      <button onClick={onScanAnnotationFiles} type="button">Add File</button>
    </div>
  )

  const addExternalSourceItemToDocument = (item) => {
    if (!item) return
    if (item.sourceType === 'composite') {
      onAddCRefItem({
        ok: true,
        filePath: item.filePath,
        fileName: item.fileName,
      })
      return
    }
    if (item.sourceType === 'image' || item.sourceType === 'text') {
      onAddFileRefItem({
        ok: true,
        filePath: item.filePath,
        fileName: item.fileName,
        fileKind: item.sourceType,
      })
    }
  }

  const openPickCompositeItemsDialog = async (item) => {
    if (!item?.filePath) return
    const result = await window.labApi?.readCDocumentFile?.(item.filePath)
    if (!result?.ok) return
    setPickingCompositeSource({
      filePath: item.filePath,
      fileName: item.fileName,
      data: result.data,
    })
  }

  const addPickedCompositeItems = (items) => {
    const blockedItems = items.filter((item) => (
      item.type === 'c-ref'
      && cDocumentFilePath
      && item.ref?.cFilePath === cDocumentFilePath
    ))
    if (blockedItems.length > 0) {
      window.alert('Cannot add an item that directly references current Composite document.')
      return
    }

    const clonedItems = cloneCItemsForInsert(items)
    if (clonedItems.length === 0) return
    onChangeItems([...(cDocument.items || []), ...clonedItems])
    onSelectItem(clonedItems[clonedItems.length - 1].id)
    setPickingCompositeSource(null)
  }

  const addWholePickedComposite = (source) => {
    if (!source?.filePath) return
    if (cDocumentFilePath && source.filePath === cDocumentFilePath) {
      window.alert('Cannot add current C document as its own C Ref.')
      return
    }
    onAddCRefItem({
      ok: true,
      filePath: source.filePath,
      fileName: source.fileName,
    })
  }

  const openWholePickedComposite = (source) => {
    if (!source?.filePath) return
    onOpenCRef?.({
      type: 'c-ref',
      ref: {
        cFilePath: source.filePath,
      },
    })
    setPickingCompositeSource(null)
  }

  const renderExternalSourcePool = () => {
    if (activeSourceType === 'video') {
      return <div className="empty-state">Video source pool is reserved for frame-based workflow.</div>
    }

    return (
      <>
        <div className="section-title">{SOURCE_TYPES.find((item) => item.id === activeSourceType)?.label}</div>
        {renderExternalSourceActions()}
        <div className="c-pool-list">
          {activeExternalSourceItems.length === 0 ? (
            <div className="empty-state">No source files.</div>
          ) : activeExternalSourceItems.map((item) => (
            <div className="c-external-source-row" key={item.id}>
              {item.sourceType === 'composite' ? (
                <div className="c-external-source-actions">
                  <button data-tooltip="Add Whole" onClick={() => addExternalSourceItemToDocument(item)} type="button">
                    <i className="fa-solid fa-file-circle-plus" />
                  </button>
                  <button data-tooltip="Pick Items" onClick={() => openPickCompositeItemsDialog(item)} type="button">
                    <i className="fa-solid fa-list-check" />
                  </button>
                </div>
              ) : (
                <button data-tooltip="Add" onClick={() => addExternalSourceItemToDocument(item)} type="button">
                  <i className="fa-solid fa-plus" />
                </button>
              )}
              <div title={item.filePath}>
                <strong>{item.title || item.fileName}</strong>
                <small>
                  {item.sourceType}
                  {item.itemCount !== undefined ? ` / ${item.itemCount} item(s)` : ''}
                </small>
                <small>{item.filePath}</small>
              </div>
            </div>
          ))}
        </div>
      </>
    )
  }

  const renderSourcePool = () => (
    <div className="c-source-workspace">
      <div className="c-source-main">
        {activeSourceType === 'b-entity' ? (
          <>
            <div className="section-title">B Entity Sources</div>
            {renderBEntitySourceActions()}
            <div className="c-source-list">
              {bIndexSources.length === 0 ? (
                <div className="empty-state">No B sources.</div>
              ) : bIndexSources.map((source) => (
                <div className="c-source-row" key={source.id} title={getSourceSummary(source)}>
                  <strong>{source.type}</strong>
                  <small>{getSourceSummary(source)}</small>
                </div>
              ))}
            </div>

            <div className="section-title">B Entity Pool</div>
            <div className="c-pool-filter">
              <label>
                Subject
                <select
                  onChange={(event) => onUpdateBIndexFilter({ subject: event.target.value, kind: 'all' })}
                  value={bIndexFilter?.subject || 'all'}
                >
                  <option value="all">All</option>
                  {subjectOptions.map((subject) => (
                    <option key={subject} value={subject}>{subject}</option>
                  ))}
                </select>
              </label>
              <label>
                Kind
                <select
                  onChange={(event) => onUpdateBIndexFilter({ kind: event.target.value })}
                  value={bIndexFilter?.kind || 'all'}
                >
                  <option value="all">All</option>
                  {kindOptions.map((kind) => (
                    <option key={kind} value={kind}>{kind}</option>
                  ))}
                </select>
              </label>
              <label>
                Source
                <select
                  onChange={(event) => onUpdateBIndexFilter({ source: event.target.value })}
                  value={bIndexFilter?.source || 'all'}
                >
                  <option value="all">All sources</option>
                  {sourceOptions.map((sourcePath) => (
                    <option key={sourcePath} value={sourcePath}>{sourcePath}</option>
                  ))}
                </select>
              </label>
              <label>
                Find
                <input
                  onChange={(event) => onUpdateBIndexFilter({ query: event.target.value })}
                  placeholder="label / kind / file"
                  value={bIndexFilter?.query || ''}
                />
              </label>
              <small>{filteredBIndexItems.length} / {bIndexItems.length}</small>
            </div>
            <div className="c-pool-list">
              {bIndexItems.length === 0 ? (
                <div className="empty-state">No B Entity index.</div>
              ) : filteredBIndexItems.length === 0 ? (
                <div className="empty-state">No B Entity matched.</div>
              ) : filteredBIndexItems.map((item) => (
                <div
                  className={getBIndexItemKey(item) === selectedBIndexItemKey ? 'c-pool-row selected expanded' : 'c-pool-row'}
                  key={getBIndexItemKey(item)}
                  onClick={() => onSelectBIndexItem(item)}
                >
                  <div className="c-pool-row-main">
                    <div className="c-pool-row-actions">
                      <button data-tooltip="Add" onClick={(event) => { event.stopPropagation(); onAddBIndexItem(item) }} type="button">
                        <i className="fa-solid fa-plus" />
                      </button>
                      <button
                        data-tooltip="Open"
                        onClick={(event) => {
                          event.stopPropagation()
                          onOpenBRef({
                            type: 'b-ref',
                            ref: {
                              dataFilePath: item.dataFilePath,
                              entityId: item.entityId,
                              sourceFilePath: item.sourceFilePath,
                            },
                          })
                        }}
                        type="button"
                      >
                        <i className="fa-solid fa-up-right-from-square" />
                      </button>
                    </div>
                    <div title={item.dataFilePath}>
                      <strong>{item.subject} / {item.kind}</strong>
                      <small>{item.label} / {item.aObjectCount} A / {item.ruleOk ? 'Rule OK' : 'Rule issue'}</small>
                    </div>
                  </div>
                  {getBIndexItemKey(item) === selectedBIndexItemKey ? (
                    <div className="c-pool-row-preview" onClick={(event) => event.stopPropagation()}>
                      {currentExpandedBSourcePreview.status === 'loading' ? (
                        <div className="c-preview-load-state">Loading Entity preview...</div>
                      ) : currentExpandedBSourcePreview.ok && currentExpandedBSourcePreview.entity ? (
                        <EntityRawPreview
                          annotations={currentExpandedBSourcePreview.annotations}
                          entity={currentExpandedBSourcePreview.entity}
                          imageSize={currentExpandedBSourcePreview.imageSize}
                          imageUrl={currentExpandedBSourcePreview.imageUrl}
                          readOnly
                          showAnnotationFrame
                          useSharedScale
                        />
                      ) : (
                        <div className="c-preview-load-state">{currentExpandedBSourcePreview.reason || 'Entity preview unavailable.'}</div>
                      )}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : renderExternalSourcePool()}
      </div>
      <nav className="c-source-type-rail" aria-label="Composite source types">
        {SOURCE_TYPES.map((sourceType) => (
          <button
            aria-label={sourceType.label}
            className={[
              activeSourceType === sourceType.id ? 'active' : '',
              sourceType.ready ? '' : 'disabled',
            ].filter(Boolean).join(' ')}
            data-tooltip={sourceType.label}
            disabled={!sourceType.ready}
            key={sourceType.id}
            onClick={() => setActiveSourceType(sourceType.id)}
            type="button"
          >
            <i className={sourceType.icon} />
          </button>
        ))}
      </nav>
    </div>
  )

  return (
    <section className="c-editor">
      <div className="c-editor-body">
        <aside
          className="c-selected-detail"
          ref={selectedDetailRef}
          style={{ flexBasis: columnWidths.source }}
        >
          <CompositeBrowser
            bIndexItems={bIndexItems}
            cDocument={cDocument}
            cDocumentFilePath={cDocumentFilePath}
            onOpenBRef={onOpenBRef}
            onOpenCRef={onOpenCRef}
            onUpdateItemText={onUpdateItemText}
            panel="detail"
            selectedBIndexItemKey={selectedBIndexItemKey}
            selectedCItemId={selectedCItemId}
          />
        </aside>

        <div
          aria-label="Resize C selected detail"
          className="c-editor-splitter"
          onMouseDown={(event) => startColumnResize('source', event)}
          role="separator"
          title="Resize selected detail"
        />

        <section
          className="c-builder"
          style={{ flexBasis: columnWidths.builder, minWidth: MIN_BUILDER_WIDTH }}
        >
          <div
            className="c-builder-workspace"
            ref={builderRef}
            style={{
              gridTemplateRows: `minmax(0, 1fr) 6px ${builderControlHeight}px`,
            }}
          >
            <div className="c-builder-preview-area">
              <CompositeBrowser
                cDocument={cDocument}
                cDocumentFilePath={cDocumentFilePath}
                onChangeItems={onChangeItems}
                onDeleteItem={onDeleteItem}
                onOpenBRef={onOpenBRef}
                onOpenCRef={onOpenCRef}
                onSelectItem={onSelectItem}
                onUpdateItemText={onUpdateItemText}
                panel="document"
                selectedCItemId={selectedCItemId}
                showFilter
              />
            </div>

            <div
              aria-label="Resize Composite Builder control area"
              className="c-builder-row-splitter"
              onMouseDown={(event) => {
                event.preventDefault()
                setResizingBuilderControl(true)
              }}
              role="separator"
              title="Resize builder control area"
            />

            <div className="c-builder-control-area">
              <div className="c-doc-fields">
                <label>
                  Title
                  <input onChange={(event) => onUpdateDocumentField('title', event.target.value)} value={cDocument.title} />
                </label>
                <label>
                  Subject
                  <select onChange={(event) => onUpdateDocumentField('subject', event.target.value)} value={cDocument.subject}>
                    {C_DOCUMENT_SUBJECTS.map((subject) => (
                      <option key={subject.value} value={subject.value}>{subject.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Kind
                  <select onChange={(event) => onUpdateDocumentField('kind', event.target.value)} value={cDocument.kind}>
                    {C_DOCUMENT_KINDS.map((kind) => (
                      <option key={kind.value} value={kind.value}>{kind.label}</option>
                    ))}
                  </select>
                </label>
                <dl>
                  <dt>Status</dt>
                  <dd className={getStatusClassName(cSaveStatus)}>{cSaveStatus}</dd>
                  <dt>Items</dt>
                  <dd>{cDocument.items.length}</dd>
                </dl>
              </div>

              <div className="c-item-toolbar">
                <button onClick={onAddTextItem} type="button">Add Text</button>
                <button onClick={onAddFileRefItem} type="button">Add File</button>
                <button onClick={onAddCRefItem} type="button">Add C Ref</button>
              </div>
            </div>
          </div>
        </section>

        <div
          aria-label="Resize C preview"
          className="c-editor-splitter"
          onMouseDown={(event) => startColumnResize('preview', event)}
          role="separator"
          title="Resize preview"
        />

        <aside
          className="c-source-area"
          ref={sourceAreaRef}
          style={{ flexBasis: columnWidths.preview }}
        >
          <div className="section-title">Sources</div>
          {renderSourcePool()}
        </aside>
      </div>
      <footer className="c-editor-statusbar">
        <span>Title: <strong title={cDocument.title}>{cDocument.title}</strong></span>
        <span>File: <strong title={cDocumentFilePath}>{cDocumentFilePath || '--'}</strong></span>
        <span>Type: <strong>{cDocument.subject} / {cDocument.kind}</strong></span>
        <span>Items: <strong>{cDocument.items.length}</strong></span>
        <span>Active Source: <strong>{activeSourceLabel}</strong></span>
        <span>Source Items: <strong>{activeSourceItemCount}</strong></span>
        <span>B Sources: <strong>{bIndexSources.length}</strong></span>
        <span>B Pool: <strong>{bIndexItems.length}</strong></span>
        <span>Status: <strong className={getStatusClassName(cSaveStatus)}>{cSaveStatus}</strong></span>
      </footer>
      {repairDialogOpen ? (
        <CReferenceRepairDialog
          cDocument={cDocument}
          cDocumentFilePath={cDocumentFilePath}
          cSaveStatus={cSaveStatus}
          onClose={() => setRepairDialogOpen(false)}
        />
      ) : null}
      {pickingCompositeSource ? (
        <PickCompositeItemsDialog
          fileName={pickingCompositeSource.fileName}
          filePath={pickingCompositeSource.filePath}
          onAddWhole={addWholePickedComposite}
          onAddSelected={addPickedCompositeItems}
          onClose={() => setPickingCompositeSource(null)}
          onOpenWhole={openWholePickedComposite}
          sourceDocument={pickingCompositeSource.data}
        />
      ) : null}
    </section>
  )
}
