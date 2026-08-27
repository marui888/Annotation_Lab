import { useState } from 'react'
import { validateDomainEntity } from '../domain/domainSchemas'
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
  previewBackgroundColor = '#ffffff',
  readOnly = true,
  selectedCardIds = [],
}) {
  const [internalViewTab, setInternalViewTab] = useState('list')
  const viewTab = activeView || internalViewTab
  const validation = entity ? validateDomainEntity(entity) : null
  const setViewTab = (nextViewTab) => {
    if (!activeView) setInternalViewTab(nextViewTab)
    onActiveViewChange?.(nextViewTab)
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

      <div
        className="entity-list-preview-paper"
        style={{
          '--entity-list-preview-background': previewBackgroundColor,
        }}
      >
        {viewTab === 'list' ? (
          <EntityListView
            annotations={annotations}
            entity={entity}
            onSelectCards={onSelectCards}
            selectedCardIds={selectedCardIds}
          />
        ) : (
          <EntityRawPreview
            annotations={annotations}
            entity={entity}
            getAnnotationPreview={getAnnotationPreview}
            imageSize={imageSize}
            imageUrl={imageUrl}
            onNodeContextMenu={onNodeContextMenu}
            onSelectCards={onSelectCards}
            readOnly={readOnly}
            selectedCardIds={selectedCardIds}
          />
        )}
      </div>
    </section>
  )
}
