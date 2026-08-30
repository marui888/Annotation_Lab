import { useMemo, useState } from 'react'
import {
  ANY_FILTER_VALUE,
  createDefaultEntityFilter,
  normalizeEntityFilter,
} from '../domain/entityFilter'
import {
  getDomainFeatureGroups,
  getDomainKind,
  getDomainSchema,
  normalizeSubjectSchemas,
} from '../domain/domainSchemas'

function isFeatureTextInput(group) {
  return group.inputMode === 'manual' || !Array.isArray(group.values) || group.values.length === 0
}

export default function EntitySourceFilter({
  filter,
  items,
  onChange,
  resultCount,
  sourceOptions,
  subjectSchemas,
}) {
  const [expanded, setExpanded] = useState(false)
  const normalizedFilter = normalizeEntityFilter(filter)
  const schemas = useMemo(() => normalizeSubjectSchemas(subjectSchemas), [subjectSchemas])
  const activeSchema = getDomainSchema(
    normalizedFilter.subject !== ANY_FILTER_VALUE ? normalizedFilter.subject : schemas[0]?.id,
    schemas,
  )
  const kindOptions = normalizedFilter.subject === ANY_FILTER_VALUE
    ? Array.from(new Map(schemas.flatMap((schema) => schema.kinds || []).map((kind) => [kind.value, kind])).values())
    : activeSchema.kinds || []
  const activeKind = getDomainKind(activeSchema, normalizedFilter.kind)
  const subKindOptions = activeKind?.subKinds || []
  const featureGroups = getDomainFeatureGroups(activeSchema, 'basic')
  const activeFilterCount = useMemo(() => {
    let count = 0
    if (normalizedFilter.subject !== ANY_FILTER_VALUE) count += 1
    if (normalizedFilter.kind !== ANY_FILTER_VALUE) count += 1
    if (normalizedFilter.subKind !== ANY_FILTER_VALUE) count += 1
    if (normalizedFilter.dataFilePath !== ANY_FILTER_VALUE) count += 1
    if (normalizedFilter.text.trim()) count += 1
    if (normalizedFilter.dateRange.from || normalizedFilter.dateRange.to) count += 1
    Object.values(normalizedFilter.features || {}).forEach((value) => {
      if (value && value !== ANY_FILTER_VALUE) count += 1
    })
    if (normalizedFilter.not) count += 1
    if (normalizedFilter.logic === 'or') count += 1
    return count
  }, [normalizedFilter])

  const patchFilter = (patch) => onChange?.({
    ...normalizedFilter,
    ...patch,
  })

  const patchFeature = (key, value) => {
    patchFilter({
      features: {
        ...normalizedFilter.features,
        [key]: value,
      },
    })
  }

  const renderDateField = (field, label) => (
    <label>
      {label}
      <div className="entity-filter-date-control">
        <input
          onChange={(event) => patchFilter({ dateRange: { ...normalizedFilter.dateRange, [field]: event.target.value } })}
          onKeyDown={(event) => event.preventDefault()}
          onPaste={(event) => event.preventDefault()}
          type="date"
          value={normalizedFilter.dateRange[field]}
        />
        <button
          aria-label={`Clear ${label}`}
          data-tooltip={`Clear ${label}`}
          disabled={!normalizedFilter.dateRange[field]}
          onClick={() => patchFilter({ dateRange: { ...normalizedFilter.dateRange, [field]: '' } })}
          type="button"
        >
          <i className="fa-solid fa-xmark" />
        </button>
      </div>
    </label>
  )

  return (
    <div className={expanded ? 'entity-source-filter expanded' : 'entity-source-filter'}>
      <div className="entity-source-filter-head">
        <button onClick={() => setExpanded((current) => !current)} type="button">
          {expanded ? 'Filter -' : 'Filter +'}
        </button>
        <span>{resultCount} / {items.length}</span>
        <small>{activeFilterCount} active</small>
        <button onClick={() => onChange?.(createDefaultEntityFilter())} type="button">Reset</button>
      </div>

      {expanded ? (
        <div className="entity-source-filter-body">
          <div className="entity-filter-row compact">
            <label>
              Logic
              <select onChange={(event) => patchFilter({ logic: event.target.value })} value={normalizedFilter.logic}>
                <option value="and">AND</option>
                <option value="or">OR</option>
              </select>
            </label>
            <label className="entity-filter-check">
              <input
                checked={normalizedFilter.not}
                onChange={(event) => patchFilter({ not: event.target.checked })}
                type="checkbox"
              />
              NOT
            </label>
          </div>

          <div className="entity-filter-row">
            <label>
              Subject
              <select
                onChange={(event) => patchFilter({ subject: event.target.value, kind: ANY_FILTER_VALUE, subKind: ANY_FILTER_VALUE, features: {} })}
                value={normalizedFilter.subject}
              >
                <option value={ANY_FILTER_VALUE}>Any</option>
                {schemas.map((schema) => (
                  <option key={schema.id} value={schema.id}>{schema.label}</option>
                ))}
              </select>
            </label>
            <label>
              Kind
              <select
                onChange={(event) => patchFilter({ kind: event.target.value, subKind: ANY_FILTER_VALUE })}
                value={normalizedFilter.kind}
              >
                <option value={ANY_FILTER_VALUE}>Any</option>
                {kindOptions.map((kind) => (
                  <option key={kind.value} value={kind.value}>{kind.label}</option>
                ))}
              </select>
            </label>
            <label>
              SubKind
              <select
                disabled={normalizedFilter.kind === ANY_FILTER_VALUE}
                onChange={(event) => patchFilter({ subKind: event.target.value })}
                value={normalizedFilter.subKind}
              >
                <option value={ANY_FILTER_VALUE}>Any</option>
                {subKindOptions.map((subKind) => (
                  <option key={subKind.value} value={subKind.value}>{subKind.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="entity-filter-row">
            <label className="wide">
              Source File
              <select
                onChange={(event) => patchFilter({ dataFilePath: event.target.value })}
                value={normalizedFilter.dataFilePath}
              >
                <option value={ANY_FILTER_VALUE}>Any source file</option>
                {sourceOptions.map((sourcePath) => (
                  <option key={sourcePath} value={sourcePath}>{sourcePath}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="entity-filter-feature-grid">
            {featureGroups.map((group) => (
              <label key={group.key}>
                {group.label || group.key}
                {isFeatureTextInput(group) ? (
                  <input
                    onChange={(event) => patchFeature(group.key, event.target.value)}
                    value={normalizedFilter.features[group.key] || ''}
                  />
                ) : (
                  <select
                    onChange={(event) => patchFeature(group.key, event.target.value)}
                    value={normalizedFilter.features[group.key] || ANY_FILTER_VALUE}
                  >
                    <option value={ANY_FILTER_VALUE}>Any</option>
                    {group.values.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                )}
              </label>
            ))}
          </div>

          <div className="entity-filter-row">
            <label>
              Time Field
              <select
                onChange={(event) => patchFilter({ dateRange: { ...normalizedFilter.dateRange, field: event.target.value } })}
                value={normalizedFilter.dateRange.field}
              >
                <option value="updatedAt">Updated</option>
                <option value="createdAt">Created</option>
              </select>
            </label>
            {renderDateField('from', 'From')}
            {renderDateField('to', 'To')}
          </div>

          <label className="entity-filter-text">
            Text
            <input
              onChange={(event) => patchFilter({ text: event.target.value })}
              placeholder="label / kind / feature / file"
              value={normalizedFilter.text}
            />
          </label>
        </div>
      ) : null}
    </div>
  )
}
