import { useEffect, useMemo, useState } from 'react'
import './SubjectSchemaEditor.css'
import { createEmptySubjectSchema, validateSubjectSchema } from './subjectSchemaValidator'

const STRUCTURE_NODES = [
  { id: 'basic', label: 'Basic', icon: 'fa-solid fa-circle-info' },
  { id: 'kinds', label: 'Entity Kinds', icon: 'fa-solid fa-shapes' },
  { id: 'roles', label: 'Roles By Kind', icon: 'fa-solid fa-diagram-project' },
  { id: 'features', label: 'Feature Groups', icon: 'fa-solid fa-tags' },
  { id: 'relations', label: 'Relation Types', icon: 'fa-solid fa-link' },
  { id: 'rules', label: 'Validation Rules', icon: 'fa-solid fa-list-check' },
  { id: 'json', label: 'Raw JSON', icon: 'fa-solid fa-code' },
]

const toPrettyJson = (value) => JSON.stringify(value, null, 2)

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

function TextField({ label, onChange, value }) {
  return (
    <label className="schema-field">
      <span>{label}</span>
      <input onChange={(event) => onChange(event.target.value)} value={value || ''} />
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

export default function SubjectSchemaEditor() {
  const [schemaFiles, setSchemaFiles] = useState([])
  const [schemaFolder, setSchemaFolder] = useState('')
  const [schema, setSchema] = useState(() => createEmptySubjectSchema())
  const [filePath, setFilePath] = useState('')
  const [activeNode, setActiveNode] = useState('basic')
  const [selectedKind, setSelectedKind] = useState('')
  const [selectedFeatureGroup, setSelectedFeatureGroup] = useState('')
  const [selectedRule, setSelectedRule] = useState('')
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState('Ready')
  const [rawJsonDraft, setRawJsonDraft] = useState('')

  const validation = useMemo(() => validateSubjectSchema(schema), [schema])
  const selectedKindData = schema.entityKinds.find((kind) => kind.value === selectedKind) || schema.entityKinds[0] || null
  const selectedKindValue = selectedKindData?.value || ''
  const selectedFeatureGroupData = schema.featureGroups.find((group) => group.key === selectedFeatureGroup) || schema.featureGroups[0] || null
  const selectedFeatureGroupKey = selectedFeatureGroupData?.key || ''
  const selectedRuleData = schema.validationRules.find((rule) => rule.id === selectedRule) || schema.validationRules[0] || null
  const selectedRuleId = selectedRuleData?.id || ''

  const markSchemaChanged = (updater) => {
    setSchema((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater
      return next
    })
    setDirty(true)
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
    const result = filePath
      ? await window.labApi?.saveSubjectSchema?.({ filePath, data: schema })
      : await window.labApi?.saveSubjectSchemaAs?.({ data: schema, suggestedName: schema.subjectId })
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
    const result = await window.labApi?.saveSubjectSchemaAs?.({ data: schema, suggestedName: schema.subjectId })
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

  const addKind = () => {
    const value = `kind_${schema.entityKinds.length + 1}`
    markSchemaChanged((current) => ({
      ...current,
      entityKinds: [...current.entityKinds, { value, label: 'New Kind', description: '' }],
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
      delete nextRolesByKind[kindValue]
      return {
        ...current,
        entityKinds: current.entityKinds.filter((kind) => kind.value !== kindValue),
        rolesByKind: nextRolesByKind,
      }
    })
    setSelectedKind('')
  }

  const updateKind = (index, patch) => {
    markSchemaChanged((current) => {
      const oldKind = current.entityKinds[index]
      const nextKinds = updateArrayItem(current.entityKinds, index, patch)
      const nextRolesByKind = { ...current.rolesByKind }
      if (patch.value && oldKind?.value && patch.value !== oldKind.value) {
        nextRolesByKind[patch.value] = nextRolesByKind[oldKind.value] || []
        delete nextRolesByKind[oldKind.value]
        setSelectedKind(patch.value)
      }
      return {
        ...current,
        entityKinds: nextKinds,
        rolesByKind: nextRolesByKind,
      }
    })
  }

  const addRole = () => {
    if (!selectedKindValue) return
    const value = `role_${(schema.rolesByKind[selectedKindValue] || []).length + 1}`
    markSchemaChanged((current) => ({
      ...current,
      rolesByKind: {
        ...current.rolesByKind,
        [selectedKindValue]: [
          ...(current.rolesByKind[selectedKindValue] || []),
          { value, label: 'New Role', required: false },
        ],
      },
    }))
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
    markSchemaChanged((current) => ({
      ...current,
      rolesByKind: {
        ...current.rolesByKind,
        [selectedKindValue]: (current.rolesByKind[selectedKindValue] || []).filter((_role, roleIndex) => roleIndex !== index),
      },
    }))
  }

  const addFeatureGroup = () => {
    const key = `featureGroup_${schema.featureGroups.length + 1}`
    markSchemaChanged((current) => ({
      ...current,
      featureGroups: [...current.featureGroups, { key, label: 'New Feature Group', multi: true, values: [] }],
    }))
    setSelectedFeatureGroup(key)
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
    markSchemaChanged((current) => ({
      ...current,
      featureGroups: current.featureGroups.map((group, index) => (
        index === groupIndex
          ? { ...group, values: [...(group.values || []), { value, label: 'New Value' }] }
          : group
      )),
    }))
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
    markSchemaChanged((current) => ({
      ...current,
      featureGroups: current.featureGroups.map((group, index) => (
        index === groupIndex
          ? { ...group, values: (group.values || []).filter((_value, indexValue) => indexValue !== valueIndex) }
          : group
      )),
    }))
  }

  const addRelationType = () => {
    markSchemaChanged((current) => ({
      ...current,
      relationTypes: [
        ...(current.relationTypes || []),
        { value: `relation_${(current.relationTypes || []).length + 1}`, label: 'New Relation' },
      ],
    }))
  }

  const updateRelationType = (index, patch) => {
    markSchemaChanged((current) => ({
      ...current,
      relationTypes: updateArrayItem(current.relationTypes || [], index, patch),
    }))
  }

  const deleteRelationType = (index) => {
    if (!window.confirm('Delete this relation type?')) return
    markSchemaChanged((current) => ({
      ...current,
      relationTypes: (current.relationTypes || []).filter((_item, itemIndex) => itemIndex !== index),
    }))
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

  const renderKindEditor = () => (
    <div className="schema-split-editor">
      <div className="schema-list-editor">
        <div className="schema-editor-toolbar">
          <button onClick={addKind} type="button">Add Kind</button>
        </div>
        {schema.entityKinds.map((kind, index) => (
          <button
            className={kind.value === selectedKindValue ? 'selected' : ''}
            key={`${kind.value}-${index}`}
            onClick={() => setSelectedKind(kind.value)}
            type="button"
          >
            <strong>{kind.label || kind.value}</strong>
            <small>{kind.value}</small>
          </button>
        ))}
      </div>
      <div className="schema-form">
        {selectedKindData ? (
          <>
            <TextField label="value" onChange={(value) => updateKind(schema.entityKinds.indexOf(selectedKindData), { value })} value={selectedKindData.value} />
            <TextField label="label" onChange={(value) => updateKind(schema.entityKinds.indexOf(selectedKindData), { label: value })} value={selectedKindData.label} />
            <TextAreaField label="description" onChange={(value) => updateKind(schema.entityKinds.indexOf(selectedKindData), { description: value })} value={selectedKindData.description} />
            <div className="schema-editor-toolbar">
              <button onClick={() => markSchemaChanged((current) => ({ ...current, entityKinds: moveArrayItem(current.entityKinds, schema.entityKinds.indexOf(selectedKindData), -1) }))} type="button">Up</button>
              <button onClick={() => markSchemaChanged((current) => ({ ...current, entityKinds: moveArrayItem(current.entityKinds, schema.entityKinds.indexOf(selectedKindData), 1) }))} type="button">Down</button>
              <button className="danger" onClick={() => deleteKind(selectedKindData.value)} type="button">Delete</button>
            </div>
          </>
        ) : <div className="schema-empty-state">No kind selected.</div>}
      </div>
    </div>
  )

  const renderRolesEditor = () => {
    const roles = schema.rolesByKind[selectedKindValue] || []
    return (
      <div className="schema-split-editor">
        <div className="schema-list-editor">
          {schema.entityKinds.map((kind) => (
            <button
              className={kind.value === selectedKindValue ? 'selected' : ''}
              key={kind.value}
              onClick={() => setSelectedKind(kind.value)}
              type="button"
            >
              <strong>{kind.label || kind.value}</strong>
              <small>{(schema.rolesByKind[kind.value] || []).length} roles</small>
            </button>
          ))}
        </div>
        <div className="schema-table-editor">
          <div className="schema-editor-toolbar">
            <strong>{selectedKindData?.label || selectedKindValue || 'No Kind'}</strong>
            <button disabled={!selectedKindValue} onClick={addRole} type="button">Add Role</button>
          </div>
          {roles.map((role, index) => (
            <div className="schema-table-row" key={`${role.value}-${index}`}>
              <input onChange={(event) => updateRole(index, { value: event.target.value })} value={role.value || ''} />
              <input onChange={(event) => updateRole(index, { label: event.target.value })} value={role.label || ''} />
              <label className="schema-check">
                <input checked={Boolean(role.required)} onChange={(event) => updateRole(index, { required: event.target.checked })} type="checkbox" />
                Required
              </label>
              <button onClick={() => updateRole(index, roles[index - 1] ? roles[index - 1] : role)} type="button">Copy Prev</button>
              <button className="danger" onClick={() => deleteRole(index)} type="button">Delete</button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const renderFeaturesEditor = () => (
    <div className="schema-split-editor">
      <div className="schema-list-editor">
        <div className="schema-editor-toolbar">
          <button onClick={addFeatureGroup} type="button">Add Group</button>
        </div>
        {schema.featureGroups.map((group, index) => (
          <button
            className={group.key === selectedFeatureGroupKey ? 'selected' : ''}
            key={`${group.key}-${index}`}
            onClick={() => setSelectedFeatureGroup(group.key)}
            type="button"
          >
            <strong>{group.label || group.key}</strong>
            <small>{(group.values || []).length} values</small>
          </button>
        ))}
      </div>
      <div className="schema-table-editor">
        {selectedFeatureGroupData ? (
          <>
            <div className="schema-form compact">
              <TextField label="key" onChange={(value) => updateFeatureGroup(schema.featureGroups.indexOf(selectedFeatureGroupData), { key: value })} value={selectedFeatureGroupData.key} />
              <TextField label="label" onChange={(value) => updateFeatureGroup(schema.featureGroups.indexOf(selectedFeatureGroupData), { label: value })} value={selectedFeatureGroupData.label} />
              <label className="schema-check">
                <input checked={Boolean(selectedFeatureGroupData.multi)} onChange={(event) => updateFeatureGroup(schema.featureGroups.indexOf(selectedFeatureGroupData), { multi: event.target.checked })} type="checkbox" />
                Multi
              </label>
            </div>
            <div className="schema-editor-toolbar">
              <button onClick={addFeatureValue} type="button">Add Value</button>
              <button className="danger" onClick={() => deleteFeatureGroup(schema.featureGroups.indexOf(selectedFeatureGroupData))} type="button">Delete Group</button>
            </div>
            {(selectedFeatureGroupData.values || []).map((value, index) => (
              <div className="schema-table-row" key={`${value.value}-${index}`}>
                <input onChange={(event) => updateFeatureValue(index, { value: event.target.value })} value={value.value || ''} />
                <input onChange={(event) => updateFeatureValue(index, { label: event.target.value })} value={value.label || ''} />
                <button className="danger" onClick={() => deleteFeatureValue(index)} type="button">Delete</button>
              </div>
            ))}
          </>
        ) : <div className="schema-empty-state">No feature group selected.</div>}
      </div>
    </div>
  )

  const renderRelationsEditor = () => (
    <div className="schema-table-editor single">
      <div className="schema-editor-toolbar">
        <button onClick={addRelationType} type="button">Add Relation</button>
      </div>
      {(schema.relationTypes || []).map((relation, index) => (
        <div className="schema-table-row" key={`${relation.value}-${index}`}>
          <input onChange={(event) => updateRelationType(index, { value: event.target.value })} value={relation.value || ''} />
          <input onChange={(event) => updateRelationType(index, { label: event.target.value })} value={relation.label || ''} />
          <button className="danger" onClick={() => deleteRelationType(index)} type="button">Delete</button>
        </div>
      ))}
    </div>
  )

  const renderRulesEditor = () => (
    <div className="schema-split-editor">
      <div className="schema-list-editor">
        <div className="schema-editor-toolbar">
          <button onClick={addRule} type="button">Add Rule</button>
        </div>
        {schema.validationRules.map((rule, index) => (
          <button
            className={rule.id === selectedRuleId ? 'selected' : ''}
            key={`${rule.id}-${index}`}
            onClick={() => setSelectedRule(rule.id)}
            type="button"
          >
            <strong>{rule.id || `Rule ${index + 1}`}</strong>
            <small>{rule.type} / {rule.level}</small>
          </button>
        ))}
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
            <button className="danger" onClick={() => deleteRule(schema.validationRules.indexOf(selectedRuleData))} type="button">Delete Rule</button>
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
    if (activeNode === 'roles') return renderRolesEditor()
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
          <div className="schema-file-list">
            {schemaFiles.length === 0 ? (
              <div className="schema-empty-state">No schema file.</div>
            ) : schemaFiles.map((file) => (
              <button
                className={file.filePath === filePath ? 'selected' : ''}
                key={file.filePath}
                onClick={() => openSchemaFile(file.filePath)}
                title={file.filePath}
                type="button"
              >
                {file.fileName}
              </button>
            ))}
          </div>
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
