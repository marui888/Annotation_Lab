import { flattenACardTree, getEntityACardTree } from '../domain/aCardTree'
import { DOMAIN_SCHEMAS, getDomainRole, getDomainSchema } from '../domain/domainSchemas'

function getAnnotationTitle(annotation) {
  if (!annotation) return 'Missing A Object'
  if (annotation.type === 'text') return annotation.text || 'Text'
  if (annotation.type === 'arrow') return 'Arrow'
  if (annotation.type === 'polygon') return 'Polygon'
  return 'Rect'
}

function formatGeometryValue(value) {
  return Number.isFinite(value) ? value.toFixed(3) : '--'
}

function getAnnotationSummary(annotation) {
  if (!annotation) return '--'
  if (annotation.type === 'rect') {
    return `x:${formatGeometryValue(annotation.geometry.x)} y:${formatGeometryValue(annotation.geometry.y)} w:${formatGeometryValue(annotation.geometry.width)} h:${formatGeometryValue(annotation.geometry.height)}`
  }
  if (annotation.type === 'arrow') {
    return `x1:${formatGeometryValue(annotation.geometry.x1)} y1:${formatGeometryValue(annotation.geometry.y1)} x2:${formatGeometryValue(annotation.geometry.x2)} y2:${formatGeometryValue(annotation.geometry.y2)}`
  }
  if (annotation.type === 'text') return annotation.text || 'FreeText'
  if (annotation.type === 'polygon') return `${annotation.geometry?.points?.length || 0} vertices`
  return annotation.id
}

function EntityListNode({
  annotations,
  flatCards,
  node,
  onNodeContextMenu,
  onSelectCards,
  selectedCardIds,
  subjectSchema,
  entityKind,
}) {
  const annotation = annotations.find((item) => item.id === node.aObjectId)
  const selected = selectedCardIds.includes(node.id)
  const cardIndex = flatCards.findIndex((card) => card.id === node.id)

  return (
    <li className="entity-list-node">
      <button
        className={selected ? 'entity-list-node-button selected' : 'entity-list-node-button'}
        onClick={() => onSelectCards?.([node.id])}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onNodeContextMenu?.(event, node)
        }}
        type="button"
      >
        <strong>{cardIndex + 1}. {getDomainRole(subjectSchema, entityKind, node.role)?.label || node.role}</strong>
        <span>{getAnnotationTitle(annotation)}</span>
        <small>{getAnnotationSummary(annotation)}</small>
      </button>
      {node.children?.length ? (
        <ul className="entity-list-node-children">
          {node.children.map((child) => (
            <EntityListNode
              annotations={annotations}
              flatCards={flatCards}
              key={child.id}
              node={child}
              onNodeContextMenu={onNodeContextMenu}
              onSelectCards={onSelectCards}
              selectedCardIds={selectedCardIds}
              subjectSchema={subjectSchema}
              entityKind={entityKind}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export default function EntityListView({
  annotations,
  entity,
  onNodeContextMenu,
  onSelectCards,
  selectedCardIds = [],
  subjectSchemas = DOMAIN_SCHEMAS,
}) {
  const entityTree = entity ? getEntityACardTree(entity) : []
  const flatCards = flattenACardTree(entityTree)
  const subjectSchema = getDomainSchema(entity?.subject, subjectSchemas)

  if (entityTree.length === 0) {
    return <div className="tree-list-empty">No A Cards in current Entity.</div>
  }

  return (
    <ul className="entity-list-tree">
      {entityTree.map((node) => (
        <EntityListNode
          annotations={annotations}
          flatCards={flatCards}
          key={node.id}
          node={node}
          onNodeContextMenu={onNodeContextMenu}
          onSelectCards={onSelectCards}
          selectedCardIds={selectedCardIds}
          subjectSchema={subjectSchema}
          entityKind={entity.kind}
        />
      ))}
    </ul>
  )
}
