import { useEffect, useState } from 'react'
import TreeList from '../components/tree-list/TreeList'
import {
  demoteNode,
  flattenTree,
  getNodeMeta,
  moveSiblingDown,
  moveSiblingUp,
  promoteNode,
} from '../components/tree-list/treeOperations'
import { getCItemSummary, getCItemTypeLabel } from './cEditorUtils'

function CItemTreeNode({ node, context }) {
  return (
    <div className="c-item-tree-node">
      <div>
        <strong>{getCItemTypeLabel(node)}</strong>
        <span title={getCItemSummary(node)}>{getCItemSummary(node)}</span>
      </div>
      <small>Level {context.depth + 1}</small>
    </div>
  )
}

export default function CItemTreePanel({
  items,
  onChangeItems,
  onDeleteItem,
  onSelectItem,
  onUpdateItemText,
  readOnly = false,
  selectedCItemId,
  showSelectedActions = false,
}) {
  const [cItemMenu, setCItemMenu] = useState(null)
  const flatCItems = flattenTree(items)
  const selectedTreeItem = flatCItems.find((item) => item.id === selectedCItemId) || null

  useEffect(() => {
    if (!cItemMenu) return undefined
    const closeMenu = () => setCItemMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('contextmenu', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('contextmenu', closeMenu)
    }
  }, [cItemMenu])

  const openCItemMenu = (event, node) => {
    if (readOnly || !onChangeItems || !onDeleteItem) return
    const menuWidth = 120
    const menuHeight = 138
    setCItemMenu({
      nodeId: node.id,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
    })
  }

  const runCItemMenuAction = (action) => {
    if (!cItemMenu?.nodeId) return
    if (action === 'promote') onChangeItems(promoteNode(items, cItemMenu.nodeId))
    if (action === 'demote') onChangeItems(demoteNode(items, cItemMenu.nodeId))
    if (action === 'up') onChangeItems(moveSiblingUp(items, cItemMenu.nodeId))
    if (action === 'down') onChangeItems(moveSiblingDown(items, cItemMenu.nodeId))
    if (action === 'delete') onDeleteItem(cItemMenu.nodeId)
    setCItemMenu(null)
  }

  return (
    <div className="c-item-tree-panel">
      <TreeList
        emptyText="No C items."
        onNodeContextMenu={openCItemMenu}
        onSelect={(ids) => onSelectItem?.(ids[ids.length - 1] || null)}
        onTreeChange={onChangeItems}
        readOnly={readOnly}
        selectedIds={selectedCItemId ? [selectedCItemId] : []}
        tree={items}
        renderNode={(node, context) => (
          <CItemTreeNode context={context} node={node} />
        )}
      />
      {showSelectedActions && selectedTreeItem?.type === 'text' ? (
        <textarea
          className="c-selected-text-editor"
          onChange={(event) => onUpdateItemText(selectedTreeItem.id, event.target.value)}
          value={selectedTreeItem.text}
        />
      ) : null}
      {cItemMenu ? (
        (() => {
          const meta = getNodeMeta(items, cItemMenu.nodeId)
          return (
            <div
              className="c-item-context-menu"
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
              style={{ left: cItemMenu.x, top: cItemMenu.y }}
            >
              <button disabled={!meta || meta.isRoot} onClick={() => runCItemMenuAction('promote')} type="button">Promote</button>
              <button disabled={!meta || !meta.hasPreviousSibling} onClick={() => runCItemMenuAction('demote')} type="button">Demote</button>
              <button disabled={!meta || !meta.hasPreviousSibling} onClick={() => runCItemMenuAction('up')} type="button">Up</button>
              <button disabled={!meta || !meta.hasNextSibling} onClick={() => runCItemMenuAction('down')} type="button">Down</button>
              <button className="danger" onClick={() => runCItemMenuAction('delete')} type="button">Delete</button>
            </div>
          )
        })()
      ) : null}
    </div>
  )
}
