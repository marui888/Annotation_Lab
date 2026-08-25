import { createImageFrame, createImageSource } from '../media/imageAdapter'
import { createVideoSource } from '../media/videoAdapter'

export function createImageEditorInput(imageResult, options = {}) {
  return {
    kind: 'image',
    sourcePath: imageResult?.filePath || '',
    annotationPath: options.annotationPath || '',
    entityId: options.entityId || '',
    fileInfo: imageResult || null,
  }
}

export function createAnnotationEditorInput(annotationPath, options = {}) {
  return {
    kind: 'annotation',
    sourcePath: options.sourcePath || '',
    annotationPath,
    entityId: options.entityId || '',
    annotationData: options.annotationData || null,
  }
}

export function createVideoEditorInput(videoResult, options = {}) {
  return {
    kind: 'video',
    sourcePath: videoResult?.filePath || '',
    annotationPath: options.annotationPath || '',
    entityId: options.entityId || '',
    fileInfo: videoResult || null,
  }
}

function toFileUrl(filePath = '') {
  const normalized = String(filePath || '').replace(/\\/g, '/')
  const prefixed = normalized.startsWith('/') ? normalized : `/${normalized}`
  return `file://${encodeURI(prefixed)}`
}

export async function openImageFile() {
  return window.labApi?.openImage?.()
}

export async function openVideoFile() {
  return window.labApi?.openVideo?.()
}

export async function openAnnotationFile() {
  return window.labApi?.openAnnotationFile?.()
}

export async function loadImageFileByPath(filePath) {
  return window.labApi?.loadImageByPath?.(filePath)
}

export async function loadAnnotationFileByPath(annotationFilePath) {
  return window.labApi?.loadAnnotationFileByPath?.(annotationFilePath)
}

export async function loadAnnotationForSource(sourceFilePath) {
  return window.labApi?.loadAnnotations?.(sourceFilePath)
}

export async function loadEditorSessionFromInput(input) {
  if (!input) {
    return {
      ok: false,
      reason: 'missing-input',
    }
  }

  if (input.kind === 'image') {
    const imageResult = input.fileInfo?.ok
      ? input.fileInfo
      : await loadImageFileByPath(input.sourcePath)
    const session = await loadImageEditorSessionFromResult(imageResult, {
      entityId: input.entityId,
    })

    return session
  }

  if (input.kind === 'annotation') {
    const annotationResult = input.annotationData?.ok
      ? input.annotationData
      : await loadAnnotationFileByPath(input.annotationPath)
    const session = await loadImageEditorSessionFromAnnotationResult(annotationResult, {
      entityId: input.entityId,
    })

    return session
  }

  if (input.kind === 'video') {
    const videoResult = input.fileInfo?.ok
      ? input.fileInfo
      : {
          ok: true,
          filePath: input.sourcePath,
          fileName: input.sourcePath?.split(/[\\/]/).pop() || input.sourcePath,
          fileUrl: toFileUrl(input.sourcePath),
        }
    return loadVideoEditorSessionFromResult(videoResult, {
      entityId: input.entityId,
    })
  }

  return {
    ok: false,
    reason: `unsupported-input-kind-${input.kind}`,
  }
}

export async function loadImageEditorSessionFromAnnotationResult(annotationResult, options = {}) {
  if (!annotationResult?.ok) {
    return {
      ok: false,
      reason: annotationResult?.reason || 'invalid-annotation-result',
      canceled: annotationResult?.canceled || false,
    }
  }

  const mediaResult = annotationResult.media || annotationResult.image
  if (!mediaResult?.ok) {
    return {
      ok: false,
      reason: mediaResult?.reason || 'source-media-load-failed',
    }
  }

  const sourceKind = annotationResult.data?.sources?.[0]?.kind || ''
  if (sourceKind === 'video') {
    return loadVideoEditorSessionFromAnnotationResult(annotationResult, options)
  }

  const source = createImageSource(mediaResult)
  const frame = createImageFrame(source)
  const data = annotationResult.data || {}
  const annotationFilePath = annotationResult.annotationFilePath || `${source.filePath}.annotation.json`

  return {
    ok: true,
    input: createAnnotationEditorInput(annotationFilePath, {
      sourcePath: source.filePath,
      entityId: options.entityId,
    }),
    source,
    frame,
    frames: [frame],
    annotationFilePath,
    annotations: Array.isArray(data.annotations) ? data.annotations : [],
    entities: Array.isArray(data.entities) ? data.entities : [],
    folderPath: mediaResult.folderPath || '',
    folderImages: Array.isArray(mediaResult.folderImages) ? mediaResult.folderImages : [],
    saveStatus: 'Loaded',
  }
}

export async function loadImageEditorSessionFromResult(imageResult, options = {}) {
  if (!imageResult?.ok) {
    return {
      ok: false,
      reason: imageResult?.reason || 'invalid-image-result',
      canceled: imageResult?.canceled || false,
    }
  }

  const source = createImageSource(imageResult)
  const frame = createImageFrame(source)
  const annotationResult = await loadAnnotationForSource(source.filePath)
  const annotationFilePath = annotationResult?.annotationFilePath || `${source.filePath}.annotation.json`

  if (annotationResult?.ok && annotationResult.data) {
    return {
      ok: true,
      input: createImageEditorInput(imageResult, {
        annotationPath: annotationFilePath,
        entityId: options.entityId,
      }),
      source,
      frame,
      frames: [frame],
      annotationFilePath,
      annotations: Array.isArray(annotationResult.data.annotations) ? annotationResult.data.annotations : [],
      entities: Array.isArray(annotationResult.data.entities) ? annotationResult.data.entities : [],
      folderPath: imageResult.folderPath || '',
      folderImages: Array.isArray(imageResult.folderImages) ? imageResult.folderImages : [],
      saveStatus: 'Loaded',
    }
  }

  return {
    ok: true,
    input: createImageEditorInput(imageResult, {
      annotationPath: annotationFilePath,
      entityId: options.entityId,
    }),
    source,
    frame,
    frames: [frame],
    annotationFilePath,
    annotations: [],
    entities: [],
    folderPath: imageResult.folderPath || '',
    folderImages: Array.isArray(imageResult.folderImages) ? imageResult.folderImages : [],
    saveStatus: annotationResult?.missing ? 'No annotation file' : 'Not saved',
  }
}

export async function loadVideoEditorSessionFromAnnotationResult(annotationResult, options = {}) {
  if (!annotationResult?.ok) {
    return {
      ok: false,
      reason: annotationResult?.reason || 'invalid-annotation-result',
      canceled: annotationResult?.canceled || false,
    }
  }

  const videoResult = annotationResult.media || annotationResult.image
  if (!videoResult?.ok) {
    return {
      ok: false,
      reason: videoResult?.reason || 'source-video-load-failed',
    }
  }

  const source = createVideoSource(videoResult)
  const data = annotationResult.data || {}
  const frames = Array.isArray(data.frames) ? data.frames : []
  const annotationFilePath = annotationResult.annotationFilePath || `${source.filePath}.annotation.json`

  return {
    ok: true,
    input: createAnnotationEditorInput(annotationFilePath, {
      sourcePath: source.filePath,
      entityId: options.entityId,
    }),
    source,
    frame: frames[0] || null,
    frames,
    annotationFilePath,
    annotations: Array.isArray(data.annotations) ? data.annotations : [],
    entities: Array.isArray(data.entities) ? data.entities : [],
    folderPath: '',
    folderImages: [],
    saveStatus: 'Loaded',
  }
}

export async function loadVideoEditorSessionFromResult(videoResult, options = {}) {
  if (!videoResult?.ok) {
    return {
      ok: false,
      reason: videoResult?.reason || 'invalid-video-result',
      canceled: videoResult?.canceled || false,
    }
  }

  const source = createVideoSource(videoResult)
  const annotationResult = await loadAnnotationForSource(source.filePath)
  const annotationFilePath = annotationResult?.annotationFilePath || `${source.filePath}.annotation.json`

  if (annotationResult?.ok && annotationResult.data) {
    const frames = Array.isArray(annotationResult.data.frames) ? annotationResult.data.frames : []
    return {
      ok: true,
      input: createVideoEditorInput(videoResult, {
        annotationPath: annotationFilePath,
        entityId: options.entityId,
      }),
      source,
      frame: frames[0] || null,
      frames,
      annotationFilePath,
      annotations: Array.isArray(annotationResult.data.annotations) ? annotationResult.data.annotations : [],
      entities: Array.isArray(annotationResult.data.entities) ? annotationResult.data.entities : [],
      folderPath: '',
      folderImages: [],
      saveStatus: 'Loaded',
    }
  }

  return {
    ok: true,
    input: createVideoEditorInput(videoResult, {
      annotationPath: annotationFilePath,
      entityId: options.entityId,
    }),
    source,
    frame: null,
    frames: [],
    annotationFilePath,
    annotations: [],
    entities: [],
    folderPath: '',
    folderImages: [],
    saveStatus: annotationResult?.missing ? 'No annotation file' : 'Not saved',
  }
}

export async function saveAnnotationDocument(sourceFilePath, data, annotationFilePath = '') {
  return window.labApi?.saveAnnotations?.({
    sourceFilePath,
    annotationFilePath,
    data,
  })
}
