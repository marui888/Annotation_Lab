import { createAnnotationExportTask } from '../ab-editor/exportCropRect'
import { getEntityAObjectRefs } from '../domain/domainSchemas'
import { normalizeCDocument } from '../domain/cDocument'
import { captureVideoFrameSnapshot } from '../media/videoFrameSnapshot'

const MAX_C_REF_EXPORT_DEPTH = 3
const VIDEO_FILE_PATTERN = /\.(mp4|webm|mov|m4v|mkv)$/i

function findItemWithPath(items, itemId, parentPath = []) {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const treePath = [...parentPath, index]
    if (item.id === itemId) return { item, treePath }
    const childResult = findItemWithPath(item.children || [], itemId, treePath)
    if (childResult) return childResult
  }
  return null
}

function getAnnotationTime(annotation, annotationData) {
  const frame = (annotationData.frames || []).find((item) => item.id === annotation.frameId)
  const time = Number(annotation.timeStamp ?? frame?.timeStamp ?? frame?.locator?.time)
  return Number.isFinite(time) ? time : null
}

function getSourceKind(annotationData, sourceFilePath) {
  const declaredKind = annotationData.sources?.[0]?.kind
  if (declaredKind === 'video' || VIDEO_FILE_PATTERN.test(sourceFilePath || '')) return 'video'
  return 'image'
}

function createTaskAppender(tasks) {
  return (task) => {
    tasks.push({
      ...task,
      index: tasks.length,
    })
  }
}

export async function prepareCompositeExport({
  cDocument,
  cDocumentFilePath = '',
  mode = 'all',
  selectedCItemId = null,
}) {
  const document = normalizeCDocument(cDocument)
  const tasks = []
  const appendTask = createTaskAppender(tasks)
  const annotationFileCache = new Map()
  const cDocumentCache = new Map()
  const videoFrameCache = new Map()

  let rootItems = document.items
  let rootPaths = document.items.map((_item, index) => [index])
  if (mode === 'selected') {
    const selected = findItemWithPath(document.items, selectedCItemId)
    if (!selected) {
      return { ok: false, reason: 'selected-c-item-not-found', tasks: [] }
    }
    rootItems = [selected.item]
    rootPaths = [selected.treePath]
  }

  const appendError = (item, treePath, reason, extra = {}) => {
    appendTask({
      kind: 'error',
      cItemId: item?.id || '',
      cItemType: item?.type || '',
      treePath,
      reason,
      ...extra,
    })
  }

  const loadAnnotation = async (filePath) => {
    if (!annotationFileCache.has(filePath)) {
      annotationFileCache.set(filePath, window.labApi?.loadAnnotationFileByPath?.(filePath))
    }
    return annotationFileCache.get(filePath)
  }

  const loadCReference = async (filePath) => {
    if (!cDocumentCache.has(filePath)) {
      cDocumentCache.set(filePath, window.labApi?.readCDocumentFile?.(filePath))
    }
    return cDocumentCache.get(filePath)
  }

  const prepareEntity = async (item, treePath, sourceCompositePath) => {
    const annotationFilePath = item.ref?.dataFilePath || ''
    const entityId = item.ref?.entityId || ''
    if (!annotationFilePath || !entityId) {
      appendError(item, treePath, 'invalid-b-entity-reference', { sourceCompositePath })
      return
    }

    const loadResult = await loadAnnotation(annotationFilePath)
    if (!loadResult?.ok) {
      appendError(item, treePath, loadResult?.reason || 'load-annotation-file-failed', {
        annotationFilePath,
        entityId,
        sourceCompositePath,
      })
      return
    }

    const annotationData = loadResult.data || {}
    const entity = (annotationData.entities || []).find((candidate) => candidate.id === entityId)
    if (!entity) {
      appendError(item, treePath, 'entity-not-found', {
        annotationFilePath,
        entityId,
        sourceCompositePath,
      })
      return
    }

    const refs = getEntityAObjectRefs(entity)
    if (refs.length === 0) {
      appendError(item, treePath, 'entity-has-no-a-object', {
        annotationFilePath,
        entityId,
        entityLabel: entity.label || '',
        sourceCompositePath,
      })
      return
    }

    const sourceFilePath = loadResult.sourceFilePath || item.ref?.sourceFilePath || ''
    const sourceKind = getSourceKind(annotationData, sourceFilePath)
    const annotations = annotationData.annotations || []

    for (let refIndex = 0; refIndex < refs.length; refIndex += 1) {
      const ref = refs[refIndex]
      const annotation = annotations.find((candidate) => candidate.id === ref.aObjectId)
      const common = {
        cItemId: item.id,
        cItemType: item.type,
        treePath,
        sourceCompositePath,
        annotationFilePath,
        sourceFilePath,
        entityId,
        entityLabel: entity.label || '',
        annotationId: ref.aObjectId,
        role: ref.role || '',
        entityItemIndex: refIndex,
      }
      if (!annotation) {
        appendTask({ ...common, kind: 'error', reason: 'a-object-not-found' })
        continue
      }

      let exportImageSize = loadResult.media?.width && loadResult.media?.height
        ? { width: loadResult.media.width, height: loadResult.media.height }
        : null
      let imageDataUrl = ''
      let sourceFrameId = ''

      if (sourceKind === 'video' && annotation.type !== 'text') {
        const time = getAnnotationTime(annotation, annotationData)
        if (time === null) {
          appendTask({ ...common, kind: 'error', annotationType: annotation.type, reason: 'video-frame-time-unavailable' })
          continue
        }
        sourceFrameId = annotation.frameId || `time-${time}`
        const frameCacheKey = `${sourceFilePath}:${sourceFrameId}:${time}`
        if (!videoFrameCache.has(frameCacheKey)) {
          videoFrameCache.set(frameCacheKey, captureVideoFrameSnapshot({
            src: loadResult.media?.fileUrl,
            time,
          }))
        }
        const snapshot = await videoFrameCache.get(frameCacheKey)
        if (!snapshot?.ok) {
          appendTask({
            ...common,
            kind: 'error',
            annotationType: annotation.type,
            reason: snapshot?.reason || 'video-frame-snapshot-failed',
          })
          continue
        }
        exportImageSize = snapshot.imageSize
        imageDataUrl = snapshot.previewUrl
      }

      const annotationTask = createAnnotationExportTask(annotation, exportImageSize, {
        role: ref.role,
      })
      if (!annotationTask) {
        appendTask({ ...common, kind: 'error', annotationType: annotation.type, reason: 'invalid-a-object' })
        continue
      }

      appendTask({
        ...common,
        ...annotationTask,
        kind: 'annotation',
        annotationType: annotation.type,
        sourceKind,
        sourceFrameId,
        imageDataUrl,
      })
    }
  }

  const walkItems = async (items, paths, context) => {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      const treePath = paths[index]

      if (item.type === 'text') {
        appendTask({
          kind: 'text',
          cItemId: item.id,
          cItemType: item.type,
          treePath,
          sourceCompositePath: context.sourceCompositePath,
          text: item.text || '',
        })
      } else if (item.type === 'file-ref') {
        const sourceFilePath = item.ref?.filePath || ''
        if (!sourceFilePath) {
          appendError(item, treePath, 'file-reference-path-empty', {
            sourceCompositePath: context.sourceCompositePath,
          })
        } else if (item.fileKind === 'image' || item.fileKind === 'text') {
          appendTask({
            kind: 'file-copy',
            cItemId: item.id,
            cItemType: item.type,
            fileKind: item.fileKind,
            displayTitle: item.display?.title || '',
            sourceCompositePath: context.sourceCompositePath,
            sourceFilePath,
            treePath,
          })
        } else {
          appendError(item, treePath, `unsupported-file-kind:${item.fileKind || 'unknown'}`, {
            sourceCompositePath: context.sourceCompositePath,
            sourceFilePath,
          })
        }
      } else if (item.type === 'b-ref') {
        await prepareEntity(item, treePath, context.sourceCompositePath)
      } else if (item.type === 'c-ref') {
        const cFilePath = item.ref?.cFilePath || ''
        if (!cFilePath) {
          appendError(item, treePath, 'c-reference-path-empty', {
            sourceCompositePath: context.sourceCompositePath,
          })
        } else if (context.visitedCFiles.includes(cFilePath)) {
          appendError(item, treePath, 'circular-c-reference', {
            referencedCompositePath: cFilePath,
            sourceCompositePath: context.sourceCompositePath,
          })
        } else if (context.cRefDepth >= MAX_C_REF_EXPORT_DEPTH) {
          appendError(item, treePath, 'max-c-reference-depth-reached', {
            referencedCompositePath: cFilePath,
            sourceCompositePath: context.sourceCompositePath,
          })
        } else {
          const loadResult = await loadCReference(cFilePath)
          if (!loadResult?.ok) {
            appendError(item, treePath, loadResult?.reason || 'load-c-document-failed', {
              referencedCompositePath: cFilePath,
              sourceCompositePath: context.sourceCompositePath,
            })
          } else {
            const referencedDocument = normalizeCDocument(loadResult.data)
            await walkItems(
              referencedDocument.items,
              referencedDocument.items.map((_child, childIndex) => [...treePath, 'ref', childIndex]),
              {
                cRefDepth: context.cRefDepth + 1,
                sourceCompositePath: cFilePath,
                visitedCFiles: [...context.visitedCFiles, cFilePath],
              },
            )
          }
        }
      } else {
        appendError(item, treePath, `unsupported-c-item-type:${item.type || 'unknown'}`, {
          sourceCompositePath: context.sourceCompositePath,
        })
      }

      if (item.children?.length) {
        await walkItems(
          item.children,
          item.children.map((_child, childIndex) => [...treePath, childIndex]),
          context,
        )
      }
    }
  }

  await walkItems(rootItems, rootPaths, {
    cRefDepth: 0,
    sourceCompositePath: cDocumentFilePath,
    visitedCFiles: cDocumentFilePath ? [cDocumentFilePath] : [],
  })

  return {
    ok: tasks.length > 0,
    reason: tasks.length > 0 ? '' : 'composite-has-no-exportable-item',
    tasks,
  }
}
