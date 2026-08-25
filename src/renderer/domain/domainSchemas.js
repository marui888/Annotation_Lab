import { flattenACardTree, getEntityACardTree } from './aCardTree'

export const DOMAIN_SCHEMAS = [
  {
    id: 'math',
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

export function getDomainSchema(subjectId) {
  return DOMAIN_SCHEMAS.find((schema) => schema.id === subjectId) || DOMAIN_SCHEMAS[0]
}

export function getDomainKind(schema, kindValue) {
  return schema?.kinds?.find((kind) => kind.value === kindValue) || schema?.kinds?.[0] || null
}

export function getDomainEntityRoleRule(entity) {
  const schema = getDomainSchema(entity.subject)
  const requiredRoleValues = schema?.rules?.requiredRolesByKind?.[entity.kind] || []
  const requiredRoles = requiredRoleValues.map((role) => getDomainKind(schema, role)).filter(Boolean)
  const requiredRoleSet = new Set(requiredRoleValues)
  const optionalRoles = (schema?.kinds || []).filter((kind) => !requiredRoleSet.has(kind.value))

  return {
    requiredRoles,
    optionalRoles,
  }
}

export function getEntityAObjectRefs(entity) {
  if (Array.isArray(entity.aCards) && entity.aCards.length > 0) {
    return flattenACardTree(getEntityACardTree(entity)).map((card) => ({
      aObjectId: card.aObjectId,
      role: card.role || entity.kind,
    }))
  }

  if (Array.isArray(entity.aObjectRefs)) {
    return entity.aObjectRefs
      .filter((ref) => ref?.aObjectId)
      .map((ref) => ({
        aObjectId: ref.aObjectId,
        role: ref.role || entity.kind,
      }))
  }

  return (entity.aObjectIds || []).map((aObjectId) => ({
    aObjectId,
    role: entity.kind,
  }))
}

export function getEntityAObjectIds(entity) {
  return getEntityAObjectRefs(entity).map((ref) => ref.aObjectId)
}

export function validateDomainEntity(entity) {
  const schema = getDomainSchema(entity.subject)
  const issues = []
  const refs = getEntityAObjectRefs(entity)
  const minAObjects = schema?.rules?.minAObjects || 0

  if (minAObjects > 0 && refs.length < minAObjects) {
    issues.push(`Need at least ${minAObjects} A object${minAObjects > 1 ? 's' : ''}`)
  }

  const requiredRoles = schema?.rules?.requiredRolesByKind?.[entity.kind] || []
  const existingRoles = new Set(refs.map((ref) => ref.role))
  requiredRoles.forEach((role) => {
    if (!existingRoles.has(role)) {
      const roleLabel = getDomainKind(schema, role)?.label || role
      issues.push(`Missing role: ${roleLabel}`)
    }
  })

  return {
    ok: issues.length === 0,
    issues,
  }
}
