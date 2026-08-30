import { flattenACardTree, getEntityACardTree } from './aCardTree'

export const FALLBACK_DOMAIN_SCHEMAS = [
  {
    id: 'math',
    subjectId: 'math',
    label: 'Math',
    defaultKind: 'question',
    defaultLabel: 'Math Entity',
    kinds: [
      { value: 'question', label: 'Question' },
      { value: 'stem', label: 'Stem' },
      { value: 'answer', label: 'Answer' },
      { value: 'analysis', label: 'Analysis' },
      { value: 'knowledge-point', label: 'Knowledge Point' },
      { value: 'summary', label: 'Summary' },
    ],
    rules: {
      minAObjects: 1,
      requiredRolesByKind: {
        question: ['stem'],
      },
    },
  },
  {
    id: 'english',
    subjectId: 'english',
    label: 'English',
    defaultKind: 'original',
    defaultLabel: 'English Entity',
    kinds: [
      { value: 'original', label: 'Original' },
      { value: 'translation', label: 'Translation' },
      { value: 'sentence', label: 'Sentence' },
      { value: 'word', label: 'Word' },
      { value: 'grammar', label: 'Grammar' },
      { value: 'knowledge-point', label: 'Knowledge Point' },
    ],
    rules: {
      minAObjects: 1,
      requiredRolesByKind: {
        translation: ['original'],
      },
    },
  },
]

export const DOMAIN_SCHEMAS = FALLBACK_DOMAIN_SCHEMAS

function normalizeSubjectId(subjectId = '') {
  return String(subjectId || '').replace(/-experimental$/i, '')
}

export function normalizeSubjectSchema(schema) {
  if (!schema || typeof schema !== 'object') return null
  const subjectId = schema.subjectId || schema.id || ''
  const kinds = Array.isArray(schema.entityKinds) ? schema.entityKinds : schema.kinds || []
  const defaultKind = schema.uiHints?.defaultKind || schema.defaultKind || kinds[0]?.value || ''
  const defaultLabel = schema.uiHints?.defaultLabel || schema.defaultLabel || `${schema.label || subjectId || 'Subject'} Entity`

  return {
    ...schema,
    id: subjectId,
    subjectId,
    aliases: Array.from(new Set([
      subjectId,
      schema.id,
      normalizeSubjectId(subjectId),
      normalizeSubjectId(schema.id),
    ].filter(Boolean))),
    label: schema.label || subjectId || 'Subject',
    defaultKind,
    defaultLabel,
    kinds,
    entityKinds: kinds,
    rolesByKind: schema.rolesByKind || {},
    validationRules: schema.validationRules || [],
    featureGroups: schema.featureGroups || [],
    relationTypes: schema.relationTypes || [],
    uiHints: schema.uiHints || {},
  }
}

export function normalizeSubjectSchemas(schemas) {
  const normalized = (Array.isArray(schemas) ? schemas : [])
    .map((schema) => normalizeSubjectSchema(schema))
    .filter(Boolean)
  const result = normalized.length > 0 ? normalized : FALLBACK_DOMAIN_SCHEMAS.map((schema) => normalizeSubjectSchema(schema))
  const order = new Map([
    ['math', 0],
    ['english', 1],
  ])
  return [...result].sort((left, right) => (
    (order.get(normalizeSubjectId(left.id)) ?? 10) - (order.get(normalizeSubjectId(right.id)) ?? 10)
    || left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: 'base' })
  ))
}

export function getDomainSchema(subjectId, schemas = DOMAIN_SCHEMAS) {
  const normalizedSchemas = normalizeSubjectSchemas(schemas)
  const target = String(subjectId || '')
  const normalizedTarget = normalizeSubjectId(target)
  return normalizedSchemas.find((schema) => (
    schema.id === target
    || schema.subjectId === target
    || schema.aliases?.includes(target)
    || schema.aliases?.includes(normalizedTarget)
    || normalizeSubjectId(schema.id) === normalizedTarget
  )) || normalizedSchemas[0]
}

export function getDomainKind(schema, kindValue) {
  if (!kindValue) return schema?.kinds?.[0] || null
  return schema?.kinds?.find((kind) => kind.value === kindValue) || null
}

export function getDomainSubKind(schema, kindValue, subKindValue) {
  return getDomainKind(schema, kindValue)?.subKinds?.find((subKind) => subKind.value === subKindValue) || null
}

export function getDomainDefaultSubKind(schema, kindValue) {
  const defaultSubKind = schema?.uiHints?.defaultSubKindsByKind?.[kindValue] || ''
  if (!defaultSubKind) return ''
  return getDomainSubKind(schema, kindValue, defaultSubKind) ? defaultSubKind : ''
}

export function getDomainRolesForKind(schema, kindValue) {
  const roles = schema?.rolesByKind?.[kindValue] || []
  if (roles.length > 0) return roles
  return schema?.kinds || []
}

export function getDomainRole(schema, kindValue, roleValue) {
  return getDomainRolesForKind(schema, kindValue).find((role) => role.value === roleValue) || null
}

export function getDomainFeatureGroups(schema, section = '') {
  const groups = schema?.featureGroups || []
  const filteredGroups = section
    ? groups.filter((group) => (group.section || 'basic') === section)
    : groups
  const displayOrder = schema?.uiHints?.featureGroupDisplayOrder || []
  const orderMap = new Map(displayOrder.map((key, index) => [key, index]))
  return [...filteredGroups].sort((left, right) => (
    (orderMap.get(left.key) ?? 1000) - (orderMap.get(right.key) ?? 1000)
    || String(left.label || left.key).localeCompare(String(right.label || right.key), undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  ))
}

export function getDomainEntityRoleRule(entity, schemas = DOMAIN_SCHEMAS) {
  const schema = getDomainSchema(entity.subject, schemas)
  const schemaRules = schema?.validationRules || []
  const requiredRoleValues = schemaRules
    .filter((rule) => rule.type === 'requiredRole' && (!rule.kind || rule.kind === entity.kind) && rule.role)
    .map((rule) => rule.role)
  const legacyRequiredRoleValues = schema?.rules?.requiredRolesByKind?.[entity.kind] || []
  const roleValues = requiredRoleValues.length > 0 ? requiredRoleValues : legacyRequiredRoleValues
  const roleOptions = getDomainRolesForKind(schema, entity.kind)
  const requiredRoles = roleValues.map((role) => (
    getDomainRole(schema, entity.kind, role) || { value: role, label: role }
  ))
  const requiredRoleSet = new Set(roleValues)
  const optionalRoles = roleOptions.filter((role) => !requiredRoleSet.has(role.value))

  return {
    requiredRoles,
    optionalRoles,
  }
}

export function getEntityAObjectRefs(entity) {
  if (Array.isArray(entity.aCards) && entity.aCards.length > 0) {
    return flattenACardTree(getEntityACardTree(entity)).map((card) => ({
      aObjectId: card.aObjectId,
      role: card.role || 'default',
    }))
  }

  if (Array.isArray(entity.aObjectRefs)) {
    return entity.aObjectRefs
      .filter((ref) => ref?.aObjectId)
      .map((ref) => ({
        aObjectId: ref.aObjectId,
        role: ref.role || 'default',
      }))
  }

  return (entity.aObjectIds || []).map((aObjectId) => ({
    aObjectId,
    role: 'default',
  }))
}

export function getEntityAObjectIds(entity) {
  return getEntityAObjectRefs(entity).map((ref) => ref.aObjectId)
}

export function validateDomainEntity(entity, schemas = DOMAIN_SCHEMAS) {
  const schema = getDomainSchema(entity.subject, schemas)
  const issues = []
  const refs = getEntityAObjectRefs(entity)
  const kind = getDomainKind(schema, entity.kind)
  const minRule = (schema?.validationRules || []).find((rule) => rule.type === 'minAObjectCount')
  const minAObjects = Number(minRule?.min ?? schema?.rules?.minAObjects ?? 0)

  if (entity.kind && !kind) {
    issues.push(`Unknown kind: ${entity.kind}`)
  }

  if (minAObjects > 0 && refs.length < minAObjects) {
    issues.push(minRule?.message || `Need at least ${minAObjects} A object${minAObjects > 1 ? 's' : ''}`)
  }

  const schemaRequiredRoles = (schema?.validationRules || [])
    .filter((rule) => rule.type === 'requiredRole' && (!rule.kind || rule.kind === entity.kind) && rule.role)
  const requiredRoles = schemaRequiredRoles.length > 0
    ? schemaRequiredRoles.map((rule) => rule.role)
    : schema?.rules?.requiredRolesByKind?.[entity.kind] || []
  const roleOptions = getDomainRolesForKind(schema, entity.kind)
  const knownRoleValues = new Set(roleOptions.map((role) => role.value))
  const existingRoles = new Set(refs.map((ref) => ref.role))
  refs.forEach((ref) => {
    if (ref.role && roleOptions.length > 0 && !knownRoleValues.has(ref.role)) {
      issues.push(`Unknown role: ${ref.role}`)
    }
  })
  requiredRoles.forEach((role) => {
    if (!existingRoles.has(role)) {
      const rule = schemaRequiredRoles.find((item) => item.role === role)
      const roleLabel = getDomainRole(schema, entity.kind, role)?.label || role
      issues.push(rule?.message || `Missing role: ${roleLabel}`)
    }
  })

  return {
    ok: issues.length === 0,
    issues,
  }
}
