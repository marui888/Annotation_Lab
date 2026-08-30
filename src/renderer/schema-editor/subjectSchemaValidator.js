export function createEmptySubjectSchema() {
  return {
    schemaVersion: 1,
    subjectId: 'new-subject',
    label: 'New Subject',
    description: '',
    version: '1.0.0',
    entityKinds: [],
    rolesByKind: {},
    featureGroups: [],
    relationTypes: [],
    validationRules: [],
    uiHints: {
      defaultKind: '',
      defaultLabel: 'New Entity',
      defaultSubKindsByKind: {},
      kindDisplayOrder: [],
      featureGroupDisplayOrder: [],
      primaryFeatureGroups: [],
    },
  }
}

function collectDuplicateValues(items, getValue) {
  const seen = new Set()
  const duplicates = new Set()
  items.forEach((item) => {
    const value = getValue(item)
    if (!value) return
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  })
  return Array.from(duplicates)
}

export function validateSubjectSchema(schema) {
  const issues = []
  const warnings = []

  if (!schema || typeof schema !== 'object') {
    return {
      ok: false,
      issues: ['Schema data must be an object.'],
      warnings: [],
    }
  }

  if (!schema.subjectId) issues.push('subjectId is required.')
  if (!schema.label) issues.push('label is required.')
  if (!Array.isArray(schema.entityKinds)) issues.push('entityKinds must be an array.')
  if (!schema.rolesByKind || typeof schema.rolesByKind !== 'object') issues.push('rolesByKind must be an object.')
  if (!Array.isArray(schema.featureGroups)) issues.push('featureGroups must be an array.')
  if (!Array.isArray(schema.validationRules)) issues.push('validationRules must be an array.')

  const entityKinds = Array.isArray(schema.entityKinds) ? schema.entityKinds : []
  const featureGroups = Array.isArray(schema.featureGroups) ? schema.featureGroups : []
  const validationRules = Array.isArray(schema.validationRules) ? schema.validationRules : []
  const kindSet = new Set(entityKinds.map((kind) => kind.value).filter(Boolean))
  const featureGroupSet = new Set(featureGroups.map((group) => group.key).filter(Boolean))
  const subKindSetsByKind = new Map()

  collectDuplicateValues(entityKinds, (kind) => kind.value)
    .forEach((value) => issues.push(`Duplicate entity kind: ${value}`))
  collectDuplicateValues(featureGroups, (group) => group.key)
    .forEach((value) => issues.push(`Duplicate feature group: ${value}`))
  collectDuplicateValues(validationRules, (rule) => rule.id)
    .forEach((value) => issues.push(`Duplicate validation rule id: ${value}`))

  entityKinds.forEach((kind, index) => {
    if (!kind.value) issues.push(`entityKinds[${index}].value is required.`)
    if (!kind.label) warnings.push(`entityKinds[${index}] has no label.`)
    if (kind.subKinds !== undefined && !Array.isArray(kind.subKinds)) {
      issues.push(`entityKinds[${index}].subKinds must be an array.`)
      return
    }
    collectDuplicateValues(kind.subKinds || [], (subKind) => subKind.value)
      .forEach((value) => issues.push(`Duplicate subKind in ${kind.value || index}: ${value}`))
    subKindSetsByKind.set(kind.value, new Set((kind.subKinds || []).map((subKind) => subKind.value).filter(Boolean)))
    ;(kind.subKinds || []).forEach((subKind, subKindIndex) => {
      if (!subKind.value) issues.push(`entityKinds[${index}].subKinds[${subKindIndex}].value is required.`)
      if (!subKind.label) warnings.push(`entityKinds[${index}].subKinds[${subKindIndex}] has no label.`)
    })
  })

  Object.entries(schema.uiHints?.defaultSubKindsByKind || {}).forEach(([kindValue, subKindValue]) => {
    if (!kindSet.has(kindValue)) {
      issues.push(`uiHints.defaultSubKindsByKind references unknown kind: ${kindValue}`)
      return
    }
    if (subKindValue && !subKindSetsByKind.get(kindValue)?.has(subKindValue)) {
      issues.push(`uiHints.defaultSubKindsByKind.${kindValue} references unknown subKind: ${subKindValue}`)
    }
  })

  Object.entries(schema.rolesByKind || {}).forEach(([kindValue, roles]) => {
    if (!kindSet.has(kindValue)) issues.push(`rolesByKind references unknown kind: ${kindValue}`)
    if (!Array.isArray(roles)) {
      issues.push(`rolesByKind.${kindValue} must be an array.`)
      return
    }
    collectDuplicateValues(roles, (role) => role.value)
      .forEach((value) => issues.push(`Duplicate role in ${kindValue}: ${value}`))
    roles.forEach((role, index) => {
      if (!role.value) issues.push(`rolesByKind.${kindValue}[${index}].value is required.`)
      if (!role.label) warnings.push(`rolesByKind.${kindValue}[${index}] has no label.`)
    })
  })

  featureGroups.forEach((group, groupIndex) => {
    if (!group.key) issues.push(`featureGroups[${groupIndex}].key is required.`)
    if (!group.label) warnings.push(`featureGroups[${groupIndex}] has no label.`)
    if (group.section && !['basic', 'keyword'].includes(group.section)) {
      warnings.push(`featureGroups[${groupIndex}].section is not a known value: ${group.section}`)
    }
    if (group.inputMode && !['select', 'dropdown', 'manual'].includes(group.inputMode)) {
      warnings.push(`featureGroups[${groupIndex}].inputMode is not a known value: ${group.inputMode}`)
    }
    if (!Array.isArray(group.values)) {
      issues.push(`featureGroups[${groupIndex}].values must be an array.`)
      return
    }
    collectDuplicateValues(group.values, (value) => value.value)
      .forEach((value) => issues.push(`Duplicate feature value in ${group.key || groupIndex}: ${value}`))
  })

  validationRules.forEach((rule, index) => {
    if (!rule.id) issues.push(`validationRules[${index}].id is required.`)
    if (!rule.type) issues.push(`validationRules[${index}].type is required.`)
    if (rule.kind && !kindSet.has(rule.kind)) issues.push(`Rule ${rule.id || index} references unknown kind: ${rule.kind}`)
    if (rule.featureGroup && !featureGroupSet.has(rule.featureGroup)) {
      issues.push(`Rule ${rule.id || index} references unknown featureGroup: ${rule.featureGroup}`)
    }
    if (rule.kind && rule.role) {
      const roles = schema.rolesByKind?.[rule.kind] || []
      if (!roles.some((role) => role.value === rule.role)) {
        issues.push(`Rule ${rule.id || index} references unknown role: ${rule.kind}/${rule.role}`)
      }
    }
  })

  return {
    ok: issues.length === 0,
    issues,
    warnings,
  }
}
