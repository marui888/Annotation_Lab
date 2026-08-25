import { useEffect, useMemo, useState } from 'react'
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

function getLoadTarget(selectedCItem, selectedBIndexItem) {
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

  if (!selectedCItem && selectedBIndexItem) {
    return {
      entityId: selectedBIndexItem.entityId,
      filePath: selectedBIndexItem.dataFilePath,
      key: `pool-b-ref:${selectedBIndexItem.dataFilePath}:${selectedBIndexItem.entityId}`,
      kind: 'b-entity',
    }
  }

  return null
}

function EntityDetail({ data, fallbackLabel, onOpenBRef, selectedCItem }) {
  if (data?.status === 'loading') {
    return <div className="c-preview-load-state">Loading Entity preview...</div>
  }

  if (!data?.ok) {
    return (
      <div className="c-preview-card rule-warning">
        <strong>{fallbackLabel}</strong>
        <span>{data?.reason || 'Entity preview unavailable.'}</span>
        {selectedCItem?.type === 'b-ref' ? (
          <button className="c-open-selected-b" onClick={() => onOpenBRef(selectedCItem)} type="button">Open Selected B</button>
        ) : null}
      </div>
    )
  }

  return (
    <>
      <EntityListPreview
        annotations={data.annotations}
        entity={data.entity}
        imageSize={data.imageSize}
        imageUrl={data.imageUrl}
        readOnly
      />
      {selectedCItem?.type === 'b-ref' ? (
        <button className="c-open-selected-b" onClick={() => onOpenBRef(selectedCItem)} type="button">Open Selected B</button>
      ) : null}
    </>
  )
}

export default function CSelectedDetailPanel({
  onOpenBRef,
  onUpdateItemText,
  selectedBIndexItem,
  selectedCItem,
}) {
  const [loadState, setLoadState] = useState({ key: '', status: 'idle' })
  const loadTarget = useMemo(
    () => getLoadTarget(selectedCItem, selectedBIndexItem),
    [selectedBIndexItem, selectedCItem],
  )
  const detailState = loadTarget && loadState.key !== loadTarget.key
    ? { key: loadTarget.key, status: 'loading' }
    : loadState

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

  if (selectedCItem?.type === 'text') {
    return (
      <>
        <div className="section-title">Selected Text Item</div>
        <textarea
          className="c-selected-detail-text"
          onChange={(event) => onUpdateItemText(selectedCItem.id, event.target.value)}
          value={selectedCItem.text}
        />
        <small className="c-detail-path" title={selectedCItem.id}>{selectedCItem.id}</small>
      </>
    )
  }

  if (selectedCItem?.type === 'b-ref') {
    return (
      <>
        <div className="section-title">Selected B Ref</div>
        <EntityDetail
          data={detailState}
          fallbackLabel={getCItemSummary(selectedCItem)}
          onOpenBRef={onOpenBRef}
          selectedCItem={selectedCItem}
        />
        <small className="c-detail-path" title={selectedCItem.ref.dataFilePath}>{selectedCItem.ref.dataFilePath}</small>
      </>
    )
  }

  if (selectedCItem?.type === 'file-ref' && selectedCItem.fileKind === 'image') {
    return (
      <>
        <div className="section-title">Selected Image File</div>
        <div className="c-preview-image-ref">
          <div className="c-preview-file-header">
            <div>
              <strong>{selectedCItem.display?.title || getFileName(selectedCItem.ref.filePath)}</strong>
              <small title={selectedCItem.ref.filePath}>{selectedCItem.ref.filePath}</small>
            </div>
          </div>
          <div className="c-preview-image-frame fit">
            <img alt={selectedCItem.display?.title || 'selected image'} src={toLabFileUrl(selectedCItem.ref.filePath)} />
          </div>
        </div>
      </>
    )
  }

  if (selectedCItem?.type === 'file-ref' && selectedCItem.fileKind === 'text') {
    const textInfo = detailState.ok ? getTextPreviewInfo(detailState.text) : null
    return (
      <>
        <div className="section-title">Selected Text File</div>
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
              <pre className="c-preview-text">{textInfo.text}</pre>
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
        <div className="section-title">Selected Composite File</div>
        <small className="c-detail-path" title={selectedCItem.ref.cFilePath}>{selectedCItem.ref.cFilePath}</small>
        {detailState.status === 'loading' ? (
          <div className="c-preview-load-state">Loading Composite preview...</div>
        ) : referencedDocument ? (
          <CompositeListPreview
            cDocument={referencedDocument}
            cDocumentFilePath={selectedCItem.ref.cFilePath}
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
        <div className="section-title">Selected C Item</div>
        <div className="c-preview-card">
          <strong>{selectedCItem.type}</strong>
          <span>{getCItemSummary(selectedCItem)}</span>
          <small title={selectedCItem.id}>{selectedCItem.id}</small>
        </div>
      </>
    )
  }

  if (selectedBIndexItem) {
    return (
      <>
        <div className="section-title">Selected B Entity</div>
        <EntityDetail
          data={detailState}
          fallbackLabel={selectedBIndexItem.label || selectedBIndexItem.entityId}
          onOpenBRef={onOpenBRef}
          selectedCItem={null}
        />
        <small className="c-detail-path" title={selectedBIndexItem.dataFilePath}>{selectedBIndexItem.dataFilePath}</small>
      </>
    )
  }

  return (
    <>
      <div className="section-title">Selected Detail</div>
      <div className="empty-state">No C item or B Entity selected.</div>
    </>
  )
}
