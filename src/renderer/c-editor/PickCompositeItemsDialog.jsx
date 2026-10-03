import { useEffect, useMemo, useRef, useState } from 'react'
import { flattenTree } from '../components/tree-list/treeOperations'
import { normalizeCDocument } from '../domain/cDocument'
import CompositeBrowser from './CompositeBrowser'
import CSelectedDetailPanel from './CSelectedDetailPanel'

const MIN_DETAIL_WIDTH = 220
const MIN_DOCUMENT_WIDTH = 360
const INITIAL_DETAIL_WIDTH = 320

export default function PickCompositeItemsDialog({
  filePath,
  fileName,
  onAddWhole,
  onAddSelected,
  onClose,
  onOpenWhole,
  previewResources,
  sourceDocument,
  workspaceId,
}) {
  const cDocument = useMemo(() => normalizeCDocument(sourceDocument), [sourceDocument])
  const flatItems = useMemo(() => flattenTree(cDocument.items || []), [cDocument.items])
  const [selectedCItemId, setSelectedCItemId] = useState(null)
  const [selectedCItem, setSelectedCItem] = useState(null)
  const [dialogOffset, setDialogOffset] = useState({ x: 0, y: 0 })
  const [detailWidth, setDetailWidth] = useState(INITIAL_DETAIL_WIDTH)
  const dragRef = useRef(null)
  const resizeRef = useRef(null)
  const bodyRef = useRef(null)
  const selectedItem = selectedCItem || flatItems.find((item) => item.id === selectedCItemId) || null

  useEffect(() => {
    const moveDialog = (event) => {
      if (!dragRef.current) return
      const nextX = dragRef.current.originX + event.clientX - dragRef.current.startX
      const nextY = dragRef.current.originY + event.clientY - dragRef.current.startY
      setDialogOffset({ x: nextX, y: nextY })
    }

    const stopDragging = () => {
      dragRef.current = null
    }

    window.addEventListener('mousemove', moveDialog)
    window.addEventListener('mouseup', stopDragging)
    return () => {
      window.removeEventListener('mousemove', moveDialog)
      window.removeEventListener('mouseup', stopDragging)
    }
  }, [])

  const addSelected = () => {
    if (!selectedItem) return
    onAddSelected([selectedItem])
  }

  const startDragging = (event) => {
    if (event.button !== 0) return
    dragRef.current = {
      originX: dialogOffset.x,
      originY: dialogOffset.y,
      startX: event.clientX,
      startY: event.clientY,
    }
  }

  useEffect(() => {
    const resizeColumns = (event) => {
      if (!resizeRef.current || !bodyRef.current) return
      const bodyRect = bodyRef.current.getBoundingClientRect()
      const maxDetailWidth = Math.max(
        MIN_DETAIL_WIDTH,
        bodyRect.width - MIN_DOCUMENT_WIDTH - 8
      )
      const nextWidth = resizeRef.current.originWidth + event.clientX - resizeRef.current.startX
      setDetailWidth(Math.max(MIN_DETAIL_WIDTH, Math.min(maxDetailWidth, nextWidth)))
    }

    const stopResizing = () => {
      resizeRef.current = null
    }

    window.addEventListener('mousemove', resizeColumns)
    window.addEventListener('mouseup', stopResizing)
    return () => {
      window.removeEventListener('mousemove', resizeColumns)
      window.removeEventListener('mouseup', stopResizing)
    }
  }, [])

  const startResizing = (event) => {
    event.preventDefault()
    resizeRef.current = {
      originWidth: detailWidth,
      startX: event.clientX,
    }
  }

  const selectItem = (itemId) => {
    const nextItem = flatItems.find((item) => item.id === itemId) || null
    setSelectedCItemId(itemId || null)
    setSelectedCItem(nextItem)
  }

  return (
    <div className="dialog-layer">
      <div
        className="pick-composite-dialog"
        style={{ transform: `translate(${dialogOffset.x}px, ${dialogOffset.y}px)` }}
      >
        <header className="pick-composite-header" onMouseDown={startDragging}>
          <div>
            <strong>Pick Items From Composite</strong>
            <small title={filePath}>{filePath}</small>
          </div>
        </header>

        <div
          className="pick-composite-body"
          ref={bodyRef}
          style={{
            gridTemplateColumns: `${detailWidth}px 6px minmax(0, 1fr)`,
          }}
        >
          <aside className="pick-composite-detail">
            <div className="pick-composite-detail-content">
              <CSelectedDetailPanel
                onOpenBRef={() => {}}
                onUpdateItemText={() => {}}
                previewResources={previewResources}
                selectedBIndexItem={null}
                selectedCItem={selectedItem}
                workspaceId={workspaceId}
              />
            </div>
          </aside>

          <div
            aria-label="Resize Pick Composite detail"
            className="pick-composite-splitter"
            onMouseDown={startResizing}
            role="separator"
            title="Resize selected detail"
          />

          <section className="pick-composite-document">
            <CompositeBrowser
              cDocument={cDocument}
              cDocumentFilePath={filePath}
              onOpenBRef={() => {}}
              onSelectItem={selectItem}
              panel="document"
              previewResources={previewResources}
              selectedCItemId={selectedCItemId}
              showFilter
              workspaceId={workspaceId}
            />
          </section>
        </div>

        <footer className="pick-composite-footer">
          <span>Selected: <strong>{selectedItem ? '1' : '0'}</strong></span>
          <button onClick={() => onAddWhole?.({ filePath, fileName, sourceDocument: cDocument })} type="button">Add Whole</button>
          <button disabled={!selectedItem} onClick={addSelected} type="button">Add Selected</button>
          <button onClick={() => onOpenWhole?.({ filePath, fileName, sourceDocument: cDocument })} type="button">Open</button>
          <button onClick={onClose} type="button">Close</button>
        </footer>
      </div>
    </div>
  )
}
