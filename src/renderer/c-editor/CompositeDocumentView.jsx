import { useMemo, useState } from 'react'
import CompositeListPreview from './CompositeListPreview'
import { getCItemSummary, getCItemTypeLabel } from './cEditorUtils'

const FILTER_TYPES = [
  { value: 'all', label: 'All' },
  { value: 'b-ref', label: 'B Entity' },
  { value: 'text', label: 'Text' },
  { value: 'file-ref:image', label: 'Image File' },
  { value: 'file-ref:text', label: 'Text File' },
  { value: 'c-ref', label: 'Composite Ref' },
]

function getCItemFilterType(item) {
  if (item.type === 'file-ref') return `${item.type}:${item.fileKind || 'file'}`
  return item.type
}

function getCItemSearchText(item) {
  return [
    item.type,
    item.fileKind,
    getCItemTypeLabel(item),
    getCItemSummary(item),
    item.text,
    item.display?.title,
    item.ref?.filePath,
    item.ref?.cFilePath,
    item.ref?.dataFilePath,
    item.ref?.sourceFilePath,
    item.ref?.entityId,
    item.snapshot?.subject,
    item.snapshot?.kind,
    item.snapshot?.label,
  ].filter(Boolean).join(' ').toLowerCase()
}

function itemMatchesFilter(item, filter) {
  const type = filter.type || 'all'
  const query = String(filter.query || '').trim().toLowerCase()
  if (type !== 'all' && getCItemFilterType(item) !== type) return false
  if (!query) return true
  return getCItemSearchText(item).includes(query)
}

function filterCItemTree(items, filter) {
  let matchCount = 0

  const filteredItems = items
    .map((item) => {
      const childResult = filterCItemTree(item.children || [], filter)
      const selfMatches = itemMatchesFilter(item, filter)
      if (selfMatches) matchCount += 1
      matchCount += childResult.matchCount

      if (!selfMatches && childResult.items.length === 0) return null
      return {
        ...item,
        children: selfMatches ? item.children || [] : childResult.items,
      }
    })
    .filter(Boolean)

  return {
    items: filteredItems,
    matchCount,
  }
}

export default function CompositeDocumentView({
  cDocument,
  cDocumentFilePath,
  onChangeItems,
  onDeleteItem,
  onOpenBRef,
  onSelectItem,
  onUpdateItemText,
  selectedCItemId,
  showFilter = true,
}) {
  const [filter, setFilter] = useState({ type: 'all', query: '' })
  const filterActive = filter.type !== 'all' || Boolean(filter.query.trim())
  const filterResult = useMemo(
    () => filterCItemTree(cDocument.items || [], filter),
    [cDocument.items, filter],
  )
  const displayDocument = filterActive
    ? { ...cDocument, items: filterResult.items }
    : cDocument

  return (
    <div className="composite-document-view">
      {showFilter ? (
        <div className="composite-document-filter">
          <label>
            Type
            <select
              onChange={(event) => setFilter((current) => ({ ...current, type: event.target.value }))}
              value={filter.type}
            >
              {FILTER_TYPES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            Find
            <input
              onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))}
              placeholder="item text / label / path"
              value={filter.query}
            />
          </label>
          <small>
            Match: {filterActive ? filterResult.matchCount : cDocument.items.length}
            {filterActive ? ' / filtered read-only' : ''}
          </small>
        </div>
      ) : null}
      <CompositeListPreview
        cDocument={displayDocument}
        cDocumentFilePath={cDocumentFilePath}
        onChangeItems={filterActive ? undefined : onChangeItems}
        onDeleteItem={filterActive ? undefined : onDeleteItem}
        onOpenBRef={onOpenBRef}
        onSelectItem={onSelectItem}
        onUpdateItemText={onUpdateItemText}
        selectedCItemId={selectedCItemId}
      />
    </div>
  )
}
