import { useEffect, useMemo, useRef, useState } from 'react'
import TreeList from '../components/tree-list/TreeList'
import {
  demoteNode,
  getNodeMeta,
  moveSiblingDown,
  moveSiblingUp,
  promoteNode,
  removeNodes,
} from '../components/tree-list/treeOperations'
import {
  appendRefsToACardTree,
  createACardPatch,
  createACardNode,
  flattenACardTree,
  getEntityACardTree,
  updateAllACardRoles,
} from '../domain/aCardTree'
import PreviewControlOverlay from '../components/preview/PreviewControlOverlay'
import {
  DOMAIN_SCHEMAS,
  getDomainDefaultSubKind,
  getDomainFeatureGroups,
  getDomainKind,
  getDomainRolesForKind,
  getDomainSchema,
  validateDomainEntity,
} from '../domain/domainSchemas'
import ACardTreeNode from './ACardTreeNode'
import EntityRawPreview from './EntityRawPreview'
import './BWorkflow.css'

const A_OBJECT_DRAG_TYPE = 'application/x-annotation-lab-a-object'
const MIN_B_WORKFLOW_TOP_HEIGHT = 80
const MIN_B_WORKFLOW_BOTTOM_HEIGHT = 92

function createEntityCards(annotations, kind) {
  return annotations.map((annotation) => createACardNode({
    aObjectId: annotation.id,
    role: kind,
  }))
}

function updateTreeNodeRole(tree, nodeId, role) {
  return tree.map((node) => ({
    ...node,
    role: node.id === nodeId ? role : node.role,
    children: updateTreeNodeRole(node.children || [], nodeId, role),
  }))
}

function normalizeFeatureInputValue(value, multi) {
  if (multi) return Array.isArray(value) ? value : value ? [value] : []
  if (Array.isArray(value)) return value[0] || ''
  return value || ''
}

function getFeatureLayoutMode(group) {
  const values = group.values || []
  if (group.inputMode === 'manual' || values.length === 0) return 'manual'
  if (group.multi) return 'checkbox'
  if (group.inputMode === 'dropdown') return 'dropdown'
  if (group.inputMode === 'select') return 'select'
  return 'other'
}

export default function BWorkflow({
  annotations,
  ensureAnnotationPreview,
  getAnnotationPreview,
  imageUrl,
  imageSize,
  canGoToAnnotation,
  onExportEntity,
  onExportSelectedEntityItems,
  onGoToAnnotation,
  selectedAnnotationIds,
  selectedEntity,
  onCreateEntity,
  onSelectAnnotations,
  onUpdateEntity,
  subjectSchemas = DOMAIN_SCHEMAS,
  bottomPanelHeight: controlledBottomPanelHeight = 170,
  onBottomPanelHeightChange,
}) {
  const workflowRef = useRef(null)
  const selectedAnnotations = useMemo(() => (
    selectedAnnotationIds
      .map((id) => annotations.find((annotation) => annotation.id === id))
      .filter(Boolean)
  ), [annotations, selectedAnnotationIds])

  const [dropActive, setDropActive] = useState(false)
  const [selectedCardIds, setSelectedCardIds] = useState([])
  const [cardMenu, setCardMenu] = useState(null)
  const [viewTab, setViewTab] = useState('list')
  const [previewBackgroundColor, setPreviewBackgroundColor] = useState('#ffffff')
  const [previewScaleFactor, setPreviewScaleFactor] = useState(1)
  const [showPreviewAnnotationFrame, setShowPreviewAnnotationFrame] = useState(true)
  const [isResizingBottom, setIsResizingBottom] = useState(false)
  const [entityMetaTab, setEntityMetaTab] = useState('structure')

  const entityTree = selectedEntity ? getEntityACardTree(selectedEntity) : []
  const flatCards = flattenACardTree(entityTree)
  const activeSelectedCardIds = selectedCardIds.filter((id) => flatCards.some((card) => card.id === id))
  const subjectSchema = getDomainSchema(selectedEntity?.subject || subjectSchemas[0]?.id, subjectSchemas)
  const validation = selectedEntity ? validateDomainEntity(selectedEntity, subjectSchemas) : null
  const roleOptions = selectedEntity ? getDomainRolesForKind(subjectSchema, selectedEntity.kind) : []
  const selectedKind = selectedEntity ? getDomainKind(subjectSchema, selectedEntity.kind) : null
  const basicFeatureGroups = getDomainFeatureGroups(subjectSchema, 'basic')
  const keywordFeatureGroups = getDomainFeatureGroups(subjectSchema, 'keyword')

  useEffect(() => {
    if (!cardMenu) return undefined
    const closeMenu = () => setCardMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('contextmenu', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('contextmenu', closeMenu)
    }
  }, [cardMenu])

  useEffect(() => {
    if (!isResizingBottom) return undefined

    const handleMouseMove = (event) => {
      const rect = workflowRef.current?.getBoundingClientRect()
      if (!rect) return
      const maxBottomHeight = Math.max(
        MIN_B_WORKFLOW_BOTTOM_HEIGHT,
        rect.height - MIN_B_WORKFLOW_TOP_HEIGHT - 6,
      )
      const nextHeight = Math.max(
        MIN_B_WORKFLOW_BOTTOM_HEIGHT,
        Math.min(maxBottomHeight, rect.bottom - event.clientY)
      )
      onBottomPanelHeightChange?.(nextHeight)
    }

    const handleMouseUp = () => setIsResizingBottom(false)

    document.body.classList.add('panel-resizing')
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.body.classList.remove('panel-resizing')
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizingBottom, onBottomPanelHeightChange])

  const changePreviewScale = (delta) => {
    setPreviewScaleFactor((current) => Math.max(0.5, Math.min(3, Number((current + delta).toFixed(2)))))
  }

  const updateEntityTree = (nextTree) => {
    if (!selectedEntity) return
    onUpdateEntity(selectedEntity.id, createACardPatch(nextTree))
  }

  const createEntityFromSelection = () => {
    if (selectedAnnotations.length === 0) return
    const schema = getDomainSchema(subjectSchemas[0]?.id, subjectSchemas)
    const role = getDomainRolesForKind(schema, schema.defaultKind)[0]?.value || 'default'
    const aCards = createEntityCards(selectedAnnotations, role)
    onCreateEntity({
      subject: schema.id,
      kind: schema.defaultKind,
      subKind: getDomainDefaultSubKind(schema, schema.defaultKind),
      label: schema.defaultLabel,
      ...createACardPatch(aCards),
    })
  }

  const appendAObjectIdsToEntity = (aObjectIds) => {
    const validIds = aObjectIds.filter((id) => annotations.some((annotation) => annotation.id === id))
    if (validIds.length === 0) return

    if (!selectedEntity) {
      const schema = getDomainSchema(subjectSchemas[0]?.id, subjectSchemas)
      const selectedAnnotationsToAdd = validIds
        .map((id) => annotations.find((annotation) => annotation.id === id))
        .filter(Boolean)
      const role = getDomainRolesForKind(schema, schema.defaultKind)[0]?.value || 'default'
      const aCards = createEntityCards(selectedAnnotationsToAdd, role)
      onCreateEntity({
        subject: schema.id,
        kind: schema.defaultKind,
        subKind: getDomainDefaultSubKind(schema, schema.defaultKind),
        label: schema.defaultLabel,
        ...createACardPatch(aCards),
      })
      return
    }

    const existingIds = new Set(flatCards.map((card) => card.aObjectId))
    const refsToAdd = validIds
      .filter((id) => !existingIds.has(id))
      .map((id) => ({
        aObjectId: id,
        role: roleOptions[0]?.value || 'default',
      }))

    if (refsToAdd.length === 0) return
    updateEntityTree(appendRefsToACardTree(entityTree, refsToAdd))
  }

  const addSelectedToEntity = () => {
    if (!selectedEntity || selectedAnnotations.length === 0) return
    appendAObjectIdsToEntity(selectedAnnotations.map((annotation) => annotation.id))
  }

  const updateEntitySubject = (subject) => {
    if (!selectedEntity) return
    const schema = getDomainSchema(subject, subjectSchemas)
    const role = getDomainRolesForKind(schema, schema.defaultKind)[0]?.value || 'default'
    const nextTree = updateAllACardRoles(entityTree, role)
    onUpdateEntity(selectedEntity.id, {
      subject: schema.id,
      kind: schema.defaultKind,
      subKind: getDomainDefaultSubKind(schema, schema.defaultKind),
      ...createACardPatch(nextTree),
    })
  }

  const updateEntityKind = (kind) => {
    if (!selectedEntity) return
    const role = getDomainRolesForKind(subjectSchema, kind)[0]?.value || 'default'
    onUpdateEntity(selectedEntity.id, {
      kind,
      subKind: getDomainDefaultSubKind(subjectSchema, kind),
      ...createACardPatch(updateAllACardRoles(entityTree, role)),
    })
  }

  const updateEntitySubKind = (subKind) => {
    if (!selectedEntity) return
    onUpdateEntity(selectedEntity.id, { subKind })
  }

  const updateEntityLabel = (label) => {
    if (!selectedEntity) return
    onUpdateEntity(selectedEntity.id, { label })
  }

  const updateEntityFeature = (featureKey, value) => {
    if (!selectedEntity) return
    onUpdateEntity(selectedEntity.id, {
      featureValues: {
        ...(selectedEntity.featureValues || {}),
        [featureKey]: value,
      },
    })
  }

  const updateNodeRole = (nodeId, role) => {
    updateEntityTree(updateTreeNodeRole(entityTree, nodeId, role))
  }

  const removeAllRefs = () => {
    if (!selectedEntity || flatCards.length === 0) return
    const confirmed = window.confirm(`Remove all ${flatCards.length} A Cards from this Entity?`)
    if (!confirmed) return
    updateEntityTree([])
    setSelectedCardIds([])
  }

  const removeSelectedRefs = () => {
    if (!selectedEntity || activeSelectedCardIds.length === 0) return
    const confirmed = window.confirm(`Remove selected ${activeSelectedCardIds.length} A Card(s) from this Entity?`)
    if (!confirmed) return
    updateEntityTree(removeNodes(entityTree, activeSelectedCardIds))
    setSelectedCardIds([])
  }

  const openCardMenu = (event, node) => {
    if (!selectedEntity) return
    const menuWidth = 148
    const menuHeight = 190
    const x = Math.min(event.clientX + 2, window.innerWidth - menuWidth - 8)
    const y = Math.min(event.clientY + 2, window.innerHeight - menuHeight - 8)
    setSelectedCardIds([node.id])
    onSelectAnnotations([node.aObjectId])
    setCardMenu({
      nodeId: node.id,
      x: Math.max(8, x),
      y: Math.max(8, y),
    })
  }

  const runCardMenuAction = (action) => {
    if (!cardMenu?.nodeId) return
    const nodeId = cardMenu.nodeId
    const card = flatCards.find((item) => item.id === nodeId)
    const annotation = card ? annotations.find((item) => item.id === card.aObjectId) : null
    if (action === 'go-to') {
      if (annotation) onGoToAnnotation?.(annotation)
      setCardMenu(null)
      return
    }
    if (action === 'promote') updateEntityTree(promoteNode(entityTree, nodeId))
    if (action === 'demote') updateEntityTree(demoteNode(entityTree, nodeId))
    if (action === 'up') updateEntityTree(moveSiblingUp(entityTree, nodeId))
    if (action === 'down') updateEntityTree(moveSiblingDown(entityTree, nodeId))
    if (action === 'delete') {
      const confirmed = window.confirm('Delete this A Card and all of its child A Cards?')
      if (!confirmed) {
        setCardMenu(null)
        return
      }
      updateEntityTree(removeNodes(entityTree, [nodeId]))
      setSelectedCardIds((current) => current.filter((id) => id !== nodeId))
    }
    setCardMenu(null)
  }

  const handleCardSelect = (nextSelectedCardIds) => {
    setSelectedCardIds(nextSelectedCardIds)
    const firstCard = flatCards.find((card) => card.id === nextSelectedCardIds[0])
    if (firstCard) onSelectAnnotations([firstCard.aObjectId])
    if (!firstCard) onSelectAnnotations([])
  }

  const handleEntityDragOver = (event) => {
    if (!Array.from(event.dataTransfer.types).includes(A_OBJECT_DRAG_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDropActive(true)
  }

  const handleEntityDrop = (event) => {
    event.preventDefault()
    setDropActive(false)
    const payload = event.dataTransfer.getData(A_OBJECT_DRAG_TYPE)
    if (!payload) return

    try {
      const data = JSON.parse(payload)
      appendAObjectIdsToEntity(Array.isArray(data.ids) ? data.ids : [data.id])
    } catch {
      const id = event.dataTransfer.getData('text/plain')
      if (id) appendAObjectIdsToEntity([id])
    }
  }

  const renderFeatureInput = (group, variant = 'compact') => {
    const currentValue = normalizeFeatureInputValue(selectedEntity?.featureValues?.[group.key], group.multi)
    const values = group.values || []
    const isManual = group.inputMode === 'manual' || values.length === 0

    if (isManual) {
      if (variant === 'keyword') {
        return (
          <textarea
            onChange={(event) => updateEntityFeature(group.key, event.target.value)}
            value={Array.isArray(currentValue) ? currentValue.join(', ') : currentValue}
          />
        )
      }
      return (
        <input
          onChange={(event) => updateEntityFeature(group.key, event.target.value)}
          value={Array.isArray(currentValue) ? currentValue.join(', ') : currentValue}
        />
      )
    }

    if (group.multi) {
      return (
        <div className="b-feature-checkbox-list">
          {values.map((option) => {
            const checked = currentValue.includes(option.value)
            return (
              <label className="b-feature-checkbox" key={option.value}>
                <input
                  checked={checked}
                  onChange={(event) => {
                    const nextValues = event.target.checked
                      ? [...currentValue, option.value]
                      : currentValue.filter((item) => item !== option.value)
                    updateEntityFeature(group.key, nextValues)
                  }}
                  type="checkbox"
                />
                <span>{option.label}</span>
              </label>
            )
          })}
        </div>
      )
    }

    return (
      <select
        onChange={(event) => updateEntityFeature(group.key, event.target.value)}
        value={currentValue}
      >
        <option value="">--</option>
        {currentValue && !values.some((option) => option.value === currentValue) ? (
          <option value={currentValue}>{currentValue} (invalid)</option>
        ) : null}
        {values.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    )
  }

  const renderFeatureFields = (groups, variant = 'compact') => (
    groups.map((group) => (
      <label className="b-feature-field" key={group.key}>
        <span>{group.label || group.key}</span>
        {renderFeatureInput(group, variant)}
      </label>
    ))
  )

  const renderFeatureSection = (title, groups, options = {}) => {
    if (!selectedEntity || groups.length === 0) return null
    const variant = options.variant || 'compact'
    const groupByInputMode = Boolean(options.groupByInputMode)

    if (groupByInputMode && variant !== 'keyword') {
      const groupedFeatures = groups.reduce((result, group) => {
        const mode = getFeatureLayoutMode(group)
        return {
          ...result,
          [mode]: [...(result[mode] || []), group],
        }
      }, {})
      const modeOrder = ['dropdown', 'select', 'checkbox', 'manual', 'other']
      return (
        <div className="b-feature-section grouped">
          <div className="b-feature-title">{title}</div>
          <div className="b-feature-grouped-grid">
            {modeOrder.map((mode) => {
              const modeGroups = groupedFeatures[mode] || []
              if (modeGroups.length === 0) return null
              return (
                <div className={`b-feature-mode-group ${mode}`} key={mode}>
                  <div className={`b-feature-grid ${mode}`}>
                    {renderFeatureFields(modeGroups, variant)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )
    }

    return (
      <div className={variant === 'keyword' ? 'b-feature-section keyword' : 'b-feature-section'}>
        <div className="b-feature-title">{title}</div>
        <div className={variant === 'keyword' ? 'b-feature-grid keyword' : 'b-feature-grid'}>
          {renderFeatureFields(groups, variant)}
        </div>
      </div>
    )
  }

  const workflowStatus = (
    <div className={[
      'b-workflow-status',
      validation && !validation.ok ? 'has-warning' : '',
    ].filter(Boolean).join(' ')}>
      <span>Total: {flatCards.length}</span>
      <span>Selected: {activeSelectedCardIds.length}</span>
      <strong>{validation ? `Rule: ${validation.ok ? 'OK' : validation.issues.join('; ')}` : 'No Entity'}</strong>
    </div>
  )

  const workflowActions = (
    <div className="b-workflow-actions">
      <button aria-label="New Entity From Selected" data-tooltip="New Entity From Selected" disabled={selectedAnnotations.length === 0} onClick={createEntityFromSelection} type="button">
        <i className="fa-solid fa-square-plus" />
      </button>
      <button aria-label="Add Selected To Entity" data-tooltip="Add Selected To Entity" disabled={!selectedEntity || selectedAnnotations.length === 0} onClick={addSelectedToEntity} type="button">
        <i className="fa-solid fa-plus" />
      </button>
      <button aria-label="Export Entity" data-tooltip="Export Entity" disabled={!selectedEntity || flatCards.length === 0} onClick={() => onExportEntity?.(selectedEntity)} type="button">
        <i className="fa-solid fa-file-export" />
      </button>
      <button
        aria-label="Export Selected"
        data-tooltip="Export Selected"
        disabled={!selectedEntity || activeSelectedCardIds.length === 0}
        onClick={() => onExportSelectedEntityItems?.(
          selectedEntity,
          flatCards.filter((card) => activeSelectedCardIds.includes(card.id)),
        )}
        type="button"
      >
        <i className="fa-solid fa-file-arrow-down" />
      </button>
      <button aria-label="Remove All" data-tooltip="Remove All" disabled={!selectedEntity || flatCards.length === 0} onClick={removeAllRefs} type="button">
        <i className="fa-solid fa-trash-can" />
      </button>
      <button aria-label="Remove Selected" data-tooltip="Remove Selected" disabled={!selectedEntity || activeSelectedCardIds.length === 0} onClick={removeSelectedRefs} type="button">
        <i className="fa-solid fa-delete-left" />
      </button>
    </div>
  )

  return (
    <div
      className="b-workflow"
      ref={workflowRef}
      style={{
        gridTemplateRows: `minmax(0, 1fr) 6px ${controlledBottomPanelHeight}px`,
      }}
    >
      <section
        className={dropActive ? 'b-entity-list-zone drop-active' : 'b-entity-list-zone'}
        onDragLeave={() => setDropActive(false)}
        onDragOver={handleEntityDragOver}
        onDrop={handleEntityDrop}
      >
        <div className="b-workflow-topbar">
          {workflowActions}
          {workflowStatus}
        </div>
        <div className="b-view-tabs">
          <button className={viewTab === 'list' ? 'active' : ''} onClick={() => setViewTab('list')} type="button">List</button>
          <button className={viewTab === 'preview' ? 'active' : ''} onClick={() => setViewTab('preview')} type="button">Preview</button>
        </div>
        <div
          className={viewTab === 'preview' ? 'b-view-content-scroll preview-mode' : 'b-view-content-scroll'}
          style={viewTab === 'preview' ? { '--b-preview-background': previewBackgroundColor } : undefined}
        >
          {viewTab === 'list' ? (
            <TreeList
              emptyText="Drag selected A objects here or use New Entity From Selected."
              onSelect={handleCardSelect}
              onNodeContextMenu={openCardMenu}
              onTreeChange={updateEntityTree}
              selectedIds={activeSelectedCardIds}
              tree={entityTree}
              renderNode={(node, context) => (
                <ACardTreeNode
                  annotation={annotations.find((item) => item.id === node.aObjectId)}
                  context={context}
                  entityKind={selectedEntity?.kind}
                  node={node}
                  onRoleChange={updateNodeRole}
                  roleOptions={roleOptions}
                  subjectSchema={subjectSchema}
                />
              )}
            />
          ) : (
            <div className="b-preview-shell">
              <PreviewControlOverlay
                backgroundColor={previewBackgroundColor}
                onBackgroundColorChange={setPreviewBackgroundColor}
                onScaleChange={changePreviewScale}
                onScaleReset={() => setPreviewScaleFactor(1)}
                onShowFrameChange={setShowPreviewAnnotationFrame}
                scale={previewScaleFactor}
                showFrame={showPreviewAnnotationFrame}
              />
              <div className="b-preview-list">
                <EntityRawPreview
                  annotations={annotations}
                  ensureAnnotationPreview={ensureAnnotationPreview}
                  entity={selectedEntity}
                  getAnnotationPreview={getAnnotationPreview}
                  imageSize={imageSize}
                  imageUrl={imageUrl}
                  onNodeContextMenu={openCardMenu}
                  onSelectCards={handleCardSelect}
                  previewBackgroundColor={previewBackgroundColor}
                  previewScaleFactor={previewScaleFactor}
                  readOnly
                  selectedCardIds={activeSelectedCardIds}
                  showAnnotationFrame={showPreviewAnnotationFrame}
                  useSharedScale
                />
              </div>
            </div>
          )}
        </div>
        {cardMenu && flatCards.some((card) => card.id === cardMenu.nodeId) ? (
          (() => {
            const meta = getNodeMeta(entityTree, cardMenu.nodeId)
            const card = flatCards.find((item) => item.id === cardMenu.nodeId)
            const annotation = card ? annotations.find((item) => item.id === card.aObjectId) : null
            const canGoTo = Boolean(annotation && canGoToAnnotation?.(annotation))
            return (
              <div
                className="b-card-context-menu"
                onClick={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.stopPropagation()}
                style={{ left: cardMenu.x, top: cardMenu.y }}
              >
                <button disabled={!canGoTo} onClick={() => runCardMenuAction('go-to')} type="button">Go To</button>
                <div className="context-menu-separator" />
                <button disabled={!meta || meta.isRoot} onClick={() => runCardMenuAction('promote')} type="button">Promote</button>
                <button disabled={!meta || !meta.hasPreviousSibling} onClick={() => runCardMenuAction('demote')} type="button">Demote</button>
                <button disabled={!meta || !meta.hasPreviousSibling} onClick={() => runCardMenuAction('up')} type="button">Up</button>
                <button disabled={!meta || !meta.hasNextSibling} onClick={() => runCardMenuAction('down')} type="button">Down</button>
                <button className="danger" onClick={() => runCardMenuAction('delete')} type="button">Delete</button>
              </div>
            )
          })()
        ) : null}
      </section>

      <div
        aria-label="Resize B Workflow panels"
        className="b-workflow-splitter"
        onMouseDown={(event) => {
          event.preventDefault()
          setIsResizingBottom(true)
        }}
        role="separator"
        title="Resize B Workflow panels"
      />

      <aside className="b-workflow-preview">
        {selectedEntity ? (
          <div className="b-workflow-meta">
            <div className="b-meta-tabs">
              <button className={entityMetaTab === 'structure' ? 'active' : ''} onClick={() => setEntityMetaTab('structure')} type="button">
                成分属性
              </button>
              <button className={entityMetaTab === 'features' ? 'active' : ''} onClick={() => setEntityMetaTab('features')} type="button">
                基础特征
              </button>
            </div>
            {entityMetaTab === 'structure' ? (
              <>
                <div className="b-workflow-meta-body">
                  <label>
                    Subject
                    <select onChange={(event) => updateEntitySubject(event.target.value)} value={subjectSchema.id}>
                      {subjectSchemas.map((schema) => (
                        <option key={schema.id} value={schema.id}>{schema.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Kind
                    <select onChange={(event) => updateEntityKind(event.target.value)} value={selectedEntity.kind}>
                      {selectedEntity.kind && !subjectSchema.kinds.some((kind) => kind.value === selectedEntity.kind) ? (
                        <option value={selectedEntity.kind}>{selectedEntity.kind} (invalid)</option>
                      ) : null}
                      {subjectSchema.kinds.map((kind) => (
                        <option key={kind.value} value={kind.value}>{kind.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    SubKind
                    <select onChange={(event) => updateEntitySubKind(event.target.value)} value={selectedEntity.subKind || ''}>
                      <option value="">--</option>
                      {selectedEntity.subKind && !(selectedKind?.subKinds || []).some((subKind) => subKind.value === selectedEntity.subKind) ? (
                        <option value={selectedEntity.subKind}>{selectedEntity.subKind} (invalid)</option>
                      ) : null}
                      {(selectedKind?.subKinds || []).map((subKind) => (
                        <option key={subKind.value} value={subKind.value}>{subKind.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Label
                    <input onChange={(event) => updateEntityLabel(event.target.value)} value={selectedEntity.label} />
                  </label>
                </div>
                {renderFeatureSection('Keywords', keywordFeatureGroups, { variant: 'keyword' })}
              </>
            ) : (
              renderFeatureSection('Basic Features', basicFeatureGroups, { groupByInputMode: true })
            )}
          </div>
        ) : (
          <div className="b-workflow-empty-meta">No Entity selected.</div>
        )}
      </aside>
    </div>
  )
}
