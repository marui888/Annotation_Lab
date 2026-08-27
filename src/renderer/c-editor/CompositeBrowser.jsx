import CSelectedDetailPanel from './CSelectedDetailPanel'
import CompositeDocumentView from './CompositeDocumentView'

export default function CompositeBrowser({
  cDocument,
  cDocumentFilePath,
  onChangeItems,
  onDeleteItem,
  onOpenBRef,
  onOpenCRef,
  onSelectItem,
  onUpdateItemText,
  panel = 'both',
  selectedCItemId = null,
  showFilter = true,
}) {
  const selectedTreeItem = (cDocument.items || []).flatMap(function flatten(item) {
    return [item, ...(item.children || []).flatMap(flatten)]
  }).find((item) => item.id === selectedCItemId) || null
  if (panel === 'detail') {
    return (
      <CSelectedDetailPanel
        onOpenBRef={onOpenBRef}
        onOpenCRef={onOpenCRef}
        onUpdateItemText={onUpdateItemText}
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
        onOpenCRef={onOpenCRef}
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
          cDocument={cDocument}
          cDocumentFilePath={cDocumentFilePath}
          onOpenBRef={onOpenBRef}
          onOpenCRef={onOpenCRef}
          onUpdateItemText={onUpdateItemText}
          panel="detail"
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
          onOpenCRef={onOpenCRef}
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
