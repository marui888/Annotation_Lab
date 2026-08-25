import { createId } from '../core/id'

export function createACardNode(ref = {}) {
  return {
    id: ref.id || createId('card'),
    aObjectId: ref.aObjectId || '',
    role: ref.role || '',
    children: normalizeACardTree(ref.children),
  }
}

export function normalizeACardTree(tree) {
  return Array.isArray(tree)
    ? tree
        .filter((node) => node?.aObjectId)
        .map((node) => createACardNode(node))
    : []
}

export function refsToACardTree(refs = []) {
  return Array.isArray(refs)
    ? refs
        .filter((ref) => ref?.aObjectId)
        .map((ref) => createACardNode(ref))
    : []
}

export function getEntityACardTree(entity) {
  if (!entity) return []
  if (Array.isArray(entity.aCards) && entity.aCards.length > 0) {
    return normalizeACardTree(entity.aCards)
  }
  if (Array.isArray(entity.aObjectRefs)) {
    return refsToACardTree(entity.aObjectRefs)
  }
  return refsToACardTree((entity.aObjectIds || []).map((aObjectId) => ({
    aObjectId,
    role: entity.kind,
  })))
}

export function flattenACardTree(tree, path = []) {
  return normalizeACardTree(tree).flatMap((node, index) => {
    const nodePath = [...path, index]
    return [
      {
        id: node.id,
        aObjectId: node.aObjectId,
        role: node.role,
        path: nodePath,
      },
      ...flattenACardTree(node.children, nodePath),
    ]
  })
}

export function createACardPatch(tree) {
  const aCards = normalizeACardTree(tree)
  const flatCards = flattenACardTree(aCards)
  const aObjectRefs = flatCards.map((card) => ({
    aObjectId: card.aObjectId,
    role: card.role,
  }))

  return {
    aCards,
    aObjectRefs,
    aObjectIds: aObjectRefs.map((ref) => ref.aObjectId),
  }
}

export function appendRefsToACardTree(tree, refs) {
  return [
    ...normalizeACardTree(tree),
    ...refsToACardTree(refs),
  ]
}

export function removeACardsByAObjectIds(tree, aObjectIds) {
  const removeSet = new Set(aObjectIds)
  return normalizeACardTree(tree)
    .filter((node) => !removeSet.has(node.aObjectId))
    .map((node) => ({
      ...node,
      children: removeACardsByAObjectIds(node.children, aObjectIds),
    }))
}

export function updateACardRolesByAObjectId(tree, aObjectId, role) {
  return normalizeACardTree(tree).map((node) => ({
    ...node,
    role: node.aObjectId === aObjectId ? role : node.role,
    children: updateACardRolesByAObjectId(node.children, aObjectId, role),
  }))
}

export function updateAllACardRoles(tree, role) {
  return normalizeACardTree(tree).map((node) => ({
    ...node,
    role,
    children: updateAllACardRoles(node.children, role),
  }))
}
