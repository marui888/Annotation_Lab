import { useEffect, useMemo, useRef, useState } from 'react'
import './SubjectSchemaEditor.css'
import { createEmptySubjectSchema, validateSubjectSchema } from './subjectSchemaValidator'

const STRUCTURE_NODES = [
  { id: 'basic', label: 'Basic', icon: 'fa-solid fa-circle-info' },
  { id: 'kinds', label: 'Entity Kinds', icon: 'fa-solid fa-shapes' },
  { id: 'features', label: 'Feature Groups', icon: 'fa-solid fa-tags' },
  { id: 'relations', label: 'Relation Types', icon: 'fa-solid fa-link' },
  { id: 'rules', label: 'Validation Rules', icon: 'fa-solid fa-list-check' },
  { id: 'json', label: 'Raw JSON', icon: 'fa-solid fa-code' },
]

const createUiId = (prefix = 'ui') => `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`

function stripSchemaUiState(value) {
  if (Array.isArray(value)) return value.map((item) => stripSchemaUiState(item))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.startsWith('_ui'))
      .map(([key, item]) => [key, stripSchemaUiState(item)])
  )
}

const toPrettyJson = (value) => JSON.stringify(stripSchemaUiState(value), null, 2)

function getFileName(filePath = '') {
  return String(filePath || '').split(/[\\/]/).pop() || 'Untitled'
}

function updateArrayItem(items, index, patch) {
  return items.map((item, itemIndex) => (
    itemIndex === index ? { ...item, ...patch } : item
  ))
}

function moveArrayItem(items, index, delta) {
  const nextIndex = index + delta
  if (nextIndex < 0 || nextIndex >= items.length) return items
  const next = [...items]
  const [item] = next.splice(index, 1)
  next.splice(nextIndex, 0, item)
  return next
}

function getMovedIndex(index, delta, length) {
  const nextIndex = index + delta
  if (index < 0 || nextIndex < 0 || nextIndex >= length) return index
  return nextIndex
}

function getDefaultSubKindsByKind(schema) {
  return schema.uiHints?.defaultSubKindsByKind || {}
}

function TextField({ inputRef, label, onChange, value }) {
  return (
    <label className="schema-field">
      <span>{label}</span>
      <input onChange={(event) => onChange(event.target.value)} ref={inputRef} value={value || ''} />
    </label>
  )
}

function TextAreaField({ label, onChange, value }) {
  return (
    <label className="schema-field">
      <span>{label}</span>
      <textarea onChange={(event) => onChange(event.target.value)} value={value || ''} />
    </label>
  )
}

function SchemaItemList({
  actions = [],
  emptyText = 'No item.',
  getDescription,
  getLabel,
  getValue,
  items = [],
  onSelect,
  selectedValue,
  title,
}) {
  return (
    <div className="schema-list-box">
      {title ? <div className="schema-list-title">{title}</div> : null}
      {items.length === 0 ? (
        <div className="schema-empty-state">{emptyText}</div>
      ) : (
        <select
          className="schema-native-list"
          onChange={(event) => onSelect?.(event.target.value)}
          size={Math.max(4, Math.min(14, items.length))}
          value={selectedValue || ''}
        >
          {items.map((item, index) => {
            const value = getValue(item, index)
            const label = getLabel(item, index)
            const description = getDescription?.(item, index)
            return (
              <option key={`${value || 'item'}-${index}`} title={description || label} value={value}>
                {description ? `${label}  -  ${description}` : label}
              </option>
            )
          })}
        </select>
      )}
      {actions.length > 0 ? (
        <div className="schema-list-actions">
          {actions.map((action) => (
            <button
              className={action.danger ? 'danger' : ''}
              disabled={action.disabled}
              key={action.label}
              onClick={action.onClick}
              type="button"
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function SubjectSchemaEditor() {
  const [schemaFiles, setSchemaFiles] = useState([])
  const [schemaFolder, setSchemaFolder] = useState('')
  const [schema, setSchema] = useState(() => createEmptySubjectSchema())
  const [filePath, setFilePath] = useState('')
  const [activeNode, setActiveNode] = useState('basic')
  const [selectedKind, setSelectedKind] = useState('')
  const [kindChildTab, setKindChildTab] = useState('subKinds')
  const [selectedSchemaFilePath, setSelectedSchemaFilePath] = useState('')
  const [selectedSubKindIndex, setSelectedSubKindIndex] = useState(0)
  const [selectedRoleIndex, setSelectedRoleIndex] = useState(0)
  const [selectedFeatureGroup, setSelectedFeatureGroup] = useState('')
  const [selectedFeatureValueIndex, setSelectedFeatureValueIndex] = useState(0)
  const [selectedRelationIndex, setSelectedRelationIndex] = useState(0)
  const [selectedRule, setSelectedRule] = useState('')
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState('Ready')
  const [rawJsonDraft, setRawJsonDraft] = useState('')
  const pendingFocusRef = useRef('')

  const validation = useMemo(() => validateSubjectSchema(schema), [schema])
  const selectedKindData = schema.entityKinds.find((kind) => kind.value === selectedKind) || schema.entityKinds[0] || null
  const selectedKindValue = selectedKindData?.value || ''
  const selectedSubKindData = (selectedKindData?.subKinds || [])[selectedSubKindIndex] || null
  const selectedFeatureGroupData = schema.featureGroups.find((group) => group.key === selectedFeatureGroup) || schema.featureGroups[0] || null
  const selectedFeatureGroupKey = selectedFeatureGroupData?.key || ''
  const selectedFeatureValueData = (selectedFeatureGroupData?.values || [])[selectedFeatureValueIndex] || null
  const selectedRelationData = (schema.relationTypes || [])[selectedRelationIndex] || null
  const selectedRuleData = schema.validationRules.find((rule) => rule.id === selectedRule) || schema.validationRules[0] || null
  const selectedRuleId = selectedRuleData?.id || ''
  const selectedKindDefaultSubKind = getDefaultSubKindsByKind(schema)[selectedKindValue] || ''

  const markSchemaChanged = (updater) => {
    setSchema((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater
      return next
    })
    setDirty(true)
  }

  const focusPendingInput = (focusKey) => (element) => {
    if (!element || pendingFocusRef.current !== focusKey) return
    pendingFocusRef.current = ''
    window.requestAnimationFrame(() => {
      element.focus()
      element.select?.()
    })
  }

  const loadSchemaList = async () => {
    const result = await window.labApi?.listSubjectSchemas?.()
    if (!result?.ok) {
      setStatus(`Load schema list failed: ${result?.reason || 'unknown error'}`)
      return
    }
    setSchemaFolder(result.folderPath || '')
    setSchemaFiles(result.files || [])
  }

  useEffect(() => {
    let canceled = false
    window.labApi?.listSubjectSchemas?.().then((result) => {
      if (canceled) return
      if (!result?.ok) {
        setStatus(`Load schema list failed: ${result?.reason || 'unknown error'}`)
        return
      }
      setSchemaFolder(result.folderPath || '')
      setSchemaFiles(result.files || [])
    })
    return () => {
      canceled = true
    }
  }, [])

  useEffect(() => {
    if (schemaFiles.length === 0) {
      setSelectedSchemaFilePath('')
      return
    }
    if (selectedSchemaFilePath && schemaFiles.some((file) => file.filePath === selectedSchemaFilePath)) return
    setSelectedSchemaFilePath(filePath && schemaFiles.some((file) => file.filePath === filePath) ? filePath : schemaFiles[0].filePath)
  }, [filePath, schemaFiles, selectedSchemaFilePath])

  useEffect(() => {
    setSelectedSubKindIndex(0)
    setSelectedRoleIndex(0)
  }, [selectedKindValue])

  useEffect(() => {
    setSelectedFeatureValueIndex(0)
  }, [selectedFeatureGroupKey])

  useEffect(() => {
    const subKindCount = selectedKindData?.subKinds?.length || 0
    if (selectedSubKindIndex >= subKindCount) setSelectedSubKindIndex(Math.max(0, subKindCount - 1))
    const roleCount = schema.rolesByKind[selectedKindValue]?.length || 0
    if (selectedRoleIndex >= roleCount) setSelectedRoleIndex(Math.max(0, roleCount - 1))
    const featureValueCount = selectedFeatureGroupData?.values?.length || 0
    if (selectedFeatureValueIndex >= featureValueCount) setSelectedFeatureValueIndex(Math.max(0, featureValueCount - 1))
    const relationCount = schema.relationTypes?.length || 0
    if (selectedRelationIndex >= relationCount) setSelectedRelationIndex(Math.max(0, relationCount - 1))
  }, [
    schema.relationTypes,
    schema.rolesByKind,
    selectedFeatureGroupData,
    selectedFeatureValueIndex,
    selectedKindData,
    selectedKindValue,
    selectedRelationIndex,
    selectedRoleIndex,
    selectedSubKindIndex,
  ])

  const setLoadedSchema = (result) => {
    setSchema(result.data || createEmptySubjectSchema())
    setRawJsonDraft(toPrettyJson(result.data || createEmptySubjectSchema()))
    setFilePath(result.filePath || '')
    setDirty(false)
    setStatus(`Loaded ${result.fileName || getFileName(result.filePath)}`)
    const firstKind = result.data?.entityKinds?.[0]?.value || ''
    const firstGroup = result.data?.featureGroups?.[0]?.key || ''
    const firstRule = result.data?.validationRules?.[0]?.id || ''
    setSelectedKind(firstKind)
    setSelectedFeatureGroup(firstGroup)
    setSelectedRule(firstRule)
  }

  const openSchemaFile = async (targetFilePath) => {
    if (dirty && !window.confirm('Current schema has unsaved changes. Continue?')) return
    const result = targetFilePath
      ? await window.labApi?.readSubjectSchemaFile?.(targetFilePath)
      : await window.labApi?.openSubjectSchema?.()
    if (!result?.ok) {
      if (!result?.canceled) setStatus(`Open failed: ${result?.reason || 'unknown error'}`)
      return
    }
    setLoadedSchema(result)
  }

  const newSchema = () => {
    if (dirty && !window.confirm('Current schema has unsaved changes. Continue?')) return
    const nextSchema = createEmptySubjectSchema()
    setSchema(nextSchema)
    setRawJsonDraft(toPrettyJson(nextSchema))
    setFilePath('')
    setDirty(true)
    setStatus('New schema')
    setActiveNode('basic')
    setSelectedKind('')
    setSelectedFeatureGroup('')
    setSelectedRule('')
  }

  const saveSchema = async () => {
    const data = stripSchemaUiState(schema)
    const result = filePath
      ? await window.labApi?.saveSubjectSchema?.({ filePath, data })
      : await window.labApi?.saveSubjectSchemaAs?.({ data, suggestedName: schema.subjectId })
    if (!result?.ok) {
      if (!result?.canceled) setStatus(`Save failed: ${result?.reason || 'unknown error'}`)
      return false
    }
    setFilePath(result.filePath)
    setDirty(false)
    setStatus(`Saved ${result.fileName || getFileName(result.filePath)}`)
    await loadSchemaList()
    return true
  }

  const saveSchemaAs = async () => {
    const data = stripSchemaUiState(schema)
    const result = await window.labApi?.saveSubjectSchemaAs?.({ data, suggestedName: schema.subjectId })
    if (!result?.ok) {
      if (!result?.canceled) setStatus(`Save As failed: ${result?.reason || 'unknown error'}`)
      return false
    }
    setFilePath(result.filePath)
    setDirty(false)
    setStatus(`Saved ${result.fileName || getFileName(result.filePath)}`)
    await loadSchemaList()
    return true
  }

  const reloadSchema = async () => {
    if (!filePath) return
    if (dirty && !window.confirm('Current schema has unsaved changes. Reload?')) return
    await openSchemaFile(filePath)
  }

  const copySchemaFile = async (targetFilePath) => {
    if (!targetFilePath) return
    const result = await window.labApi?.copySubjectSchema?.(targetFilePath)
    if (!result?.ok) {
      setStatus(`Copy failed: ${result?.reason || 'unknown error'}`)
      return
    }
    await loadSchemaList()
    setLoadedSchema(result)
  }

  const deleteSchemaFile = async (targetFilePath, targetFileName) => {
    if (!targetFilePath) return
    if (!window.confirm(`Delete schema file?\n\n${targetFileName || getFileName(targetFilePath)}`)) return
    const result = await window.labApi?.deleteSubjectSchema?.(targetFilePath)
    if (!result?.ok) {
      setStatus(`Delete failed: ${result?.reason || 'unknown error'}`)
      return
    }
    await loadSchemaList()
    if (targetFilePath === filePath) {
      const nextSchema = createEmptySubjectSchema()
      setSchema(nextSchema)
      setRawJsonDraft(toPrettyJson(nextSchema))
      setFilePath('')
      setDirty(false)
      setStatus(`Deleted ${result.fileName || targetFileName || getFileName(targetFilePath)}`)
      setSelectedKind('')
      setSelectedFeatureGroup('')
      setSelectedRule('')
      return
    }
    setStatus(`Deleted ${result.fileName || targetFileName || getFileName(targetFilePath)}`)
  }

  const addKind = () => {
    const value = `kind_${schema.entityKinds.length + 1}`
    markSchemaChanged((current) => ({
      ...current,
      entityKinds: [...current.entityKinds, { value, label: 'New Kind', description: '', subKinds: [] }],
      rolesByKind: {
        ...current.rolesByKind,
        [value]: [],
      },
    }))
    setSelectedKind(value)
  }

  const deleteKind = (kindValue) => {
    if (!kindValue || !window.confirm(`Delete kind "${kindValue}"?`)) return
    markSchemaChanged((current) => {
      const nextRolesByKind = { ...current.rolesByKind }
      const nextDefaultSubKindsByKind = { ...getDefaultSubKindsByKind(current) }
      delete nextRolesByKind[kindValue]
      delete nextDefaultSubKindsByKind[kindValue]
      return {
        ...current,
        entityKinds: current.entityKinds.filter((kind) => kind.value !== kindValue),
        rolesByKind: nextRolesByKind,
        uiHints: {
          ...(current.uiHints || {}),
          defaultSubKindsByKind: nextDefaultSubKindsByKind,
        },
      }
    })
    setSelectedKind('')
  }

  const moveKind = (delta) => {
    const index = schema.entityKinds.indexOf(selectedKindData)
    if (index < 0) return
    const nextIndex = getMovedIndex(index, delta, schema.entityKinds.length)
    markSchemaChanged((current) => ({
      ...current,
      entityKinds: moveArrayItem(current.entityKinds, index, delta),
    }))
    setSelectedKind(schema.entityKinds[nextIndex]?.value || selectedKindValue)
  }

  const updateKind = (index, patch) => {
    markSchemaChanged((current) => {
      const oldKind = current.entityKinds[index]
      const nextKinds = updateArrayItem(current.entityKinds, index, patch)
      const nextRolesByKind = { ...current.rolesByKind }
      const nextDefaultSubKindsByKind = { ...getDefaultSubKindsByKind(current) }
      if (patch.value && oldKind?.value && patch.value !== oldKind.value) {
        nextRolesByKind[patch.value] = nextRolesByKind[oldKind.value] || []
        delete nextRolesByKind[oldKind.value]
        if (Object.prototype.hasOwnProperty.call(nextDefaultSubKindsByKind, oldKind.value)) {
          nextDefaultSubKindsByKind[patch.value] = nextDefaultSubKindsByKind[oldKind.value]
          delete nextDefaultSubKindsByKind[oldKind.value]
        }
        setSelectedKind(patch.value)
      }
      return {
        ...current,
        entityKinds: nextKinds,
        rolesByKind: nextRolesByKind,
        uiHints: {
          ...(current.uiHints || {}),
          defaultSubKindsByKind: nextDefaultSubKindsByKind,
        },
      }
    })
  }

  const updateDefaultSubKind = (kindValue, subKindValue) => {
    if (!kindValue) return
    markSchemaChanged((current) => {
      const nextDefaultSubKindsByKind = { ...getDefaultSubKindsByKind(current) }
      if (subKindValue) {
        nextDefaultSubKindsByKind[kindValue] = subKindValue
      } else {
        delete nextDefaultSubKindsByKind[kindValue]
      }
      return {
        ...current,
        uiHints: {
          ...(current.uiHints || {}),
          defaultSubKindsByKind: nextDefaultSubKindsByKind,
        },
      }
    })
  }

  const addSubKind = () => {
    const kindIndex = schema.entityKinds.indexOf(selectedKindData)
    if (kindIndex < 0) return
    const value = `subKind_${(selectedKindData.subKinds || []).length + 1}`
    pendingFocusRef.current = `subKind:${selectedKindData.value}:${value}`
    updateKind(kindIndex, {
      subKinds: [
        ...(selectedKindData.subKinds || []),
        { _uiId: createUiId('subKind'), value, label: 'New SubKind' },
      ],
    })
    setSelectedSubKindIndex((selectedKindData.subKinds || []).length)
  }

  const updateSubKind = (subKindIndex, patch) => {
    const kindIndex = schema.entityKinds.indexOf(selectedKindData)
    if (kindIndex < 0) return
    updateKind(kindIndex, {
      subKinds: updateArrayItem(selectedKindData.subKinds || [], subKindIndex, patch),
    })
  }

  const moveSubKind = (subKindIndex, delta) => {
    const kindIndex = schema.entityKinds.indexOf(selectedKindData)
    if (kindIndex < 0) return
    const subKinds = selectedKindData.subKinds || []
    updateKind(kindIndex, {
      subKinds: moveArrayItem(subKinds, subKindIndex, delta),
    })
    setSelectedSubKindIndex(getMovedIndex(subKindIndex, delta, subKinds.length))
  }

  const deleteSubKind = (subKindIndex) => {
    const kindIndex = schema.entityKinds.indexOf(selectedKindData)
    if (kindIndex < 0 || !window.confirm('Delete this subkind?')) return
    const deletedSubKind = (selectedKindData.subKinds || [])[subKindIndex]
    const nextSubKinds = (selectedKindData.subKinds || []).filter((_subKind, index) => index !== subKindIndex)
    updateKind(kindIndex, {
      subKinds: nextSubKinds,
    })
    if (deletedSubKind?.value && selectedKindDefaultSubKind === deletedSubKind.value) {
      updateDefaultSubKind(selectedKindData.value, '')
    }
    setSelectedSubKindIndex(Math.max(0, Math.min(subKindIndex, nextSubKinds.length - 1)))
  }

  const addRole = () => {
    if (!selectedKindValue) return
    const value = `role_${(schema.rolesByKind[selectedKindValue] || []).length + 1}`
    pendingFocusRef.current = `role:${selectedKindValue}:${value}`
    markSchemaChanged((current) => ({
      ...current,
      rolesByKind: {
        ...current.rolesByKind,
        [selectedKindValue]: [
          ...(current.rolesByKind[selectedKindValue] || []),
          { _uiId: createUiId('role'), value, label: 'New Role', required: false },
        ],
      },
    }))
    setSelectedRoleIndex(schema.rolesByKind[selectedKindValue]?.length || 0)
  }

  const updateRole = (index, patch) => {
    if (!selectedKindValue) return
    markSchemaChanged((current) => ({
      ...current,
      rolesByKind: {
        ...current.rolesByKind,
        [selectedKindValue]: updateArrayItem(current.rolesByKind[selectedKindValue] || [], index, patch),
      },
    }))
  }

  const deleteRole = (index) => {
    if (!selectedKindValue || !window.confirm('Delete this role?')) return
    const nextLength = Math.max(0, (schema.rolesByKind[selectedKindValue] || []).length - 1)
    markSchemaChanged((current) => ({
      ...current,
      rolesByKind: {
        ...current.rolesByKind,
        [selectedKindValue]: (current.rolesByKind[selectedKindValue] || []).filter((_role, roleIndex) => roleIndex !== index),
      },
    }))
    setSelectedRoleIndex(Math.max(0, Math.min(index, nextLength - 1)))
  }

  const moveRole = (index, delta) => {
    if (!selectedKindValue) return
    const roles = schema.rolesByKind[selectedKindValue] || []
    markSchemaChanged((current) => ({
      ...current,
      rolesByKind: {
        ...current.rolesByKind,
        [selectedKindValue]: moveArrayItem(current.rolesByKind[selectedKindValue] || [], index, delta),
      },
    }))
    setSelectedRoleIndex(getMovedIndex(index, delta, roles.length))
  }

  const addFeatureGroup = () => {
    const key = `featureGroup_${schema.featureGroups.length + 1}`
    const uiId = createUiId('featureGroup')
    pendingFocusRef.current = `featureGroup:${uiId}`
    markSchemaChanged((current) => ({
      ...current,
      featureGroups: [...current.featureGroups, { _uiId: uiId, key, label: 'New Feature Group', multi: true, values: [] }],
    }))
    setSelectedFeatureGroup(key)
  }

  const moveFeatureGroup = (index, delta) => {
    const nextIndex = getMovedIndex(index, delta, schema.featureGroups.length)
    markSchemaChanged((current) => ({
      ...current,
      featureGroups: moveArrayItem(current.featureGroups, index, delta),
    }))
    setSelectedFeatureGroup(schema.featureGroups[nextIndex]?.key || selectedFeatureGroupKey)
  }

  const updateFeatureGroup = (index, patch) => {
    markSchemaChanged((current) => {
      const oldGroup = current.featureGroups[index]
      const nextGroups = updateArrayItem(current.featureGroups, index, patch)
      if (patch.key && oldGroup?.key && patch.key !== oldGroup.key) setSelectedFeatureGroup(patch.key)
      return { ...current, featureGroups: nextGroups }
    })
  }

  const deleteFeatureGroup = (index) => {
    if (!window.confirm('Delete this feature group?')) return
    markSchemaChanged((current) => ({
      ...current,
      featureGroups: current.featureGroups.filter((_group, groupIndex) => groupIndex !== index),
    }))
    setSelectedFeatureGroup('')
  }

  const addFeatureValue = () => {
    const groupIndex = schema.featureGroups.findIndex((group) => group.key === selectedFeatureGroupKey)
    if (groupIndex < 0) return
    const value = `value_${(selectedFeatureGroupData.values || []).length + 1}`
    const uiId = createUiId('featureValue')
    pendingFocusRef.current = `featureValue:${uiId}`
    markSchemaChanged((current) => ({
      ...current,
      featureGroups: current.featureGroups.map((group, index) => (
        index === groupIndex
          ? { ...group, values: [...(group.values || []), { _uiId: uiId, value, label: 'New Value' }] }
          : group
      )),
    }))
    setSelectedFeatureValueIndex(selectedFeatureGroupData.values?.length || 0)
  }

  const updateFeatureValue = (valueIndex, patch) => {
    const groupIndex = schema.featureGroups.findIndex((group) => group.key === selectedFeatureGroupKey)
    if (groupIndex < 0) return
    markSchemaChanged((current) => ({
      ...current,
      featureGroups: current.featureGroups.map((group, index) => (
        index === groupIndex
          ? { ...group, values: updateArrayItem(group.values || [], valueIndex, patch) }
          : group
      )),
    }))
  }

  const deleteFeatureValue = (valueIndex) => {
    if (!window.confirm('Delete this feature value?')) return
    const groupIndex = schema.featureGroups.findIndex((group) => group.key === selectedFeatureGroupKey)
    if (groupIndex < 0) return
    const nextLength = Math.max(0, (selectedFeatureGroupData.values || []).length - 1)
    markSchemaChanged((current) => ({
      ...current,
      featureGroups: current.featureGroups.map((group, index) => (
        index === groupIndex
          ? { ...group, values: (group.values || []).filter((_value, indexValue) => indexValue !== valueIndex) }
          : group
      )),
    }))
    setSelectedFeatureValueIndex(Math.max(0, Math.min(valueIndex, nextLength - 1)))
  }

  const moveFeatureValue = (valueIndex, delta) => {
    const groupIndex = schema.featureGroups.findIndex((group) => group.key === selectedFeatureGroupKey)
    if (groupIndex < 0) return
    const values = selectedFeatureGroupData.values || []
    markSchemaChanged((current) => ({
      ...current,
      featureGroups: current.featureGroups.map((group, index) => (
        index === groupIndex
          ? { ...group, values: moveArrayItem(group.values || [], valueIndex, delta) }
          : group
      )),
    }))
    setSelectedFeatureValueIndex(getMovedIndex(valueIndex, delta, values.length))
  }

  const addRelationType = () => {
    const uiId = createUiId('relation')
    pendingFocusRef.current = `relation:${uiId}`
    markSchemaChanged((current) => ({
      ...current,
      relationTypes: [
        ...(current.relationTypes || []),
        { _uiId: uiId, value: `relation_${(current.relationTypes || []).length + 1}`, label: 'New Relation' },
      ],
    }))
    setSelectedRelationIndex(schema.relationTypes?.length || 0)
  }

  const updateRelationType = (index, patch) => {
    markSchemaChanged((current) => ({
      ...current,
      relationTypes: updateArrayItem(current.relationTypes || [], index, patch),
    }))
  }

  const deleteRelationType = (index) => {
    if (!window.confirm('Delete this relation type?')) return
    const nextLength = Math.max(0, (schema.relationTypes || []).length - 1)
    markSchemaChanged((current) => ({
      ...current,
      relationTypes: (current.relationTypes || []).filter((_item, itemIndex) => itemIndex !== index),
    }))
    setSelectedRelationIndex(Math.max(0, Math.min(index, nextLength - 1)))
  }

  const moveRelationType = (index, delta) => {
    const relationTypes = schema.relationTypes || []
    markSchemaChanged((current) => ({
      ...current,
      relationTypes: moveArrayItem(current.relationTypes || [], index, delta),
    }))
    setSelectedRelationIndex(getMovedIndex(index, delta, relationTypes.length))
  }

  const addRule = () => {
    const id = `rule_${schema.validationRules.length + 1}`
    markSchemaChanged((current) => ({
      ...current,
      validationRules: [
        ...current.validationRules,
        { id, type: 'requiredRole', level: 'error', kind: schema.entityKinds[0]?.value || '', role: '', message: 'New rule' },
      ],
    }))
    setSelectedRule(id)
  }

  const moveRule = (index, delta) => {
    const nextIndex = getMovedIndex(index, delta, schema.validationRules.length)
    markSchemaChanged((current) => ({
      ...current,
      validationRules: moveArrayItem(current.validationRules, index, delta),
    }))
    setSelectedRule(schema.validationRules[nextIndex]?.id || selectedRuleId)
  }

  const updateRule = (index, patch) => {
    markSchemaChanged((current) => {
      const nextRules = updateArrayItem(current.validationRules, index, patch)
      if (patch.id) setSelectedRule(patch.id)
      return { ...current, validationRules: nextRules }
    })
  }

  const deleteRule = (index) => {
    if (!window.confirm('Delete this validation rule?')) return
    markSchemaChanged((current) => ({
      ...current,
      validationRules: current.validationRules.filter((_rule, ruleIndex) => ruleIndex !== index),
    }))
    setSelectedRule('')
  }

  const applyRawJson = () => {
    try {
      const next = JSON.parse(rawJsonDraft)
      setSchema(next)
      setRawJsonDraft(toPrettyJson(next))
      setDirty(true)
      setStatus('Raw JSON applied')
    } catch (error) {
      setStatus(`Invalid JSON: ${error.message}`)
    }
  }

  const renderBasicEditor = () => (
    <div className="schema-form">
      <TextField label="subjectId" onChange={(value) => markSchemaChanged((current) => ({ ...current, subjectId: value }))} value={schema.subjectId} />
      <TextField label="label" onChange={(value) => markSchemaChanged((current) => ({ ...current, label: value }))} value={schema.label} />
      <TextField label="version" onChange={(value) => markSchemaChanged((current) => ({ ...current, version: value }))} value={schema.version} />
      <TextAreaField label="description" onChange={(value) => markSchemaChanged((current) => ({ ...current, description: value }))} value={schema.description} />
      <TextField label="defaultKind" onChange={(value) => markSchemaChanged((current) => ({ ...current, uiHints: { ...current.uiHints, defaultKind: value } }))} value={schema.uiHints?.defaultKind} />
      <TextField label="defaultLabel" onChange={(value) => markSchemaChanged((current) => ({ ...current, uiHints: { ...current.uiHints, defaultLabel: value } }))} value={schema.uiHints?.defaultLabel} />
    </div>
  )

  const renderCurrentKindRolesPanel = () => {
    const roles = schema.rolesByKind[selectedKindValue] || []
    const selectedRoleData = roles[selectedRoleIndex] || null
    return (
      <div className="schema-kind-child-panel">
        <SchemaItemList
          actions={[
            { label: 'Add', onClick: addRole, disabled: !selectedKindValue },
            { label: 'Delete', onClick: () => deleteRole(selectedRoleIndex), disabled: !selectedRoleData, danger: true },
            { label: 'Up', onClick: () => moveRole(selectedRoleIndex, -1), disabled: !selectedRoleData || selectedRoleIndex <= 0 },
            { label: 'Down', onClick: () => moveRole(selectedRoleIndex, 1), disabled: !selectedRoleData || selectedRoleIndex >= roles.length - 1 },
          ]}
          emptyText="No role."
          getDescription={(role) => role.value}
          getLabel={(role, index) => `${index + 1}. ${role.label || role.value || 'Untitled Role'}`}
          getValue={(_role, index) => String(index)}
          items={roles}
          onSelect={(value) => setSelectedRoleIndex(Number(value))}
          selectedValue={String(selectedRoleIndex)}
          title="Roles"
        />
        {selectedRoleData ? (
          <div className="schema-form compact schema-inline-editor">
            <TextField
              inputRef={focusPendingInput(`role:${selectedKindValue}:${selectedRoleData.value}`)}
              label="value"
              onChange={(value) => updateRole(selectedRoleIndex, { value })}
              value={selectedRoleData.value}
            />
            <TextField label="label" onChange={(value) => updateRole(selectedRoleIndex, { label: value })} value={selectedRoleData.label} />
            <label className="schema-check">
              <input checked={Boolean(selectedRoleData.required)} onChange={(event) => updateRole(selectedRoleIndex, { required: event.target.checked })} type="checkbox" />
              Required
            </label>
          </div>
        ) : null}
      </div>
    )
  }

  const renderCurrentKindSubKindsPanel = () => (
    <div className="schema-kind-child-panel">
      <label className="schema-field schema-default-subkind-field">
        <span>Default SubKind</span>
        <select
          disabled={(selectedKindData.subKinds || []).length === 0}
          onChange={(event) => updateDefaultSubKind(selectedKindData.value, event.target.value)}
          value={selectedKindDefaultSubKind}
        >
          <option value="">none</option>
          {selectedKindDefaultSubKind && !(selectedKindData.subKinds || []).some((subKind) => subKind.value === selectedKindDefaultSubKind) ? (
            <option value={selectedKindDefaultSubKind}>{selectedKindDefaultSubKind} (missing)</option>
          ) : null}
          {(selectedKindData.subKinds || []).map((subKind, index) => (
            <option key={`${subKind.value || 'subKind'}-${index}`} value={subKind.value || ''}>
              {subKind.label || subKind.value || `SubKind ${index + 1}`}
            </option>
          ))}
        </select>
      </label>
      <SchemaItemList
        actions={[
          { label: 'Add', onClick: addSubKind },
          { label: 'Delete', onClick: () => deleteSubKind(selectedSubKindIndex), disabled: !selectedSubKindData, danger: true },
          { label: 'Up', onClick: () => moveSubKind(selectedSubKindIndex, -1), disabled: !selectedSubKindData || selectedSubKindIndex <= 0 },
          { label: 'Down', onClick: () => moveSubKind(selectedSubKindIndex, 1), disabled: !selectedSubKindData || selectedSubKindIndex >= (selectedKindData.subKinds || []).length - 1 },
        ]}
        emptyText="No subkind."
        getDescription={(subKind) => subKind.value}
        getLabel={(subKind, index) => `${index + 1}. ${subKind.label || subKind.value || 'Untitled SubKind'}`}
        getValue={(_subKind, index) => String(index)}
        items={selectedKindData.subKinds || []}
        onSelect={(value) => setSelectedSubKindIndex(Number(value))}
        selectedValue={String(selectedSubKindIndex)}
        title="SubKinds"
      />
      {selectedSubKindData ? (
        <div className="schema-form compact schema-inline-editor">
          <TextField
            inputRef={focusPendingInput(`subKind:${selectedKindData.value}:${selectedSubKindData.value}`)}
            label="value"
            onChange={(value) => updateSubKind(selectedSubKindIndex, { value })}
            value={selectedSubKindData.value}
          />
          <TextField label="label" onChange={(value) => updateSubKind(selectedSubKindIndex, { label: value })} value={selectedSubKindData.label} />
        </div>
      ) : null}
    </div>
  )

  const renderKindEditor = () => (
    <div className="schema-split-editor">
      <div className="schema-list-editor">
        <SchemaItemList
          actions={[
            { label: 'Add', onClick: addKind },
            { label: 'Delete', onClick: () => deleteKind(selectedKindValue), disabled: !selectedKindValue, danger: true },
            { label: 'Up', onClick: () => moveKind(-1), disabled: schema.entityKinds.indexOf(selectedKindData) <= 0 },
            { label: 'Down', onClick: () => moveKind(1), disabled: schema.entityKinds.indexOf(selectedKindData) < 0 || schema.entityKinds.indexOf(selectedKindData) >= schema.entityKinds.length - 1 },
          ]}
          emptyText="No kind."
          getDescription={(kind) => kind.value}
          getLabel={(kind, index) => `${index + 1}. ${kind.label || kind.value || 'Untitled Kind'}`}
          getValue={(kind) => kind.value}
          items={schema.entityKinds}
          onSelect={setSelectedKind}
          selectedValue={selectedKindValue}
          title="Kinds"
        />
      </div>
      <div className="schema-form">
        {selectedKindData ? (
          <>
            <TextField label="value" onChange={(value) => updateKind(schema.entityKinds.indexOf(selectedKindData), { value })} value={selectedKindData.value} />
            <TextField label="label" onChange={(value) => updateKind(schema.entityKinds.indexOf(selectedKindData), { label: value })} value={selectedKindData.label} />
            <TextAreaField label="description" onChange={(value) => updateKind(schema.entityKinds.indexOf(selectedKindData), { description: value })} value={selectedKindData.description} />
            <div className="schema-kind-child-tabs">
              <button className={kindChildTab === 'subKinds' ? 'active' : ''} onClick={() => setKindChildTab('subKinds')} type="button">SubKinds</button>
              <button className={kindChildTab === 'roles' ? 'active' : ''} onClick={() => setKindChildTab('roles')} type="button">Roles</button>
            </div>
            <div className="schema-subkind-editor">
              {kindChildTab === 'roles' ? renderCurrentKindRolesPanel() : renderCurrentKindSubKindsPanel()}
            </div>
          </>
        ) : <div className="schema-empty-state">No kind selected.</div>}
      </div>
    </div>
  )

  const renderFeaturesEditor = () => (
    <div className="schema-split-editor">
      <div className="schema-list-editor">
        <SchemaItemList
          actions={[
            { label: 'Add', onClick: addFeatureGroup },
            { label: 'Delete', onClick: () => deleteFeatureGroup(schema.featureGroups.indexOf(selectedFeatureGroupData)), disabled: !selectedFeatureGroupData, danger: true },
            { label: 'Up', onClick: () => moveFeatureGroup(schema.featureGroups.indexOf(selectedFeatureGroupData), -1), disabled: schema.featureGroups.indexOf(selectedFeatureGroupData) <= 0 },
            { label: 'Down', onClick: () => moveFeatureGroup(schema.featureGroups.indexOf(selectedFeatureGroupData), 1), disabled: schema.featureGroups.indexOf(selectedFeatureGroupData) < 0 || schema.featureGroups.indexOf(selectedFeatureGroupData) >= schema.featureGroups.length - 1 },
          ]}
          emptyText="No feature group."
          getDescription={(group) => `${group.key} / ${(group.values || []).length} values`}
          getLabel={(group, index) => `${index + 1}. ${group.label || group.key || 'Untitled Group'}`}
          getValue={(group) => group.key}
          items={schema.featureGroups}
          onSelect={setSelectedFeatureGroup}
          selectedValue={selectedFeatureGroupKey}
          title="Feature Groups"
        />
      </div>
      <div className="schema-table-editor">
        {selectedFeatureGroupData ? (
          <>
            <div className="schema-form compact">
              <TextField
                inputRef={focusPendingInput(`featureGroup:${selectedFeatureGroupData._uiId}`)}
                label="key"
                onChange={(value) => updateFeatureGroup(schema.featureGroups.indexOf(selectedFeatureGroupData), { key: value })}
                value={selectedFeatureGroupData.key}
              />
              <TextField label="label" onChange={(value) => updateFeatureGroup(schema.featureGroups.indexOf(selectedFeatureGroupData), { label: value })} value={selectedFeatureGroupData.label} />
              <label className="schema-check">
                <input checked={Boolean(selectedFeatureGroupData.multi)} onChange={(event) => updateFeatureGroup(schema.featureGroups.indexOf(selectedFeatureGroupData), { multi: event.target.checked })} type="checkbox" />
                Multi
              </label>
              <label className="schema-field">
                <span>section</span>
                <select
                  onChange={(event) => updateFeatureGroup(schema.featureGroups.indexOf(selectedFeatureGroupData), { section: event.target.value })}
                  value={selectedFeatureGroupData.section || 'basic'}
                >
                  <option value="basic">basic</option>
                  <option value="keyword">keyword</option>
                  <option value="">none</option>
                </select>
              </label>
              <label className="schema-field">
                <span>inputMode</span>
                <select
                  onChange={(event) => updateFeatureGroup(schema.featureGroups.indexOf(selectedFeatureGroupData), { inputMode: event.target.value })}
                  value={selectedFeatureGroupData.inputMode || 'select'}
                >
                  <option value="select">select</option>
                  <option value="dropdown">dropdown</option>
                  <option value="manual">manual</option>
                  <option value="">none</option>
                </select>
              </label>
            </div>
            <SchemaItemList
              actions={[
                { label: 'Add', onClick: addFeatureValue },
                { label: 'Delete', onClick: () => deleteFeatureValue(selectedFeatureValueIndex), disabled: !selectedFeatureValueData, danger: true },
                { label: 'Up', onClick: () => moveFeatureValue(selectedFeatureValueIndex, -1), disabled: !selectedFeatureValueData || selectedFeatureValueIndex <= 0 },
                { label: 'Down', onClick: () => moveFeatureValue(selectedFeatureValueIndex, 1), disabled: !selectedFeatureValueData || selectedFeatureValueIndex >= (selectedFeatureGroupData.values || []).length - 1 },
              ]}
              emptyText="No feature value."
              getDescription={(value) => value.value}
              getLabel={(value, index) => `${index + 1}. ${value.label || value.value || 'Untitled Value'}`}
              getValue={(_value, index) => String(index)}
              items={selectedFeatureGroupData.values || []}
              onSelect={(value) => setSelectedFeatureValueIndex(Number(value))}
              selectedValue={String(selectedFeatureValueIndex)}
              title="Feature Values"
            />
            {selectedFeatureValueData ? (
              <div className="schema-form compact schema-inline-editor">
                <TextField
                  inputRef={focusPendingInput(`featureValue:${selectedFeatureValueData._uiId}`)}
                  label="value"
                  onChange={(value) => updateFeatureValue(selectedFeatureValueIndex, { value })}
                  value={selectedFeatureValueData.value}
                />
                <TextField label="label" onChange={(value) => updateFeatureValue(selectedFeatureValueIndex, { label: value })} value={selectedFeatureValueData.label} />
              </div>
            ) : null}
          </>
        ) : <div className="schema-empty-state">No feature group selected.</div>}
      </div>
    </div>
  )

  const renderRelationsEditor = () => (
    <div className="schema-split-editor">
      <div className="schema-list-editor">
        <SchemaItemList
          actions={[
            { label: 'Add', onClick: addRelationType },
            { label: 'Delete', onClick: () => deleteRelationType(selectedRelationIndex), disabled: !selectedRelationData, danger: true },
            { label: 'Up', onClick: () => moveRelationType(selectedRelationIndex, -1), disabled: !selectedRelationData || selectedRelationIndex <= 0 },
            { label: 'Down', onClick: () => moveRelationType(selectedRelationIndex, 1), disabled: !selectedRelationData || selectedRelationIndex >= (schema.relationTypes || []).length - 1 },
          ]}
          emptyText="No relation type."
          getDescription={(relation) => relation.value}
          getLabel={(relation, index) => `${index + 1}. ${relation.label || relation.value || 'Untitled Relation'}`}
          getValue={(_relation, index) => String(index)}
          items={schema.relationTypes || []}
          onSelect={(value) => setSelectedRelationIndex(Number(value))}
          selectedValue={String(selectedRelationIndex)}
          title="Relation Types"
        />
      </div>
      <div className="schema-form">
        {selectedRelationData ? (
          <>
            <TextField
              inputRef={focusPendingInput(`relation:${selectedRelationData._uiId}`)}
              label="value"
              onChange={(value) => updateRelationType(selectedRelationIndex, { value })}
              value={selectedRelationData.value}
            />
            <TextField label="label" onChange={(value) => updateRelationType(selectedRelationIndex, { label: value })} value={selectedRelationData.label} />
          </>
        ) : <div className="schema-empty-state">No relation selected.</div>}
      </div>
    </div>
  )

  const renderRulesEditor = () => (
    <div className="schema-split-editor">
      <div className="schema-list-editor">
        <SchemaItemList
          actions={[
            { label: 'Add', onClick: addRule },
            { label: 'Delete', onClick: () => deleteRule(schema.validationRules.indexOf(selectedRuleData)), disabled: !selectedRuleData, danger: true },
            { label: 'Up', onClick: () => moveRule(schema.validationRules.indexOf(selectedRuleData), -1), disabled: schema.validationRules.indexOf(selectedRuleData) <= 0 },
            { label: 'Down', onClick: () => moveRule(schema.validationRules.indexOf(selectedRuleData), 1), disabled: schema.validationRules.indexOf(selectedRuleData) < 0 || schema.validationRules.indexOf(selectedRuleData) >= schema.validationRules.length - 1 },
          ]}
          emptyText="No validation rule."
          getDescription={(rule) => `${rule.type || 'rule'} / ${rule.level || 'level'}`}
          getLabel={(rule, index) => `${index + 1}. ${rule.id || `Rule ${index + 1}`}`}
          getValue={(rule) => rule.id}
          items={schema.validationRules}
          onSelect={setSelectedRule}
          selectedValue={selectedRuleId}
          title="Validation Rules"
        />
      </div>
      <div className="schema-form">
        {selectedRuleData ? (
          <>
            <TextField label="id" onChange={(value) => updateRule(schema.validationRules.indexOf(selectedRuleData), { id: value })} value={selectedRuleData.id} />
            <TextField label="type" onChange={(value) => updateRule(schema.validationRules.indexOf(selectedRuleData), { type: value })} value={selectedRuleData.type} />
            <label className="schema-field">
              <span>level</span>
              <select onChange={(event) => updateRule(schema.validationRules.indexOf(selectedRuleData), { level: event.target.value })} value={selectedRuleData.level || 'error'}>
                <option value="error">error</option>
                <option value="warning">warning</option>
              </select>
            </label>
            <TextField label="kind" onChange={(value) => updateRule(schema.validationRules.indexOf(selectedRuleData), { kind: value })} value={selectedRuleData.kind} />
            <TextField label="role" onChange={(value) => updateRule(schema.validationRules.indexOf(selectedRuleData), { role: value })} value={selectedRuleData.role} />
            <TextField label="featureGroup" onChange={(value) => updateRule(schema.validationRules.indexOf(selectedRuleData), { featureGroup: value })} value={selectedRuleData.featureGroup} />
            <TextField label="message" onChange={(value) => updateRule(schema.validationRules.indexOf(selectedRuleData), { message: value })} value={selectedRuleData.message} />
          </>
        ) : <div className="schema-empty-state">No rule selected.</div>}
      </div>
    </div>
  )

  const renderRawJsonEditor = () => (
    <div className="schema-raw-editor">
      <textarea onChange={(event) => setRawJsonDraft(event.target.value)} value={rawJsonDraft} />
      <button onClick={applyRawJson} type="button">Apply Raw JSON</button>
    </div>
  )

  const renderActiveEditor = () => {
    if (activeNode === 'basic') return renderBasicEditor()
    if (activeNode === 'kinds') return renderKindEditor()
    if (activeNode === 'features') return renderFeaturesEditor()
    if (activeNode === 'relations') return renderRelationsEditor()
    if (activeNode === 'rules') return renderRulesEditor()
    return renderRawJsonEditor()
  }

  return (
    <div className="schema-editor-shell">
      <header className="schema-editor-header">
        <div>
          <strong>Subject Schema Editor</strong>
          <span>{filePath || 'No file'}</span>
        </div>
        <nav>
          <button onClick={newSchema} type="button">New</button>
          <button onClick={() => openSchemaFile('')} type="button">Open</button>
          <button onClick={saveSchema} type="button">Save</button>
          <button onClick={saveSchemaAs} type="button">Save As</button>
          <button disabled={!filePath} onClick={reloadSchema} type="button">Reload</button>
          <button onClick={() => setStatus(validation.ok ? 'Validation OK' : `${validation.issues.length} issue(s) found`)} type="button">Validate</button>
        </nav>
      </header>

      <main className="schema-editor-body">
        <aside className="schema-file-panel">
          <div className="schema-panel-title">Schema Files</div>
          <small title={schemaFolder}>{schemaFolder || '--'}</small>
          <SchemaItemList
            actions={[
              { label: 'Open', onClick: () => openSchemaFile(selectedSchemaFilePath), disabled: !selectedSchemaFilePath },
              { label: 'Copy', onClick: () => copySchemaFile(selectedSchemaFilePath), disabled: !selectedSchemaFilePath },
              {
                label: 'Delete',
                onClick: () => deleteSchemaFile(
                  selectedSchemaFilePath,
                  schemaFiles.find((file) => file.filePath === selectedSchemaFilePath)?.fileName,
                ),
                disabled: !selectedSchemaFilePath,
                danger: true,
              },
            ]}
            emptyText="No schema file."
            getDescription={(file) => file.filePath}
            getLabel={(file) => file.fileName}
            getValue={(file) => file.filePath}
            items={schemaFiles}
            onSelect={setSelectedSchemaFilePath}
            selectedValue={selectedSchemaFilePath}
          />
        </aside>

        <aside className="schema-structure-panel">
          <div className="schema-panel-title">Structure</div>
          {STRUCTURE_NODES.map((node) => (
            <button
              className={node.id === activeNode ? 'selected' : ''}
              key={node.id}
              onClick={() => {
                if (node.id === 'json') setRawJsonDraft(toPrettyJson(schema))
                setActiveNode(node.id)
              }}
              type="button"
            >
              <i className={node.icon} />
              <span>{node.label}</span>
            </button>
          ))}
        </aside>

        <section className="schema-detail-panel">
          <div className="schema-detail-title">
            <div>
              <strong>{schema.label || schema.subjectId || 'Untitled Schema'}</strong>
              <small>{schema.entityKinds.length} kinds / {schema.featureGroups.length} feature groups / {schema.validationRules.length} rules</small>
            </div>
            <span className={validation.ok ? 'schema-valid' : 'schema-invalid'}>
              {validation.ok ? 'Valid' : `${validation.issues.length} Issues`}
            </span>
          </div>
          {renderActiveEditor()}
          <div className="schema-validation-panel">
            {validation.issues.length > 0 ? (
              validation.issues.map((issue) => <div className="issue" key={issue}>{issue}</div>)
            ) : (
              <div className="ok">No validation issue.</div>
            )}
            {validation.warnings.map((warning) => <div className="warning" key={warning}>{warning}</div>)}
          </div>
        </section>
      </main>

      <footer className="schema-editor-statusbar">
        <span>{dirty ? 'Unsaved' : 'Saved'}</span>
        <span>{status}</span>
        <span>{validation.ok ? 'Validation OK' : 'Validation Issues'}</span>
      </footer>
    </div>
  )
}
