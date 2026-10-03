import { useState } from 'react'
import PreviewControlOverlay from '../components/preview/PreviewControlOverlay'
import usePreviewWheelZoom from '../components/preview/usePreviewWheelZoom'
import { DOMAIN_SCHEMAS, validateDomainEntity } from '../domain/domainSchemas'
import EntityListView from './EntityListView'
import EntityRawPreview from './EntityRawPreview'
import './EntityListPreview.css'

const ENTITY_DISPLAY_TABS = [
  { id: 'list', label: 'List' },
  { id: 'preview', label: 'Preview' },
]

export default function EntityListPreview({
  activeView,
  annotations,
  entity,
  getAnnotationPreview,
  imageSize,
  imageUrl,
  onActiveViewChange,
  onNodeContextMenu,
  onSelectCards,
  previewBackgroundColor: initialPreviewBackgroundColor = '#ffffff',
  readOnly = true,
  selectedCardIds = [],
  subjectSchemas = DOMAIN_SCHEMAS,
}) {
  const [internalViewTab, setInternalViewTab] = useState('list')
  const [previewBackgroundColor, setPreviewBackgroundColor] = useState(initialPreviewBackgroundColor)
  const [previewScaleFactor, setPreviewScaleFactor] = useState(1)
  const [showAnnotationFrame, setShowAnnotationFrame] = useState(true)
  const viewTab = activeView || internalViewTab
  const previewScrollRef = usePreviewWheelZoom({
    enabled: viewTab === 'preview',
    scale: previewScaleFactor,
    setScale: setPreviewScaleFactor,
  })
  const validation = entity ? validateDomainEntity(entity, subjectSchemas) : null
  const setViewTab = (nextViewTab) => {
    if (!activeView) setInternalViewTab(nextViewTab)
    onActiveViewChange?.(nextViewTab)
  }

  const changePreviewScale = (delta) => {
    setPreviewScaleFactor((current) => Math.max(0.5, Math.min(3, Number((current + delta).toFixed(2)))))
  }

  if (!entity) {
    return <div className="entity-list-preview-empty">No Entity selected.</div>
  }

  return (
    <section className="entity-list-preview">
      <header className="entity-list-preview-header">
        <strong>{entity.subject} / {entity.kind}</strong>
        <span>{entity.label}</span>
        <small>{validation?.ok ? 'OK' : validation?.issues.join('; ')}</small>
      </header>

      <div className="entity-list-preview-tabs">
        {ENTITY_DISPLAY_TABS.map((tab) => (
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
        <div
          className="entity-list-preview-paper"
          style={{ '--entity-list-preview-background': initialPreviewBackgroundColor }}
        >
          <EntityListView
            annotations={annotations}
            entity={entity}
            onNodeContextMenu={onNodeContextMenu}
            onSelectCards={onSelectCards}
            selectedCardIds={selectedCardIds}
            subjectSchemas={subjectSchemas}
          />
        </div>
      ) : (
        <div
          className="entity-list-preview-shell"
          style={{ '--entity-list-preview-background': previewBackgroundColor }}
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
          <div className="entity-list-preview-paper preview-mode" ref={previewScrollRef}>
            <EntityRawPreview
              annotations={annotations}
              entity={entity}
              getAnnotationPreview={getAnnotationPreview}
              imageSize={imageSize}
              imageUrl={imageUrl}
              onNodeContextMenu={onNodeContextMenu}
              onSelectCards={onSelectCards}
              previewBackgroundColor={previewBackgroundColor}
              previewScaleFactor={previewScaleFactor}
              readOnly={readOnly}
              selectedCardIds={selectedCardIds}
              showAnnotationFrame={showAnnotationFrame}
              useSharedScale
            />
          </div>
        </div>
      )}
    </section>
  )
}
