import { createId } from '../core/id'

export const C_DOCUMENT_KINDS = [
  { value: 'collection', label: 'Collection' },
  { value: 'lecture', label: 'Lecture' },
  { value: 'review', label: 'Review' },
  { value: 'exercise-set', label: 'Exercise Set' },
]

export const C_DOCUMENT_SUBJECTS = [
  { value: 'mixed', label: 'Mixed' },
  { value: 'math', label: 'Math' },
  { value: 'english', label: 'English' },
]

export function createEmptyCDocument(seed = {}) {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    id: createId('c'),
    title: seed.title || 'Untitled',
    subject: seed.subject || 'mixed',
    kind: seed.kind || 'collection',
    items: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function normalizeCDocument(raw) {
  const base = raw && typeof raw === 'object'
    ? raw
    : createEmptyCDocument()
  const now = new Date().toISOString()
  const items = Array.isArray(base.items)
    ? base.items.map(normalizeCItem).filter(Boolean)
    : []

  return {
    schemaVersion: 1,
    id: typeof base.id === 'string' && base.id ? base.id : createId('c'),
    title: typeof base.title === 'string' && base.title ? base.title : 'Untitled',
    subject: typeof base.subject === 'string' && base.subject ? base.subject : 'mixed',
    kind: typeof base.kind === 'string' && base.kind ? base.kind : 'collection',
    items,
    createdAt: base.createdAt || now,
    updatedAt: base.updatedAt || now,
  }
}

export function normalizeCItem(raw) {
  if (!raw || typeof raw !== 'object') return null
  const now = new Date().toISOString()
  const common = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId('ci'),
    children: Array.isArray(raw.children)
      ? raw.children.map(normalizeCItem).filter(Boolean)
      : [],
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
  }

  if (raw.type === 'b-ref' && raw.ref?.dataFilePath && raw.ref?.entityId) {
    return {
      ...common,
      type: 'b-ref',
      ref: {
        dataFilePath: raw.ref.dataFilePath,
        sourceFilePath: raw.ref.sourceFilePath || '',
        entityId: raw.ref.entityId,
      },
      snapshot: raw.snapshot || null,
    }
  }

  if (raw.type === 'text') {
    return {
      ...common,
      type: 'text',
      text: typeof raw.text === 'string' ? raw.text : '',
    }
  }

  if (raw.type === 'file-ref' && raw.ref?.filePath && raw.fileKind) {
    return {
      ...common,
      type: 'file-ref',
      fileKind: raw.fileKind,
      ref: {
        filePath: raw.ref.filePath,
      },
      display: raw.display || {
        title: raw.ref.filePath,
        mode: 'inline',
      },
    }
  }

  if (raw.type === 'c-ref' && raw.ref?.cFilePath) {
    return {
      ...common,
      type: 'c-ref',
      ref: {
        cFilePath: raw.ref.cFilePath,
        mode: raw.ref.mode || 'live',
      },
      display: raw.display || {
        title: raw.ref.cFilePath,
        mode: 'inline',
      },
    }
  }

  return null
}

export function createBRefItem(indexItem) {
  const now = new Date().toISOString()
  return {
    id: createId('ci'),
    type: 'b-ref',
    ref: {
      dataFilePath: indexItem.dataFilePath,
      sourceFilePath: indexItem.sourceFilePath,
      entityId: indexItem.entityId,
    },
    snapshot: {
      subject: indexItem.subject,
      kind: indexItem.kind,
      label: indexItem.label,
      aObjectCount: indexItem.aObjectCount,
      ruleOk: indexItem.ruleOk ?? (indexItem.issues || []).length === 0,
      issues: indexItem.issues || [],
    },
    createdAt: now,
    updatedAt: now,
  }
}

export function createTextItem(text = '') {
  const now = new Date().toISOString()
  return {
    id: createId('ci'),
    type: 'text',
    text,
    createdAt: now,
    updatedAt: now,
  }
}

export function createFileRefItem(fileResult) {
  const now = new Date().toISOString()
  return {
    id: createId('ci'),
    type: 'file-ref',
    fileKind: fileResult.fileKind,
    ref: {
      filePath: fileResult.filePath,
    },
    display: {
      title: fileResult.fileName,
      mode: 'inline',
    },
    createdAt: now,
    updatedAt: now,
  }
}

export function createCRefItem(fileResult, mode = 'live') {
  const now = new Date().toISOString()
  return {
    id: createId('ci'),
    type: 'c-ref',
    ref: {
      cFilePath: fileResult.filePath,
      mode,
    },
    display: {
      title: fileResult.fileName,
      mode: 'inline',
    },
    createdAt: now,
    updatedAt: now,
  }
}

export function cloneCItemForInsert(item) {
  const normalized = normalizeCItem(item)
  const now = new Date().toISOString()
  if (!normalized) return null

  return {
    ...normalized,
    id: createId('ci'),
    children: (normalized.children || []).map(cloneCItemForInsert).filter(Boolean),
    createdAt: now,
    updatedAt: now,
  }
}

export function cloneCItemsForInsert(items = []) {
  return items.map(cloneCItemForInsert).filter(Boolean)
}
