import { getDomainKind } from '../domain/domainSchemas'

function formatGeometryValue(value) {
  return Number.isFinite(value) ? value.toFixed(3) : '--'
}

function getAnnotationTitle(annotation) {
  if (!annotation) return 'Missing A Object'
  if (annotation.type === 'text') return annotation.text || 'Text'
  if (annotation.type === 'arrow') return 'Arrow'
  return 'Rect'
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
  return annotation.id
}

export default function ACardTreeNode({
  annotation,
  context,
  node,
  onRoleChange,
  subjectSchema,
}) {
  return (
    <div className={context.selected ? 'b-entity-card selected' : 'b-entity-card'}>
      <div className="b-entity-card-title">
        <strong>{getDomainKind(subjectSchema, node.role)?.label || node.role}</strong>
        <span>{getAnnotationTitle(annotation)}</span>
      </div>
      <small>{getAnnotationSummary(annotation)}</small>
      <select
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onRoleChange(node.id, event.target.value)}
        value={node.role}
      >
        {subjectSchema.kinds.map((kind) => (
          <option key={kind.value} value={kind.value}>{kind.label}</option>
        ))}
      </select>
    </div>
  )
}
