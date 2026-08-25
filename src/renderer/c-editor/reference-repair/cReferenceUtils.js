function getFileName(filePath = '') {
  const normalized = String(filePath || '').replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).pop() || filePath || ''
}

function normalizeSlashes(filePath = '') {
  return String(filePath || '').replace(/\\/g, '/')
}

function joinPath(folderPath, fileName) {
  const separator = String(folderPath || '').includes('\\') ? '\\' : '/'
  return `${String(folderPath || '').replace(/[\\/]+$/, '')}${separator}${fileName}`
}

export function getReferenceTypeLabel(type) {
  if (type === 'b-ref') return 'B Entity'
  if (type === 'source-ref') return 'Source File'
  if (type === 'annotation-source') return 'Annotation Source'
  if (type === 'image-ref') return 'Image'
  if (type === 'text-ref') return 'Text File'
  if (type === 'c-ref') return 'Composite'
  return type || '--'
}

export function getReferenceDescriptors(item) {
  if (!item) return []
  if (item.type === 'b-ref') {
    return [
      item.ref?.dataFilePath
        ? {
            field: 'dataFilePath',
            path: item.ref.dataFilePath,
            type: 'b-ref',
            typeLabel: getReferenceTypeLabel('b-ref'),
          }
        : null,
      item.ref?.sourceFilePath
        ? {
            field: 'sourceFilePath',
            path: item.ref.sourceFilePath,
            type: 'source-ref',
            typeLabel: getReferenceTypeLabel('source-ref'),
          }
        : null,
    ].filter(Boolean)
  }
  if (item.type === 'file-ref' && item.ref?.filePath) {
    const type = item.fileKind === 'image' ? 'image-ref' : 'text-ref'
    return [{
      field: 'filePath',
      path: item.ref.filePath,
      type,
      typeLabel: getReferenceTypeLabel(type),
    }]
  }
  if (item.type === 'c-ref' && item.ref?.cFilePath) {
    return [{
      field: 'cFilePath',
      path: item.ref.cFilePath,
      type: 'c-ref',
      typeLabel: getReferenceTypeLabel('c-ref'),
    }]
  }
  return []
}

export function setReferencePath(item, field, nextPath) {
  if (!item) return item
  const now = new Date().toISOString()
  if (item.type === 'b-ref' && (field === 'dataFilePath' || field === 'sourceFilePath')) {
    return {
      ...item,
      ref: {
        ...item.ref,
        [field]: nextPath,
      },
      updatedAt: now,
    }
  }
  if (item.type === 'file-ref' && field === 'filePath') {
    return {
      ...item,
      ref: {
        ...item.ref,
        filePath: nextPath,
      },
      display: {
        ...item.display,
        title: item.display?.title || getFileName(nextPath),
      },
      updatedAt: now,
    }
  }
  if (item.type === 'c-ref' && field === 'cFilePath') {
    return {
      ...item,
      ref: {
        ...item.ref,
        cFilePath: nextPath,
      },
      display: {
        ...item.display,
        title: item.display?.title || getFileName(nextPath),
      },
      updatedAt: now,
    }
  }
  return item
}

export function collectCReferences(cDocument, options = {}) {
  const refs = []
  const documentPath = options.documentPath || ''

  function visit(items = [], parentIds = []) {
    items.forEach((item, index) => {
      getReferenceDescriptors(item).forEach((descriptor) => {
        refs.push({
          id: `${documentPath || 'current'}:${item.id}:${descriptor.field}`,
          documentPath,
          field: descriptor.field,
          fileName: getFileName(descriptor.path),
          index,
          itemId: item.id,
          parentIds,
          path: descriptor.path,
          type: descriptor.type,
          typeLabel: descriptor.typeLabel,
        })
      })
      if (Array.isArray(item.children) && item.children.length > 0) {
        visit(item.children, [...parentIds, item.id])
      }
    })
  }

  visit(cDocument?.items || [])
  return refs
}

export function applyReferenceMappingToItems(items = [], mapping = {}) {
  return items.map((item) => {
    let nextItem = item
    getReferenceDescriptors(item).forEach((descriptor) => {
      const mappedPath = mapping[descriptor.path]
      if (mappedPath) {
        nextItem = setReferencePath(nextItem, descriptor.field, mappedPath)
      }
    })
    return {
      ...nextItem,
      children: applyReferenceMappingToItems(nextItem.children || [], mapping),
    }
  })
}

export function applyReferenceMappingToAnnotation(annotationData, mapping = {}) {
  const sources = Array.isArray(annotationData?.sources)
    ? annotationData.sources
    : []
  return {
    ...annotationData,
    sources: sources.map((source) => ({
      ...source,
      filePath: mapping[source.filePath] || source.filePath,
    })),
  }
}

export function createPrefixPath(oldPath, oldPrefix, newPrefix) {
  const safeOldPath = String(oldPath || '')
  const safeOldPrefix = String(oldPrefix || '').replace(/[\\/]+$/, '')
  const safeNewPrefix = String(newPrefix || '').replace(/[\\/]+$/, '')
  if (!safeOldPath || !safeOldPrefix || !safeNewPrefix) return ''

  const normalizedPath = normalizeSlashes(safeOldPath).toLowerCase()
  const normalizedPrefix = normalizeSlashes(safeOldPrefix).toLowerCase()
  if (normalizedPath !== normalizedPrefix && !normalizedPath.startsWith(`${normalizedPrefix}/`)) return ''

  const rest = safeOldPath.slice(safeOldPrefix.length).replace(/^[\\/]+/, '')
  return rest ? joinPath(safeNewPrefix, rest) : safeNewPrefix
}

export function createSameNamePath(folderPath, oldPath) {
  const fileName = getFileName(oldPath)
  if (!folderPath || !fileName) return ''
  return joinPath(folderPath, fileName)
}
