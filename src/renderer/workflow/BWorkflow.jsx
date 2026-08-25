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
import { DOMAIN_SCHEMAS, getDomainSchema, validateDomainEntity } from '../domain/domainSchemas'
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

export default function BWorkflow({
  annotations,
  ensureAnnotationPreview,
  getAnnotationPreview,
  imageUrl,
  imageSize,
  onExportEntity,
  selectedAnnotationIds,
  selectedEntity,
  onCreateEntity,
  onSelectAnnotations,
  onUpdateEntity,
  bottomPanelHeight: controlledBottomPanelHeight = 118,
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

  const entityTree = selectedEntity ? getEntityACardTree(selectedEntity) : []
  const flatCards = flattenACardTree(entityTree)
  const activeSelectedCardIds = selectedCardIds.filter((id) => flatCards.some((card) => card.id === id))
  const subjectSchema = getDomainSchema(selectedEntity?.subject || DOMAIN_SCHEMAS[0].id)
  const validation = selectedEntity ? validateDomainEntity(selectedEntity) : null

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
    const schema = getDomainSchema(DOMAIN_SCHEMAS[0].id)
    const aCards = createEntityCards(selectedAnnotations, schema.defaultKind)
    onCreateEntity({
      subject: schema.id,
      kind: schema.defaultKind,
      label: schema.defaultLabel,
      ...createACardPatch(aCards),
    })
  }

  const appendAObjectIdsToEntity = (aObjectIds) => {
    const validIds = aObjectIds.filter((id) => annotations.some((annotation) => annotation.id === id))
    if (validIds.length === 0) return

    if (!selectedEntity) {
      const schema = getDomainSchema(DOMAIN_SCHEMAS[0].id)
      const selectedAnnotationsToAdd = validIds
        .map((id) => annotations.find((annotation) => annotation.id === id))
        .filter(Boolean)
      const aCards = createEntityCards(selectedAnnotationsToAdd, schema.defaultKind)
      onCreateEntity({
        subject: schema.id,
        kind: schema.defaultKind,
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
        role: selectedEntity.kind,
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
    const schema = getDomainSchema(subject)
    const nextTree = updateAllACardRoles(entityTree, schema.defaultKind)
    onUpdateEntity(selectedEntity.id, {
      subject: schema.id,
      kind: schema.defaultKind,
      ...createACardPatch(nextTree),
    })
  }

  const updateEntityKind = (kind) => {
    if (!selectedEntity) return
    onUpdateEntity(selectedEntity.id, { kind })
  }

  const updateEntityLabel = (label) => {
    if (!selectedEntity) return
    onUpdateEntity(selectedEntity.id, { label })
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
    const menuHeight = 158
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
        <div className="b-view-tabs">
          <button className={viewTab === 'list' ? 'active' : ''} onClick={() => setViewTab('list')} type="button">List</button>
          <button className={viewTab === 'preview' ? 'active' : ''} onClick={() => setViewTab('preview')} type="button">Preview</button>
        </div>
        <div
          className="b-view-content-scroll"
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
                  node={node}
                  onRoleChange={updateNodeRole}
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
            return (
              <div
                className="b-card-context-menu"
                onClick={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.stopPropagation()}
                style={{ left: cardMenu.x, top: cardMenu.y }}
              >
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
        <div className={[
          'b-workflow-status',
          validation && !validation.ok ? 'has-warning' : '',
        ].filter(Boolean).join(' ')}>
          <span>Selected A: {selectedAnnotations.length}</span>
          <span>Entity Cards: {flatCards.length}</span>
          <span>Selected Cards: {activeSelectedCardIds.length}</span>
          <strong>{validation ? `Rule: ${validation.ok ? 'OK' : validation.issues.join('; ')}` : 'No Entity'}</strong>
        </div>
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
          <button aria-label="Remove All" data-tooltip="Remove All" disabled={!selectedEntity || flatCards.length === 0} onClick={removeAllRefs} type="button">
            <i className="fa-solid fa-trash-can" />
          </button>
          <button aria-label="Remove Selected" data-tooltip="Remove Selected" disabled={!selectedEntity || activeSelectedCardIds.length === 0} onClick={removeSelectedRefs} type="button">
            <i className="fa-solid fa-delete-left" />
          </button>
        </div>
        {selectedEntity ? (
          <div className="b-workflow-meta">
            <div className="b-workflow-meta-body">
              <label>
                Subject
                <select onChange={(event) => updateEntitySubject(event.target.value)} value={selectedEntity.subject}>
                  {DOMAIN_SCHEMAS.map((schema) => (
                    <option key={schema.id} value={schema.id}>{schema.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Kind
                <select onChange={(event) => updateEntityKind(event.target.value)} value={selectedEntity.kind}>
                  {subjectSchema.kinds.map((kind) => (
                    <option key={kind.value} value={kind.value}>{kind.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Label
                <input onChange={(event) => updateEntityLabel(event.target.value)} value={selectedEntity.label} />
              </label>
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  )
}
