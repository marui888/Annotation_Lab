export const TEXT_PREVIEW_LIMIT = 5000

export function getCItemSummary(item) {
  if (!item) return '--'
  if (item.type === 'b-ref') return item.snapshot?.label || item.ref.entityId
  if (item.type === 'text') return item.text || 'Text'
  if (item.type === 'file-ref') return `${item.fileKind}: ${item.display?.title || item.ref.filePath}`
  if (item.type === 'c-ref') return `C ${item.ref.mode || 'live'}: ${item.display?.title || item.ref.cFilePath}`
  return item.id
}

export function getCItemTypeLabel(item) {
  if (!item) return '--'
  if (item.type === 'b-ref') return 'Entity'
  if (item.type === 'c-ref') return 'Composite'
  if (item.type === 'file-ref') return item.fileKind === 'image' ? 'Image' : 'File'
  if (item.type === 'text') return 'Text'
  return item.type || '--'
}

export function getTextPreviewInfo(text = '') {
  const safeText = String(text || '')
  return {
    charCount: safeText.length,
    lineCount: safeText ? safeText.split(/\r\n|\r|\n/).length : 0,
    text: safeText.length > TEXT_PREVIEW_LIMIT
      ? safeText.slice(0, TEXT_PREVIEW_LIMIT)
      : safeText,
    truncated: safeText.length > TEXT_PREVIEW_LIMIT,
  }
}
