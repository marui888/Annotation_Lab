import { useEffect, useMemo, useState } from 'react'
import {
  applyReferenceMappingToAnnotation,
  applyReferenceMappingToItems,
  createSameNamePath,
  getReferenceTypeLabel,
} from './cReferenceUtils'
import {
  buildValidatedRepairRows,
  createPrefixReplaceGetter,
  createReferenceMapping,
  scanBrokenReferences,
} from './cReferenceRepairService'
import './CReferenceRepairDialog.css'

const TYPE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'b-ref', label: 'B Entity' },
  { value: 'source-ref', label: 'Source File' },
  { value: 'image-ref', label: 'Image' },
  { value: 'text-ref', label: 'Text File' },
  { value: 'c-ref', label: 'Composite' },
]

function getCommonPrefix(paths) {
  if (!paths.length) return ''
  const normalizedParts = paths.map((path) => String(path || '').split(/[\\/]+/).filter(Boolean))
  const minLength = Math.min(...normalizedParts.map((parts) => parts.length))
  const prefixParts = []
  for (let index = 0; index < minLength - 1; index += 1) {
    const value = normalizedParts[0][index]
    if (!normalizedParts.every((parts) => parts[index]?.toLowerCase() === value.toLowerCase())) break
    prefixParts.push(value)
  }
  if (!prefixParts.length) return ''
  const firstPath = paths[0]
  const driveMatch = String(firstPath).match(/^[A-Za-z]:[\\/]/)
  const separator = String(firstPath).includes('\\') ? '\\' : '/'
  return driveMatch
    ? `${prefixParts.join(separator)}${separator}`
    : prefixParts.join(separator)
}

function filterReferences(references, typeFilter) {
  if (typeFilter === 'all') return references
  return references.filter((reference) => reference.type === typeFilter)
}

export default function CReferenceRepairDialog({
  cDocument,
  cDocumentFilePath = '',
  cSaveStatus = '',
  onClose,
}) {
  const [brokenReferences, setBrokenReferences] = useState([])
  const [includeReferencedFiles, setIncludeReferencedFiles] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [oldPrefix, setOldPrefix] = useState('')
  const [newPrefix, setNewPrefix] = useState('')
  const [repairRows, setRepairRows] = useState([])
  const [referencedDocuments, setReferencedDocuments] = useState([])
  const [isSaving, setIsSaving] = useState(false)
  const [scanReason, setScanReason] = useState('')
  const [saveReason, setSaveReason] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')

  useEffect(() => {
    let canceled = false
    async function runScan() {
      setIsLoading(true)
      const result = await scanBrokenReferences(cDocument, {
        currentDocumentPath: cDocumentFilePath,
        includeReferencedFiles,
      })
      if (canceled) return
      setBrokenReferences(result.brokenReferences || [])
      setReferencedDocuments(result.referencedDocuments || [])
      setScanReason(result.reason || '')
      setSaveReason('')
      setSaveMessage('')
      setOldPrefix(getCommonPrefix((result.brokenReferences || []).map((item) => item.path)))
      setRepairRows([])
      setIsLoading(false)
    }
    runScan()
    return () => {
      canceled = true
    }
  }, [cDocument, cDocumentFilePath, includeReferencedFiles])

  const activeBrokenReferences = useMemo(
    () => filterReferences(brokenReferences, typeFilter),
    [brokenReferences, typeFilter],
  )

  const previewPrefixRepair = async () => {
    const rows = await buildValidatedRepairRows(
      activeBrokenReferences,
      createPrefixReplaceGetter(oldPrefix, newPrefix),
    )
    setRepairRows(rows)
  }

  const chooseNewPrefix = async () => {
    const result = await window.labApi?.selectFolder?.('Choose new reference folder')
    if (!result?.ok) return
    setNewPrefix(result.folderPath)
  }

  const chooseSingleFile = async (reference) => {
    const result = await window.labApi?.selectFileForReference?.({
      fileKind: reference.type,
      title: `Repair ${getReferenceTypeLabel(reference.type)}`,
    })
    if (!result?.ok) return
    const rows = await buildValidatedRepairRows(
      brokenReferences,
      (item) => (item.id === reference.id ? result.filePath : repairRows.find((row) => row.id === item.id)?.nextPath || '')
    )
    setRepairRows(rows)
  }

  const suggestSameName = async (reference) => {
    const result = await window.labApi?.selectFolder?.('Choose folder for same-name repair')
    if (!result?.ok) return
    const nextPath = createSameNamePath(result.folderPath, reference.path)
    const rows = await buildValidatedRepairRows(
      brokenReferences,
      (item) => (item.id === reference.id ? nextPath : repairRows.find((row) => row.id === item.id)?.nextPath || '')
    )
    setRepairRows(rows)
  }

  const saveRepair = async () => {
    if (!cDocumentFilePath) {
      setSaveReason('Current Composite document has no file path.')
      return
    }
    const mapping = createReferenceMapping(repairRows)
    setIsSaving(true)
    setSaveReason('')
    setSaveMessage('')

    const nextItems = applyReferenceMappingToItems(cDocument.items || [], mapping)
    const currentResult = await window.labApi?.saveCDocument?.({
      filePath: cDocumentFilePath,
      data: {
        ...cDocument,
        items: nextItems,
        updatedAt: new Date().toISOString(),
      },
    })
    if (!currentResult?.ok) {
      setSaveReason(`Save current Composite failed: ${currentResult?.reason || 'unknown error'}`)
      setIsSaving(false)
      return
    }

    const externalUpdates = referencedDocuments
      .map((entry) => ({
        ...entry,
        nextItems: applyReferenceMappingToItems(entry.cDocument.items || [], mapping),
      }))
      .filter((entry) => JSON.stringify(entry.nextItems) !== JSON.stringify(entry.cDocument.items || []))

    for (const entry of externalUpdates) {
      const result = await window.labApi?.saveCDocument?.({
        filePath: entry.filePath,
        data: {
          ...entry.cDocument,
          items: entry.nextItems,
          updatedAt: new Date().toISOString(),
        },
      })
      if (!result?.ok) {
        setSaveReason(`Save referenced file failed: ${entry.filePath} / ${result?.reason || 'unknown error'}`)
        setIsSaving(false)
        return
      }
    }

    const annotationPaths = Array.from(new Set(
      repairRows
        .filter((row) => row.changed && row.type === 'annotation-source' && row.annotationFilePath)
        .map((row) => row.annotationFilePath)
    ))
    for (const annotationFilePath of annotationPaths) {
      const readResult = await window.labApi?.readAnnotationFileRaw?.(annotationFilePath)
      if (!readResult?.ok) {
        setSaveReason(`Read annotation failed: ${annotationFilePath} / ${readResult?.reason || 'unknown error'}`)
        setIsSaving(false)
        return
      }
      const nextAnnotation = applyReferenceMappingToAnnotation(readResult.data, mapping)
      const saveResult = await window.labApi?.saveAnnotationFileRaw?.({
        annotationFilePath,
        data: nextAnnotation,
      })
      if (!saveResult?.ok) {
        setSaveReason(`Save annotation failed: ${annotationFilePath} / ${saveResult?.reason || 'unknown error'}`)
        setIsSaving(false)
        return
      }
    }

    setSaveMessage('References saved. Use Reload to refresh current Composite.')
    setIsSaving(false)
  }

  const affectedCount = repairRows.filter((row) => row.changed).length
  const referencedAffectedCount = repairRows.filter((row) => row.changed && row.documentPath).length

  return (
    <div className="dialog-layer">
      <div className="reference-repair-dialog">
        <header>
          <div>
            <strong>Repair References</strong>
            <small>Fix missing paths in current Composite document.</small>
          </div>
          <button onClick={onClose} type="button">Close</button>
        </header>

        <section className="repair-summary">
          <span>Broken: {brokenReferences.length}</span>
          <span>Shown: {activeBrokenReferences.length}</span>
          <span>Affected: {affectedCount}</span>
          <span>Referenced files: {referencedDocuments.length}</span>
          {referencedAffectedCount ? <span className="repair-warning">External affected: {referencedAffectedCount}</span> : null}
          {cSaveStatus === 'Unsaved' ? <span className="repair-warning">Current editor has unsaved changes; Save writes them with repaired references.</span> : null}
          {scanReason ? <span className="repair-error">{scanReason}</span> : null}
          {saveReason ? <span className="repair-error">{saveReason}</span> : null}
          {saveMessage ? <span className="repair-ok">{saveMessage}</span> : null}
        </section>

        <section className="repair-prefix">
          <label>
            Type
            <select onChange={(event) => setTypeFilter(event.target.value)} value={typeFilter}>
              {TYPE_FILTERS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label>
            Old Prefix
            <input onChange={(event) => setOldPrefix(event.target.value)} value={oldPrefix} />
          </label>
          <label>
            New Prefix
            <span>
              <input onChange={(event) => setNewPrefix(event.target.value)} value={newPrefix} />
              <button onClick={chooseNewPrefix} type="button">Choose...</button>
            </span>
          </label>
          <button disabled={!oldPrefix || !newPrefix || activeBrokenReferences.length === 0} onClick={previewPrefixRepair} type="button">
            Preview results
          </button>
        </section>

        <section className="repair-options">
          <label data-tooltip="Repair paths inside referenced composite files.">
            <input
              checked={includeReferencedFiles}
              onChange={(event) => setIncludeReferencedFiles(event.target.checked)}
              type="checkbox"
            />
            Include referenced files
          </label>
          <span>Currently supports referenced .composite.json files.</span>
        </section>

        <section className="repair-list">
          <div className="repair-list-head">
            <span>Document</span>
            <span>Type</span>
            <span>Old Path</span>
            <span>New Path</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          {isLoading ? (
            <div className="repair-empty">Scanning references...</div>
          ) : activeBrokenReferences.length === 0 ? (
            <div className="repair-empty">No broken references.</div>
          ) : activeBrokenReferences.map((reference) => {
            const row = repairRows.find((item) => item.id === reference.id)
            return (
              <div className="repair-row" key={reference.id}>
                <span title={reference.documentPath || 'Current document'}>{reference.documentPath ? 'Referenced' : 'Current'}</span>
                <span>{reference.typeLabel}</span>
                <span title={reference.path}>{reference.path}</span>
                <input
                  onChange={async (event) => {
                    const nextPath = event.target.value
                    const rows = await buildValidatedRepairRows(
                      brokenReferences,
                      (item) => (item.id === reference.id ? nextPath : repairRows.find((candidate) => candidate.id === item.id)?.nextPath || '')
                    )
                    setRepairRows(rows)
                  }}
                  title={row?.nextPath || ''}
                  value={row?.nextPath || ''}
                />
                <span className={row?.status === 'exists' ? 'repair-ok' : 'repair-missing'}>
                  {row?.status || 'missing'}
                </span>
                <span className="repair-row-actions">
                  <button onClick={() => chooseSingleFile(reference)} type="button">File...</button>
                  <button onClick={() => suggestSameName(reference)} type="button">Same Name...</button>
                </span>
              </div>
            )
          })}
        </section>

        <footer>
          <small>
            Save writes repaired references to files. Use Reload to refresh the current Composite.
          </small>
          <button disabled={affectedCount === 0 || isSaving} onClick={saveRepair} type="button">
            {isSaving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={onClose} type="button">Cancel</button>
        </footer>
      </div>
    </div>
  )
}
