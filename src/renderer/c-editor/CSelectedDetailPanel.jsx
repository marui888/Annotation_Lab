import { useEffect, useMemo, useRef, useState } from 'react'
import { normalizeCDocument } from '../domain/cDocument'
import EntityListPreview from '../workflow/EntityListPreview'
import CompositeListPreview from './CompositeListPreview'
import { getCItemSummary, getTextPreviewInfo, TEXT_PREVIEW_LIMIT } from './cEditorUtils'

function toLabFileUrl(filePath) {
  return `lab-file://local/${encodeURIComponent(filePath)}`
}

function getFileName(filePath = '') {
  const normalized = String(filePath || '').replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).pop() || filePath || '--'
}

function createEntityPreviewData(result, entityId) {
  if (!result?.ok) return result || { ok: false, reason: 'loadAnnotationFileByPath-unavailable' }
  const entity = (result.data?.entities || []).find((item) => item.id === entityId) || null
  return {
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
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function DetailHeader({ title, onOpen }) {
  return (
    <div className="c-selected-detail-header">
      <div className="section-title">{title}</div>
      {onOpen ? (
        <button
          aria-label="Open"
          className="c-detail-open-button"
          data-tooltip="Open"
          onClick={onOpen}
          type="button"
        >
          <i className="fa-solid fa-up-right-from-square" />
        </button>
      ) : null}
    </div>
  )
}

function DetailScaleControls({
  label,
  onDecrease,
  onReset,
  onIncrease,
  value,
}) {
  return (
    <div className="c-detail-scale-controls" aria-label={`${label} controls`}>
      <button data-tooltip={`Smaller ${label}`} onClick={onDecrease} type="button">-</button>
      <button data-tooltip={`Reset ${label}`} onClick={onReset} type="button">{value}</button>
      <button data-tooltip={`Larger ${label}`} onClick={onIncrease} type="button">+</button>
    </div>
  )
}

function ImageDetailView({ selectedCItem }) {
  const viewportRef = useRef(null)
  const [imageViewState, setImageViewState] = useState({ itemId: '', mode: 'fit', scale: 1 })
  const [imageNaturalState, setImageNaturalState] = useState({ itemId: '', width: 0, height: 0 })
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const currentImageViewState = imageViewState.itemId === selectedCItem.id
    ? imageViewState
    : { itemId: selectedCItem.id, mode: 'fit', scale: 1 }
  const imageNaturalSize = imageNaturalState.itemId === selectedCItem.id
    ? imageNaturalState
    : { itemId: selectedCItem.id, width: 0, height: 0 }

  const updateImageViewState = (patch) => {
    setImageViewState((current) => ({
      itemId: selectedCItem.id,
      mode: current.itemId === selectedCItem.id ? current.mode : 'fit',
      scale: current.itemId === selectedCItem.id ? current.scale : 1,
      ...patch,
    }))
  }

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return undefined
    const resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      setViewportSize({
        width: rect.width,
        height: rect.height,
      })
    })
    resizeObserver.observe(viewport)
    return () => resizeObserver.disconnect()
  }, [])

  const fitScale = imageNaturalSize.width && imageNaturalSize.height && viewportSize.width && viewportSize.height
    ? Math.min(viewportSize.width / imageNaturalSize.width, viewportSize.height / imageNaturalSize.height)
    : 1
  const effectiveScale = currentImageViewState.mode === 'fit'
    ? fitScale
    : currentImageViewState.mode === 'actual'
      ? 1
      : currentImageViewState.scale
  const imageWidth = imageNaturalSize.width ? imageNaturalSize.width * effectiveScale : undefined
  const imageHeight = imageNaturalSize.height ? imageNaturalSize.height * effectiveScale : undefined

  return (
    <div className="c-image-detail-view">
      <DetailHeader title="Selected Image File" />
      <div className="c-image-detail-controls">
        <button
          data-tooltip="Smaller Image"
          onClick={() => updateImageViewState({
            mode: 'zoom',
            scale: clamp(Number((currentImageViewState.scale - 0.1).toFixed(2)), 0.2, 4),
          })}
          type="button"
        >
          -
        </button>
        <button
          className={currentImageViewState.mode === 'fit' ? 'active' : ''}
          data-tooltip="Fit Image"
          onClick={() => updateImageViewState({ mode: 'fit', scale: 1 })}
          type="button"
        >
          Fit
        </button>
        <button
          className={currentImageViewState.mode === 'actual' ? 'active' : ''}
          data-tooltip="Actual Size"
          onClick={() => updateImageViewState({ mode: 'actual', scale: 1 })}
          type="button"
        >
          100%
        </button>
        <button
          data-tooltip="Larger Image"
          onClick={() => updateImageViewState({
            mode: 'zoom',
            scale: clamp(Number((currentImageViewState.scale + 0.1).toFixed(2)), 0.2, 4),
          })}
          type="button"
        >
          +
        </button>
        <span>{Math.round(effectiveScale * 100)}%</span>
      </div>
      <div className="c-preview-file-header">
        <div>
          <strong>{selectedCItem.display?.title || getFileName(selectedCItem.ref.filePath)}</strong>
          <small title={selectedCItem.ref.filePath}>{selectedCItem.ref.filePath}</small>
        </div>
      </div>
      <div className="c-image-detail-viewport" ref={viewportRef}>
        <div className="c-image-detail-canvas">
          <img
            alt={selectedCItem.display?.title || 'selected image'}
            height={imageHeight}
            onLoad={(event) => {
              setImageNaturalState({
                itemId: selectedCItem.id,
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }}
            src={toLabFileUrl(selectedCItem.ref.filePath)}
            width={imageWidth}
          />
        </div>
      </div>
    </div>
  )
}

function getLoadTarget(selectedCItem) {
  if (selectedCItem?.type === 'b-ref') {
    return {
      entityId: selectedCItem.ref.entityId,
      filePath: selectedCItem.ref.dataFilePath,
      key: `c-b-ref:${selectedCItem.id}:${selectedCItem.ref.dataFilePath}:${selectedCItem.ref.entityId}`,
      kind: 'b-entity',
    }
  }

  if (selectedCItem?.type === 'file-ref' && selectedCItem.fileKind === 'text') {
    return {
      filePath: selectedCItem.ref.filePath,
      key: `c-text-file:${selectedCItem.id}:${selectedCItem.ref.filePath}`,
      kind: 'text-file',
    }
  }

  if (selectedCItem?.type === 'c-ref') {
    return {
      filePath: selectedCItem.ref.cFilePath,
      key: `c-ref:${selectedCItem.id}:${selectedCItem.ref.cFilePath}`,
      kind: 'c-document',
    }
  }

  return null
}

function EntityDetail({
  activeView,
  data,
  fallbackLabel,
  onActiveViewChange,
}) {
  if (data?.status === 'loading') {
    return <div className="c-preview-load-state">Loading Entity preview...</div>
  }

  if (!data?.ok) {
    return (
      <div className="c-preview-card rule-warning">
        <strong>{fallbackLabel}</strong>
        <span>{data?.reason || 'Entity preview unavailable.'}</span>
      </div>
    )
  }

  return (
    <EntityListPreview
      activeView={activeView}
      annotations={data.annotations}
      entity={data.entity}
      imageSize={data.imageSize}
      imageUrl={data.imageUrl}
      onActiveViewChange={onActiveViewChange}
      readOnly
    />
  )
}

export default function CSelectedDetailPanel({
  onOpenBRef,
  onOpenCRef,
  onUpdateItemText,
  selectedCItem,
}) {
  const [loadState, setLoadState] = useState({ key: '', status: 'idle' })
  const [entityDetailView, setEntityDetailView] = useState('list')
  const [compositeDetailView, setCompositeDetailView] = useState('list')
  const [textFontSize, setTextFontSize] = useState(14)
  const loadTarget = useMemo(
    () => getLoadTarget(selectedCItem),
    [selectedCItem],
  )
  const detailState = loadTarget && loadState.key !== loadTarget.key
    ? { key: loadTarget.key, status: 'loading' }
    : loadState
  const isSelectedImage = selectedCItem?.type === 'file-ref' && selectedCItem.fileKind === 'image'

  useEffect(() => {
    if (!loadTarget) {
      return undefined
    }

    let canceled = false

    async function loadSelectedDetail() {
      if (loadTarget.kind === 'b-entity') {
        const result = await window.labApi?.loadAnnotationFileByPath?.(loadTarget.filePath)
        if (!canceled) {
          setLoadState({
            key: loadTarget.key,
            status: 'ready',
            ...createEntityPreviewData(result, loadTarget.entityId),
          })
        }
        return
      }

      if (loadTarget.kind === 'text-file') {
        const result = await window.labApi?.readTextFile?.(loadTarget.filePath)
        if (!canceled) {
          setLoadState({
            key: loadTarget.key,
            status: 'ready',
            ...(result || { ok: false, reason: 'readTextFile-unavailable' }),
          })
        }
        return
      }

      const result = await window.labApi?.readCDocumentFile?.(loadTarget.filePath)
      if (!canceled) {
        setLoadState({
          key: loadTarget.key,
          status: 'ready',
          ...(result || { ok: false, reason: 'readCDocumentFile-unavailable' }),
        })
      }
    }

    loadSelectedDetail()
    return () => {
      canceled = true
    }
  }, [loadTarget])

  const openSelectedEntity = () => {
    if (selectedCItem?.type === 'b-ref') {
      onOpenBRef?.(selectedCItem)
      return
    }
  }

  const renderDetailContent = () => {
    if (selectedCItem?.type === 'text') {
      return (
        <>
          <DetailHeader title="Selected Text Item" />
          <DetailScaleControls
            label="Text"
            onDecrease={() => setTextFontSize((current) => clamp(current - 1, 10, 32))}
            onIncrease={() => setTextFontSize((current) => clamp(current + 1, 10, 32))}
            onReset={() => setTextFontSize(14)}
            value={`${textFontSize}px`}
          />
          <textarea
            className="c-selected-detail-text"
            onChange={(event) => onUpdateItemText(selectedCItem.id, event.target.value)}
            style={{ fontSize: textFontSize }}
            value={selectedCItem.text}
          />
          <small className="c-detail-path" title={selectedCItem.id}>{selectedCItem.id}</small>
        </>
      )
    }

  if (selectedCItem?.type === 'b-ref') {
    return (
      <>
        <DetailHeader title="Selected B Ref" onOpen={openSelectedEntity} />
        <EntityDetail
          activeView={entityDetailView}
          data={detailState}
          fallbackLabel={getCItemSummary(selectedCItem)}
          onActiveViewChange={setEntityDetailView}
        />
        <small className="c-detail-path" title={selectedCItem.ref.dataFilePath}>{selectedCItem.ref.dataFilePath}</small>
      </>
    )
  }

  if (selectedCItem?.type === 'file-ref' && selectedCItem.fileKind === 'image') {
    return (
      <>
        <DetailHeader title="Selected Image File" />
        <div className="c-preview-card">
          <strong>{selectedCItem.display?.title || getFileName(selectedCItem.ref.filePath)}</strong>
          <span>Open the Image tab to inspect the image.</span>
          <small title={selectedCItem.ref.filePath}>{selectedCItem.ref.filePath}</small>
        </div>
      </>
    )
  }

  if (selectedCItem?.type === 'file-ref' && selectedCItem.fileKind === 'text') {
    const textInfo = detailState.ok ? getTextPreviewInfo(detailState.text) : null
    return (
      <>
        <DetailHeader title="Selected Text File" />
        <DetailScaleControls
          label="Text"
          onDecrease={() => setTextFontSize((current) => clamp(current - 1, 10, 32))}
          onIncrease={() => setTextFontSize((current) => clamp(current + 1, 10, 32))}
          onReset={() => setTextFontSize(14)}
          value={`${textFontSize}px`}
        />
        <div className="c-preview-real-block">
          <div className="c-preview-file-header">
            <div>
              <strong>{selectedCItem.display?.title || getFileName(selectedCItem.ref.filePath)}</strong>
              <small title={selectedCItem.ref.filePath}>{selectedCItem.ref.filePath}</small>
            </div>
          </div>
          {detailState.status === 'loading' ? (
            <div className="c-preview-load-state">Loading text file...</div>
          ) : detailState.ok ? (
            <>
              <div className="c-preview-text-meta">
                <span>Lines: {textInfo.lineCount}</span>
                <span>Chars: {textInfo.charCount}</span>
                {textInfo.truncated ? (
                  <span className="c-preview-truncated">Preview: first {TEXT_PREVIEW_LIMIT} chars</span>
                ) : null}
              </div>
              <pre className="c-preview-text" style={{ fontSize: textFontSize }}>{textInfo.text}</pre>
            </>
          ) : (
            <div className="c-preview-load-state">{detailState.reason || 'Text file preview unavailable.'}</div>
          )}
        </div>
      </>
    )
  }

  if (selectedCItem?.type === 'c-ref') {
    const referencedDocument = detailState.ok ? normalizeCDocument(detailState.data) : null
    return (
      <>
        <DetailHeader title="Selected Composite File" onOpen={() => onOpenCRef?.(selectedCItem)} />
        <small className="c-detail-path" title={selectedCItem.ref.cFilePath}>{selectedCItem.ref.cFilePath}</small>
        {detailState.status === 'loading' ? (
          <div className="c-preview-load-state">Loading Composite preview...</div>
        ) : referencedDocument ? (
          <CompositeListPreview
            activeView={compositeDetailView}
            cDocument={referencedDocument}
            cDocumentFilePath={selectedCItem.ref.cFilePath}
            onActiveViewChange={setCompositeDetailView}
            onSelectItem={() => {}}
            selectedCItemId=""
          />
        ) : (
          <div className="c-preview-load-state">{detailState.reason || 'Composite preview unavailable.'}</div>
        )}
      </>
    )
  }

  if (selectedCItem) {
    return (
      <>
        <DetailHeader title="Selected C Item" />
        <div className="c-preview-card">
          <strong>{selectedCItem.type}</strong>
          <span>{getCItemSummary(selectedCItem)}</span>
          <small title={selectedCItem.id}>{selectedCItem.id}</small>
        </div>
      </>
    )
  }

    return (
      <>
        <DetailHeader title="Selected Detail" />
        <div className="empty-state">No C item or B Entity selected.</div>
      </>
    )
  }

  return (
    <div className="c-selected-detail-shell">
      <div className="c-selected-detail-content">
        {isSelectedImage ? <ImageDetailView selectedCItem={selectedCItem} /> : renderDetailContent()}
      </div>
    </div>
  )
}
