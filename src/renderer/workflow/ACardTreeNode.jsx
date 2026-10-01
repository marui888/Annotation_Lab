import { getDomainRole } from '../domain/domainSchemas'

function formatGeometryValue(value) {
  return Number.isFinite(value) ? value.toFixed(3) : '--'
}

function getAnnotationTitle(annotation) {
  if (!annotation) return 'Missing A Object'
  if (annotation.type === 'text') return annotation.text || 'Text'
  if (annotation.type === 'arrow') return 'Arrow'
  if (annotation.type === 'polygon') return 'Polygon'
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
  if (annotation.type === 'polygon') return `${annotation.geometry?.points?.length || 0} vertices`
  return annotation.id
}

export default function ACardTreeNode({
  annotation,
  context,
  entityKind,
  node,
  onRoleChange,
  subjectSchema,
  roleOptions = subjectSchema?.kinds || [],
}) {
  const roleMissing = node.role && !roleOptions.some((role) => role.value === node.role)

  return (
    <div className={context.selected ? 'b-entity-card selected' : 'b-entity-card'}>
      <div className="b-entity-card-title">
        <strong>{getDomainRole(subjectSchema, entityKind, node.role)?.label || node.role}</strong>
        <span>{getAnnotationTitle(annotation)}</span>
      </div>
      <small>{getAnnotationSummary(annotation)}</small>
      <select
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onRoleChange(node.id, event.target.value)}
        value={node.role}
      >
        {roleMissing ? (
          <option value={node.role}>{node.role} (invalid)</option>
        ) : null}
        {roleOptions.map((role) => (
          <option key={role.value} value={role.value}>{role.label}</option>
        ))}
      </select>
    </div>
  )
}
