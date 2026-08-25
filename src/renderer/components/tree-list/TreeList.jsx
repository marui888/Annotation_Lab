import { useState } from 'react'
import { moveNode, normalizeTree } from './treeOperations'
import './TreeList.css'

function getDropPosition(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  const y = event.clientY - rect.top
  if (y < rect.height * 0.28) return 'before'
  if (y > rect.height * 0.72) return 'after'
  return 'inside'
}

function TreeNode({
  depth,
  node,
  onNodeContextMenu,
  onNodeSelect,
  onTreeChange,
  readOnly,
  renderNode,
  selectedIds,
  tree,
}) {
  const [dropPosition, setDropPosition] = useState('')
  const selected = selectedIds.includes(node.id)

  const handleDragStart = (event) => {
    if (readOnly) return
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-tree-list-node', node.id)
  }

  const handleDragOver = (event) => {
    if (readOnly) return
    if (!Array.from(event.dataTransfer.types).includes('application/x-tree-list-node')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropPosition(getDropPosition(event))
  }

  const handleDrop = (event) => {
    if (readOnly) return
    event.preventDefault()
    const sourceId = event.dataTransfer.getData('application/x-tree-list-node')
    const position = dropPosition || getDropPosition(event)
    setDropPosition('')
    onTreeChange(moveNode(tree, sourceId, node.id, position))
  }

  const context = {
    depth,
    dropPosition,
    readOnly,
    selected,
  }

  const handleContextMenu = (event) => {
    if (!onNodeContextMenu) return
    event.preventDefault()
    event.stopPropagation()
    onNodeContextMenu(event, node, context)
  }

  return (
    <li className="tree-list-item">
      <div
        className={[
          'tree-list-node',
          selected ? 'selected' : '',
          dropPosition ? `drop-${dropPosition}` : '',
          readOnly ? 'readonly' : '',
        ].filter(Boolean).join(' ')}
        draggable={!readOnly}
        onClick={(event) => onNodeSelect(event, node.id)}
        onDragLeave={() => setDropPosition('')}
        onDragOver={handleDragOver}
        onDragStart={handleDragStart}
        onDrop={handleDrop}
        onContextMenu={handleContextMenu}
        style={{ '--tree-depth': depth }}
      >
        {renderNode(node, context)}
      </div>
      {node.children?.length ? (
        <ul className="tree-list-children">
          {node.children.map((child) => (
            <TreeNode
              depth={depth + 1}
              key={child.id}
              node={child}
              onNodeContextMenu={onNodeContextMenu}
              onNodeSelect={onNodeSelect}
              onTreeChange={onTreeChange}
              readOnly={readOnly}
              renderNode={renderNode}
              selectedIds={selectedIds}
              tree={tree}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export default function TreeList({
  emptyText = 'No tree items.',
  onSelect,
  onNodeContextMenu,
  onTreeChange,
  readOnly = false,
  renderNode,
  selectedIds = [],
  tree,
}) {
  const normalizedTree = normalizeTree(tree)

  const handleNodeSelect = (event, nodeId) => {
    if (event.ctrlKey || event.metaKey) {
      onSelect?.(
        selectedIds.includes(nodeId)
          ? selectedIds.filter((id) => id !== nodeId)
          : [...selectedIds, nodeId]
      )
      return
    }
    onSelect?.([nodeId])
  }

  if (normalizedTree.length === 0) {
    return <div className="tree-list-empty">{emptyText}</div>
  }

  return (
    <ul className={readOnly ? 'tree-list readonly' : 'tree-list'}>
      {normalizedTree.map((node) => (
        <TreeNode
          depth={0}
          key={node.id}
          node={node}
          onNodeContextMenu={onNodeContextMenu}
          onNodeSelect={handleNodeSelect}
          onTreeChange={onTreeChange}
          readOnly={readOnly}
          renderNode={renderNode}
          selectedIds={selectedIds}
          tree={normalizedTree}
        />
      ))}
    </ul>
  )
}
