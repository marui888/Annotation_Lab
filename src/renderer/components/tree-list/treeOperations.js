function cloneNode(node) {
  return {
    ...node,
    children: Array.isArray(node.children) ? node.children.map(cloneNode) : [],
  }
}

export function normalizeTree(tree) {
  return Array.isArray(tree) ? tree.map(cloneNode).filter((node) => node?.id) : []
}

export function flattenTree(tree, path = []) {
  return normalizeTree(tree).flatMap((node, index) => {
    const nodePath = [...path, index]
    return [
      { ...node, path: nodePath },
      ...flattenTree(node.children, nodePath),
    ]
  })
}

export function findNode(tree, nodeId) {
  for (const node of normalizeTree(tree)) {
    if (node.id === nodeId) return node
    const found = findNode(node.children, nodeId)
    if (found) return found
  }
  return null
}

export function removeNode(tree, nodeId) {
  let removed = null
  const nextTree = normalizeTree(tree).reduce((result, node) => {
    if (node.id === nodeId) {
      removed = node
      return result
    }
    const childResult = removeNode(node.children, nodeId)
    if (childResult.removed) removed = childResult.removed
    result.push({
      ...node,
      children: childResult.tree,
    })
    return result
  }, [])

  return {
    tree: nextTree,
    removed,
  }
}

function insertRelative(tree, targetId, nodeToInsert, position) {
  return normalizeTree(tree).flatMap((node) => {
    if (node.id === targetId) {
      if (position === 'before') return [nodeToInsert, node]
      if (position === 'after') return [node, nodeToInsert]
      return [{
        ...node,
        children: [...normalizeTree(node.children), nodeToInsert],
      }]
    }

    return [{
      ...node,
      children: insertRelative(node.children, targetId, nodeToInsert, position),
    }]
  })
}

export function moveNode(tree, sourceId, targetId, position) {
  if (!sourceId || !targetId || sourceId === targetId) return normalizeTree(tree)
  const sourceNode = findNode(tree, sourceId)
  const targetNode = findNode(tree, targetId)
  if (!sourceNode || !targetNode) return normalizeTree(tree)

  const targetIsInsideSource = flattenTree(sourceNode.children).some((node) => node.id === targetId)
  if (targetIsInsideSource) return normalizeTree(tree)

  const removeResult = removeNode(tree, sourceId)
  if (!removeResult.removed) return normalizeTree(tree)
  return insertRelative(removeResult.tree, targetId, removeResult.removed, position)
}

export function removeNodes(tree, nodeIds) {
  const idSet = new Set(nodeIds)
  return normalizeTree(tree)
    .filter((node) => !idSet.has(node.id))
    .map((node) => ({
      ...node,
      children: removeNodes(node.children, nodeIds),
    }))
}

export function getNodeMeta(tree, nodeId) {
  function walk(nodes, parentId = null, depth = 0) {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]
      if (node.id === nodeId) {
        return {
          depth,
          index,
          parentId,
          siblingCount: nodes.length,
          hasPreviousSibling: index > 0,
          hasNextSibling: index < nodes.length - 1,
          isRoot: parentId === null,
        }
      }
      const found = walk(normalizeTree(node.children), node.id, depth + 1)
      if (found) return found
    }
    return null
  }

  return walk(normalizeTree(tree))
}

function mapSiblingsContaining(nodes, nodeId, mapSiblings) {
  const normalizedNodes = normalizeTree(nodes)
  if (normalizedNodes.some((node) => node.id === nodeId)) {
    return mapSiblings(normalizedNodes)
  }

  return normalizedNodes.map((node) => ({
    ...node,
    children: mapSiblingsContaining(node.children, nodeId, mapSiblings),
  }))
}

export function promoteNode(tree, nodeId) {
  const sourceMeta = getNodeMeta(tree, nodeId)
  if (!sourceMeta || sourceMeta.isRoot) return normalizeTree(tree)

  const sourceNode = findNode(tree, nodeId)
  if (!sourceNode) return normalizeTree(tree)

  const withoutSource = removeNodes(tree, [nodeId])
  return insertRelative(withoutSource, sourceMeta.parentId, sourceNode, 'after')
}

export function demoteNode(tree, nodeId) {
  const sourceMeta = getNodeMeta(tree, nodeId)
  if (!sourceMeta || !sourceMeta.hasPreviousSibling) return normalizeTree(tree)

  const siblingsUpdated = mapSiblingsContaining(tree, nodeId, (siblings) => {
    const index = siblings.findIndex((node) => node.id === nodeId)
    if (index <= 0) return siblings
    const sourceNode = siblings[index]
    const previousNode = siblings[index - 1]
    return siblings
      .filter((_, itemIndex) => itemIndex !== index)
      .map((node) => (
        node.id === previousNode.id
          ? {
              ...node,
              children: [...normalizeTree(node.children), sourceNode],
            }
          : node
      ))
  })

  return siblingsUpdated
}

export function moveSiblingUp(tree, nodeId) {
  const sourceMeta = getNodeMeta(tree, nodeId)
  if (!sourceMeta || !sourceMeta.hasPreviousSibling) return normalizeTree(tree)

  return mapSiblingsContaining(tree, nodeId, (siblings) => {
    const index = siblings.findIndex((node) => node.id === nodeId)
    if (index <= 0) return siblings
    const nextSiblings = [...siblings]
    const currentNode = nextSiblings[index]
    nextSiblings[index] = nextSiblings[index - 1]
    nextSiblings[index - 1] = currentNode
    return nextSiblings
  })
}

export function moveSiblingDown(tree, nodeId) {
  const sourceMeta = getNodeMeta(tree, nodeId)
  if (!sourceMeta || !sourceMeta.hasNextSibling) return normalizeTree(tree)

  return mapSiblingsContaining(tree, nodeId, (siblings) => {
    const index = siblings.findIndex((node) => node.id === nodeId)
    if (index < 0 || index >= siblings.length - 1) return siblings
    const nextSiblings = [...siblings]
    const currentNode = nextSiblings[index]
    nextSiblings[index] = nextSiblings[index + 1]
    nextSiblings[index + 1] = currentNode
    return nextSiblings
  })
}
