import {
  getDomainFeatureGroups,
  getDomainKind,
  getDomainSchema,
  getDomainSubKind,
} from './domainSchemas'

export const ANY_FILTER_VALUE = 'any'

export function createDefaultEntityFilter() {
  return {
    logic: 'and',
    not: false,
    subject: ANY_FILTER_VALUE,
    kind: ANY_FILTER_VALUE,
    subKind: ANY_FILTER_VALUE,
    dataFilePath: ANY_FILTER_VALUE,
    features: {},
    dateRange: {
      field: 'updatedAt',
      from: '',
      to: '',
    },
    text: '',
  }
}

export function normalizeEntityFilter(filter) {
  const defaults = createDefaultEntityFilter()
  const sourceValue = filter?.dataFilePath || filter?.source || defaults.dataFilePath

  return {
    ...defaults,
    ...filter,
    logic: filter?.logic === 'or' ? 'or' : 'and',
    not: Boolean(filter?.not),
    subject: filter?.subject && filter.subject !== 'all' ? filter.subject : defaults.subject,
    kind: filter?.kind && filter.kind !== 'all' ? filter.kind : defaults.kind,
    subKind: filter?.subKind && filter.subKind !== 'all' ? filter.subKind : defaults.subKind,
    dataFilePath: sourceValue && sourceValue !== 'all' ? sourceValue : defaults.dataFilePath,
    features: filter?.features && typeof filter.features === 'object' ? filter.features : {},
    dateRange: {
      ...defaults.dateRange,
      ...(filter?.dateRange || {}),
    },
    text: filter?.text ?? filter?.query ?? defaults.text,
  }
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0
  return value !== undefined && value !== null && value !== '' && value !== ANY_FILTER_VALUE && value !== 'all'
}

function normalizeText(value) {
  if (Array.isArray(value)) return value.map(normalizeText).join(' ')
  if (value && typeof value === 'object') return Object.values(value).map(normalizeText).join(' ')
  return String(value || '').trim().toLowerCase()
}

function valueMatches(entityValue, filterValue, { contains = false } = {}) {
  if (!hasValue(filterValue)) return true
  if (Array.isArray(entityValue)) {
    return entityValue.some((item) => valueMatches(item, filterValue, { contains }))
  }
  if (contains) {
    return normalizeText(entityValue).includes(normalizeText(filterValue))
  }
  return String(entityValue || '') === String(filterValue)
}

function dateToTime(value, endOfDay = false) {
  if (!value) return null
  const suffix = endOfDay ? 'T23:59:59.999' : 'T00:00:00.000'
  const time = new Date(String(value).includes('T') ? value : `${value}${suffix}`).getTime()
  return Number.isFinite(time) ? time : null
}

function matchDateRange(entity, dateRange) {
  const from = dateToTime(dateRange?.from)
  const to = dateToTime(dateRange?.to, true)
  if (from === null && to === null) return true

  const field = dateRange?.field === 'createdAt' ? 'createdAt' : 'updatedAt'
  const target = new Date(entity?.[field] || '').getTime()
  if (!Number.isFinite(target)) return false
  if (from !== null && target < from) return false
  if (to !== null && target > to) return false
  return true
}

export function getEntitySearchText(entity, schemas = []) {
  const schema = getDomainSchema(entity?.subject, schemas)
  const kind = getDomainKind(schema, entity?.kind)
  const subKind = getDomainSubKind(schema, entity?.kind, entity?.subKind)
  const featureGroups = getDomainFeatureGroups(schema)
  const featureLabels = featureGroups.flatMap((group) => {
    const rawValue = entity?.featureValues?.[group.key]
    const values = Array.isArray(rawValue) ? rawValue : [rawValue]
    return values.filter(Boolean).map((value) => (
      group.values?.find((option) => option.value === value)?.label || value
    ))
  })

  return normalizeText([
    entity?.label,
    entity?.subject,
    schema?.label,
    entity?.kind,
    kind?.label,
    entity?.subKind,
    subKind?.label,
    entity?.status,
    entity?.entityId,
    entity?.dataFilePath,
    entity?.sourceFilePath,
    entity?.featureValues,
    featureLabels,
  ])
}

export function matchEntityFilter(entity, filterInput, schemas = []) {
  const filter = normalizeEntityFilter(filterInput)
  const schema = getDomainSchema(filter.subject !== ANY_FILTER_VALUE ? filter.subject : entity?.subject, schemas)
  const activeChecks = []

  if (hasValue(filter.subject)) activeChecks.push(entity?.subject === filter.subject)
  if (hasValue(filter.kind)) activeChecks.push(entity?.kind === filter.kind)
  if (hasValue(filter.subKind)) activeChecks.push((entity?.subKind || '') === filter.subKind)
  if (hasValue(filter.dataFilePath)) activeChecks.push(entity?.dataFilePath === filter.dataFilePath)

  Object.entries(filter.features || {}).forEach(([key, value]) => {
    if (!hasValue(value)) return
    const group = getDomainFeatureGroups(schema).find((item) => item.key === key)
    const contains = group?.inputMode === 'manual' || !group?.values?.length
    activeChecks.push(valueMatches(entity?.featureValues?.[key], value, { contains }))
  })

  if (filter.dateRange?.from || filter.dateRange?.to) {
    activeChecks.push(matchDateRange(entity, filter.dateRange))
  }

  if (String(filter.text || '').trim()) {
    activeChecks.push(getEntitySearchText(entity, schemas).includes(normalizeText(filter.text)))
  }

  const matched = activeChecks.length === 0
    ? true
    : filter.logic === 'or'
      ? activeChecks.some(Boolean)
      : activeChecks.every(Boolean)

  return filter.not ? !matched : matched
}

export function applyEntityFilter(items, filter, schemas = []) {
  return (items || []).filter((item) => matchEntityFilter(item, filter, schemas))
}

