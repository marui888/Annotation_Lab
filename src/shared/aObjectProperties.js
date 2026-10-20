export function normalizeDefaultRole(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = {
    subject: typeof value.subject === 'string' ? value.subject : '',
    kind: typeof value.kind === 'string' ? value.kind : '',
    role: typeof value.role === 'string' ? value.role : '',
  }
  return result.subject || result.kind || result.role ? result : null
}

export function normalizeAObjectProperties(annotation) {
  return {
    defaultRole: normalizeDefaultRole(annotation?.defaultRole),
    comment: typeof annotation?.comment === 'string' ? annotation.comment : '',
  }
}

export function initialCardProperties(annotation, entity, roles, explicitRole = '') {
  const { defaultRole, comment } = normalizeAObjectProperties(annotation)
  const compatible = Boolean(defaultRole?.role
    && defaultRole.subject === entity.subject && defaultRole.kind === entity.kind
    && roles.some((role) => role.value === defaultRole.role))
  return {
    role: explicitRole || (compatible ? defaultRole.role : roles[0]?.value || 'default'),
    comment,
  }
}
