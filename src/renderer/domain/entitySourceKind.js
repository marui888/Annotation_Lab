const SOURCE_KIND_META = {
  image: {
    icon: 'fa-solid fa-image',
    label: 'Image source',
  },
  video: {
    icon: 'fa-solid fa-film',
    label: 'Video source',
  },
  pdf: {
    icon: 'fa-solid fa-file-pdf',
    label: 'PDF source',
  },
  unknown: {
    icon: 'fa-solid fa-file-circle-question',
    label: 'Unknown source',
  },
}

function inferSourceKindFromPath(filePath = '') {
  const normalizedPath = String(filePath || '').toLowerCase()
  if (/\.(mp4|webm|mov|m4v|mkv)(\.annotation\.json)?$/.test(normalizedPath)) return 'video'
  if (/\.(jpg|jpeg|png|bmp|gif|webp)(\.annotation\.json)?$/.test(normalizedPath)) return 'image'
  if (/\.pdf(\.annotation\.json)?$/.test(normalizedPath)) return 'pdf'
  return 'unknown'
}

export function resolveEntitySourceKind(sourceKind, ...filePaths) {
  const normalizedKind = String(sourceKind || '').trim().toLowerCase()
  if (normalizedKind === 'picture') return 'image'
  if (SOURCE_KIND_META[normalizedKind] && normalizedKind !== 'unknown') return normalizedKind

  for (const filePath of filePaths) {
    const inferredKind = inferSourceKindFromPath(filePath)
    if (inferredKind !== 'unknown') return inferredKind
  }
  return 'unknown'
}

export function getEntitySourceKindMeta(sourceKind, ...filePaths) {
  const kind = resolveEntitySourceKind(sourceKind, ...filePaths)
  return {
    kind,
    ...SOURCE_KIND_META[kind],
  }
}
