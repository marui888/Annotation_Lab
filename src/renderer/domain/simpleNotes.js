import { createId } from '../core/id'

export function parseTimeText(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN
  const text = String(value || '').trim()
  if (!text) return Number.NaN
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text)
  const parts = text.split(':')
  if (parts.length < 2 || parts.length > 3) return Number.NaN
  const secondsText = parts.pop()
  const minutesText = parts.pop()
  const hoursText = parts.pop() || '0'
  const seconds = Number(secondsText)
  const minutes = Number(minutesText)
  const hours = Number(hoursText)
  if (![seconds, minutes, hours].every(Number.isFinite)) return Number.NaN
  return hours * 3600 + minutes * 60 + seconds
}

export function formatSimpleNoteTime(seconds) {
  if (!Number.isFinite(seconds)) return ''
  const safeSeconds = Math.max(0, seconds)
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const secs = Math.floor(safeSeconds % 60)
  const tenths = Math.floor((safeSeconds - Math.floor(safeSeconds)) * 10)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`
}

export function normalizeSimpleNoteRange(range = {}) {
  const startSeconds = parseTimeText(range.start)
  const endSeconds = parseTimeText(range.end)
  if (!Number.isFinite(startSeconds)) return null
  let safeEnd = Number.isFinite(endSeconds) ? endSeconds : startSeconds + 2
  if (safeEnd < startSeconds + 2) safeEnd = startSeconds + 2
  return {
    start: formatSimpleNoteTime(startSeconds),
    end: formatSimpleNoteTime(safeEnd),
  }
}

export function createSimpleNote({
  content = '',
  createdBy = 'User',
  end,
  importFile = '',
  importTime = '',
  start,
} = {}) {
  const range = normalizeSimpleNoteRange({ start, end })
  if (!range) return null
  const now = new Date().toISOString()
  return {
    id: createId('simple_note'),
    start: range.start,
    end: range.end,
    content,
    createdBy,
    importFile,
    importTime,
    createdAt: now,
    updatedAt: now,
  }
}

export function normalizeSimpleNotes(value = []) {
  if (!Array.isArray(value)) return []
  return value.map((note) => {
    const range = normalizeSimpleNoteRange(note)
    const now = new Date().toISOString()
    return {
      id: typeof note.id === 'string' && note.id ? note.id : createId('simple_note'),
      start: range?.start || '',
      end: range?.end || '',
      content: typeof note.content === 'string' ? note.content : '',
      createdBy: note.createdBy || (note.importFile ? 'Import' : 'User'),
      importFile: note.importFile || '',
      importTime: note.importTime || note.importedTime || '',
      createdAt: note.createdAt || now,
      updatedAt: note.updatedAt || note.createdAt || now,
    }
  })
}

export function getSimpleNoteImportKey(note = {}) {
  return [
    note.importFile || '',
    note.start || '',
    note.end || '',
    note.content || '',
  ].join('\u001f')
}

function getField(raw, names = []) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(raw, name)) return raw[name]
  }
  return undefined
}

function getOldSimpleNoteItems(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.notes)) return data.notes
  if (Array.isArray(data?.Notes)) return data.Notes
  if (Array.isArray(data?.items)) return data.items
  if (Array.isArray(data?.Items)) return data.Items
  return []
}

export function importOldSimpleNotes(data, importFile = '') {
  const items = getOldSimpleNoteItems(data)
  const imported = []
  const importTime = new Date().toISOString()
  let skipped = 0

  items.forEach((item) => {
    if (!item || typeof item !== 'object') {
      skipped += 1
      return
    }

    const start = getField(item, ['Start', 'start'])
    const end = getField(item, ['End', 'end'])
    const content = getField(item, ['Content', 'content', 'NoteContent', 'noteContent'])
    const note = createSimpleNote({
      start,
      end,
      content: typeof content === 'string' ? content : String(content ?? ''),
      createdBy: 'Import',
      importFile,
      importTime,
    })

    if (note) {
      imported.push(note)
      return
    }

    skipped += 1
  })

  return {
    imported,
    skipped,
    total: items.length,
  }
}
