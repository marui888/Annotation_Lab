import CSelectedDetailPanel from './CSelectedDetailPanel'
import CompositeDocumentView from './CompositeDocumentView'

export default function CompositeBrowser({
  bIndexItems = [],
  cDocument,
  cDocumentFilePath,
  onChangeItems,
  onDeleteItem,
  onOpenBRef,
  onSelectItem,
  onUpdateItemText,
  panel = 'both',
  selectedBIndexItemKey = '',
  selectedCItemId = null,
  showFilter = true,
}) {
  const selectedTreeItem = (cDocument.items || []).flatMap(function flatten(item) {
    return [item, ...(item.children || []).flatMap(flatten)]
  }).find((item) => item.id === selectedCItemId) || null
  const selectedBIndexItem = bIndexItems.find((item) => `${item.dataFilePath}:${item.entityId}` === selectedBIndexItemKey) || null

  if (panel === 'detail') {
    return (
      <CSelectedDetailPanel
        onOpenBRef={onOpenBRef}
        onUpdateItemText={onUpdateItemText}
        selectedBIndexItem={selectedBIndexItem}
        selectedCItem={selectedTreeItem}
      />
    )
  }

  if (panel === 'document') {
    return (
      <CompositeDocumentView
        cDocument={cDocument}
        cDocumentFilePath={cDocumentFilePath}
        onChangeItems={onChangeItems}
        onDeleteItem={onDeleteItem}
        onOpenBRef={onOpenBRef}
        onSelectItem={onSelectItem}
        onUpdateItemText={onUpdateItemText}
        selectedCItemId={selectedCItemId}
        showFilter={showFilter}
      />
    )
  }

  return (
    <div className="composite-browser">
      <aside className="composite-browser-detail">
        <CompositeBrowser
          bIndexItems={bIndexItems}
          cDocument={cDocument}
          cDocumentFilePath={cDocumentFilePath}
          onOpenBRef={onOpenBRef}
          onUpdateItemText={onUpdateItemText}
          panel="detail"
          selectedBIndexItemKey={selectedBIndexItemKey}
          selectedCItemId={selectedCItemId}
        />
      </aside>
      <section className="composite-browser-document">
        <CompositeBrowser
          cDocument={cDocument}
          cDocumentFilePath={cDocumentFilePath}
          onChangeItems={onChangeItems}
          onDeleteItem={onDeleteItem}
          onOpenBRef={onOpenBRef}
          onSelectItem={onSelectItem}
          onUpdateItemText={onUpdateItemText}
          panel="document"
          selectedCItemId={selectedCItemId}
          showFilter={showFilter}
        />
      </section>
    </div>
  )
}
