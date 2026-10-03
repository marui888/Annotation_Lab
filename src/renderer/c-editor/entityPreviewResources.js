import { getEntityAObjectRefs } from '../domain/domainSchemas'
import { resolveEntitySourceKind } from '../domain/entitySourceKind'
import { resolveAnnotationFrameTime } from '../media/annotationFrameTime'
import { getPdfFramePage } from '../media/pdfAdapter'

const DEFAULT_ANNOTATION_CACHE_ENTRIES = 32

export function createAnnotationFilePreviewCache(maxEntries = DEFAULT_ANNOTATION_CACHE_ENTRIES) {
  const cache = new Map()

  const touch = (filePath, promise) => {
    cache.delete(filePath)
    cache.set(filePath, promise)
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value)
  }

  return {
    load(filePath) {
      if (!filePath) return Promise.resolve({ ok: false, reason: 'annotation-file-empty' })
      const cached = cache.get(filePath)
      if (cached) {
        touch(filePath, cached)
        return cached
      }
      const promise = Promise.resolve(
        window.labApi?.loadAnnotationFileByPath?.(filePath),
      ).then((result) => result || {
        ok: false,
        reason: 'loadAnnotationFileByPath-unavailable',
      })
      touch(filePath, promise)
      return promise
    },

    clear() {
      cache.clear()
    },
  }
}

export function createVideoFramePreviewKey(media, time) {
  return [
    media?.fileName || '',
    media?.size || '',
    media?.mtimeMs || '',
    time,
  ].join('|')
}

export function createPdfPagePreviewKey(media, page, renderScale = 2) {
  return [
    media?.fileName || '',
    media?.size || '',
    media?.mtimeMs || '',
    `page:${page}`,
    `scale:${renderScale}`,
  ].join('|')
}

export function prepareEntityPreview(result, entityId, videoFrames) {
  if (!result?.ok) return result || { ok: false, reason: 'load-annotation-file-failed' }
  const entity = (result.data?.entities || []).find((item) => item.id === entityId) || null
  if (!entity) return { ok: false, reason: 'entity-not-found' }

  const annotations = result.data?.annotations || []
  const media = result.media || result.image || null
  const sourceKind = resolveEntitySourceKind(
    result.data?.sources?.[0]?.kind,
    result.sourceFilePath,
    result.annotationFilePath,
  )
  const annotationPreviews = {}
  const activeFrameKeys = new Set()
  const targets = new Map()

  if (sourceKind === 'video') {
    const entityAnnotationIds = new Set(
      getEntityAObjectRefs(entity).map((ref) => ref.aObjectId),
    )
    annotations.forEach((annotation) => {
      if (!entityAnnotationIds.has(annotation.id)) return
      const resolvedFrame = resolveAnnotationFrameTime(annotation, result.data?.frames || [])
      if (resolvedFrame.time === null) {
        annotationPreviews[annotation.id] = {
          ok: false,
          reason: 'frame-time-unavailable',
          status: 'error',
        }
        return
      }

      const frameKey = createVideoFramePreviewKey(media, resolvedFrame.time)
      activeFrameKeys.add(frameKey)
      const cached = videoFrames.get(frameKey)
      if (cached?.ok) {
        annotationPreviews[annotation.id] = {
          frameId: resolvedFrame.frame?.id || annotation.frameId || '',
          imageSize: cached.imageSize,
          imageUrl: cached.previewUrl,
          ok: true,
          status: 'ready',
        }
        return
      }

      annotationPreviews[annotation.id] = {
        frameId: resolvedFrame.frame?.id || annotation.frameId || '',
        status: 'loading',
      }
      const target = targets.get(frameKey) || {
        annotationIds: [],
        frameKey,
        src: media?.fileUrl || '',
        time: resolvedFrame.time,
      }
      target.annotationIds.push(annotation.id)
      targets.set(frameKey, target)
    })
  }

  if (sourceKind === 'pdf') {
    const entityAnnotationIds = new Set(
      getEntityAObjectRefs(entity).map((ref) => ref.aObjectId),
    )
    const frameMap = new Map((result.data?.frames || []).map((item) => [item.id, item]))
    annotations.forEach((annotation) => {
      if (!entityAnnotationIds.has(annotation.id)) return
      const page = getPdfFramePage(frameMap.get(annotation.frameId))
      if (!page) {
        annotationPreviews[annotation.id] = {
          ok: false,
          reason: 'pdf-page-unavailable',
          status: 'error',
        }
        return
      }
      const frameKey = createPdfPagePreviewKey(media, page)
      activeFrameKeys.add(frameKey)
      const cached = videoFrames.get(frameKey)
      if (cached?.ok) {
        annotationPreviews[annotation.id] = {
          frameId: annotation.frameId || '',
          imageSize: cached.imageSize,
          imageUrl: cached.previewUrl,
          ok: true,
          status: 'ready',
        }
        return
      }
      annotationPreviews[annotation.id] = {
        frameId: annotation.frameId || '',
        status: 'loading',
      }
      const target = targets.get(frameKey) || {
        annotationIds: [],
        frameKey,
        mediaKind: 'pdf',
        page,
        renderScale: 2,
        src: media?.fileUrl || '',
      }
      target.annotationIds.push(annotation.id)
      targets.set(frameKey, target)
    })
  }

  return {
    ok: true,
    annotations,
    annotationPreviews,
    activeFrameKeys,
    entity,
    imageSize: sourceKind === 'image' && media?.width && media?.height
      ? { width: media.width, height: media.height }
      : null,
    imageUrl: sourceKind === 'image' ? media?.fileUrl || '' : '',
    reason: '',
    sourceKind,
    targets,
  }
}

export function applyEntityPreviewSnapshot(annotationPreviews, target, snapshot) {
  const nextPreviews = { ...(annotationPreviews || {}) }
  target.annotationIds.forEach((annotationId) => {
    nextPreviews[annotationId] = snapshot?.ok
      ? {
          ...nextPreviews[annotationId],
          imageSize: snapshot.imageSize,
          imageUrl: snapshot.previewUrl,
          ok: true,
          status: 'ready',
        }
      : {
          ...nextPreviews[annotationId],
          ok: false,
        reason: snapshot?.reason || 'media-snapshot-failed',
          status: 'error',
        }
  })
  return nextPreviews
}
