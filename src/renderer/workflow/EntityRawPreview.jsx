import { useEffect, useMemo } from 'react'
import TreeList from '../components/tree-list/TreeList'
import { flattenACardTree, getEntityACardTree } from '../domain/aCardTree'
import APreviewCard from '../ab-editor/APreviewCard'
import { calculateSharedAnnotationCropScale } from '../ab-editor/previewCrop'

export default function EntityRawPreview({
  annotations,
  ensureAnnotationPreview,
  entity,
  getAnnotationPreview,
  imageSize,
  imageUrl,
  onNodeContextMenu,
  onSelectCards,
  previewBackgroundColor,
  previewScaleFactor = 1,
  readOnly = true,
  selectedCardIds = [],
  showAnnotationFrame = true,
  useSharedScale = false,
}) {
  const entityTree = useMemo(() => (entity ? getEntityACardTree(entity) : []), [entity])
  const flatCards = useMemo(() => flattenACardTree(entityTree), [entityTree])
  const previewEntries = useMemo(() => flatCards.map((node) => {
    const annotation = annotations.find((item) => item.id === node.aObjectId)
    const annotationPreview = getAnnotationPreview?.(annotation)
    return {
      annotation,
      imageSize: annotationPreview?.imageSize || imageSize,
      imageUrl: annotationPreview?.imageUrl || imageUrl,
      node,
    }
  }), [annotations, flatCards, getAnnotationPreview, imageSize, imageUrl])
  const sharedScale = useSharedScale
    ? calculateSharedAnnotationCropScale(previewEntries, { scaleFactor: previewScaleFactor })
    : null

  useEffect(() => {
    if (!ensureAnnotationPreview) return
    previewEntries.forEach((entry) => {
      if (!entry.annotation) return
      if (entry.imageUrl && entry.imageSize) return
      ensureAnnotationPreview(entry.annotation)
    })
  }, [ensureAnnotationPreview, previewEntries])

  const handleSelect = (ids) => {
    onSelectCards?.(ids)
  }

  return (
    <div className="entity-raw-preview no-animation">
      <TreeList
        emptyText="No A Cards in current Entity."
        onNodeContextMenu={onNodeContextMenu}
        onSelect={handleSelect}
        readOnly={readOnly}
        selectedIds={selectedCardIds}
        tree={entityTree}
        renderNode={(node) => {
          const previewEntry = previewEntries.find((entry) => entry.node.id === node.id)
          const annotation = previewEntry?.annotation
          return (
            <APreviewCard
              annotation={annotation}
              imageUrl={previewEntry?.imageUrl}
              imageSize={previewEntry?.imageSize}
              index={flatCards.findIndex((card) => card.id === node.id)}
              layoutScale={sharedScale}
              previewBackgroundColor={previewBackgroundColor}
              showAnnotationFrame={showAnnotationFrame}
              showInfo={false}
            />
          )
        }}
      />
    </div>
  )
}
