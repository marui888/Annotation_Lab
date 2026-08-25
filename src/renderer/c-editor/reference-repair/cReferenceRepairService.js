import {
  collectCReferences,
  createPrefixPath,
  createSameNamePath,
} from './cReferenceUtils'

async function collectAnnotationSourceReferences(references) {
  const annotationPaths = Array.from(new Set(
    references
      .filter((reference) => reference.type === 'b-ref' && reference.path)
      .map((reference) => reference.path)
  ))
  const entries = []

  for (const annotationFilePath of annotationPaths) {
    const result = await window.labApi?.readAnnotationFileRaw?.(annotationFilePath)
    if (!result?.ok || !Array.isArray(result.data?.sources)) continue
    result.data.sources.forEach((source, index) => {
      if (!source?.filePath) return
      entries.push({
        id: `${annotationFilePath}:sources:${index}:filePath`,
        annotationFilePath,
        documentPath: annotationFilePath,
        field: `sources[${index}].filePath`,
        fileName: source.filePath.split(/[\\/]/).filter(Boolean).pop() || source.filePath,
        index,
        itemId: `sources[${index}]`,
        parentIds: [],
        path: source.filePath,
        type: 'annotation-source',
        typeLabel: 'Annotation Source',
      })
    })
  }

  return entries
}

async function collectReferencedCompositeDocuments(cDocument, options = {}) {
  const visited = new Set(options.visited || [])
  const result = []

  async function visit(document) {
    const cRefs = collectCReferences(document)
      .filter((reference) => reference.type === 'c-ref' && reference.path && !visited.has(reference.path))

    for (const reference of cRefs) {
      visited.add(reference.path)
      const loadResult = await window.labApi?.readCDocumentFile?.(reference.path)
      if (!loadResult?.ok || !loadResult.data) continue
      const entry = {
        cDocument: loadResult.data,
        filePath: loadResult.filePath || reference.path,
      }
      result.push(entry)
      await visit(loadResult.data)
    }
  }

  await visit(cDocument)
  return result
}

export async function scanBrokenReferences(cDocument, options = {}) {
  const referencedDocuments = options.includeReferencedFiles
    ? await collectReferencedCompositeDocuments(cDocument, {
        visited: options.currentDocumentPath ? [options.currentDocumentPath] : [],
      })
    : []
  const references = [
    ...collectCReferences(cDocument),
    ...referencedDocuments.flatMap((entry) => collectCReferences(entry.cDocument, {
      documentPath: entry.filePath,
    })),
  ]
  const annotationReferences = options.includeReferencedFiles
    ? await collectAnnotationSourceReferences(references)
    : []
  const allReferences = [...references, ...annotationReferences]
  const result = await window.labApi?.existsMany?.(allReferences.map((item) => item.path))
  const existsByPath = result?.ok ? result.existsByPath || {} : {}
  const withStatus = allReferences.map((reference) => ({
    ...reference,
    exists: Boolean(existsByPath[reference.path]),
  }))
  return {
    ok: Boolean(result?.ok),
    references: withStatus,
    brokenReferences: withStatus.filter((reference) => !reference.exists),
    reason: result?.reason || '',
    referencedDocuments,
  }
}

export async function buildValidatedRepairRows(references, getNextPath) {
  const rows = references.map((reference) => {
    const nextPath = getNextPath(reference)
    return {
      ...reference,
      nextPath,
      changed: Boolean(nextPath && nextPath !== reference.path),
    }
  })
  const pathsToCheck = rows.filter((row) => row.changed).map((row) => row.nextPath)
  const result = await window.labApi?.existsMany?.(pathsToCheck)
  const existsByPath = result?.ok ? result.existsByPath || {} : {}
  return rows.map((row) => ({
    ...row,
    nextExists: row.changed ? Boolean(existsByPath[row.nextPath]) : row.exists,
    status: !row.changed
      ? 'unchanged'
      : existsByPath[row.nextPath]
        ? 'exists'
        : 'missing',
  }))
}

export function createPrefixReplaceGetter(oldPrefix, newPrefix) {
  return (reference) => createPrefixPath(reference.path, oldPrefix, newPrefix)
}

export function createSameNameReplaceGetter(folderPath) {
  return (reference) => createSameNamePath(folderPath, reference.path)
}

export function createReferenceMapping(repairRows) {
  return Object.fromEntries(
    repairRows
      .filter((row) => row.changed && row.nextPath)
      .map((row) => [row.path, row.nextPath])
  )
}
