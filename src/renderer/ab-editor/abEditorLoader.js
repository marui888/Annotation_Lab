import { createImageSource } from '../media/imageAdapter.js'
import {
  createPdfSource,
  hydratePdfSource,
} from '../media/pdfAdapter.js'
import { createVideoSource } from '../media/videoAdapter.js'
import { hydrateAnnotationDocument, serializeAnnotationDocument } from '../../shared/annotationDocument.js'

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

export function createPdfEditorInput(pdfResult, options = {}) {
  return {
    kind: 'pdf',
    sourcePath: pdfResult?.filePath || '',
    annotationPath: options.annotationPath || '',
    entityId: options.entityId || '',
    fileInfo: pdfResult || null,
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

export async function openPdfFile() {
  return window.labApi?.openPdf?.()
}

export async function openAnnotationFile() {
  return window.labApi?.openAnnotationFile?.()
}

export async function loadImageFileByPath(filePath) {
  return window.labApi?.loadImageByPath?.(filePath)
}

export async function loadPdfFileByPath(filePath) {
  return window.labApi?.loadPdfByPath?.(filePath)
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

  if (input.kind === 'pdf') {
    const pdfResult = input.fileInfo?.ok
      ? input.fileInfo
      : await loadPdfFileByPath(input.sourcePath)
    return loadPdfEditorSessionFromResult(pdfResult, {
      entityId: input.entityId,
    })
  }

  return {
    ok: false,
    reason: `unsupported-input-kind-${input.kind}`,
  }
}

export async function loadPdfEditorSessionFromResult(pdfResult, options = {}) {
  if (!pdfResult?.ok) {
    return {
      ok: false,
      reason: pdfResult?.reason || 'invalid-pdf-result',
      canceled: pdfResult?.canceled || false,
    }
  }

  const source = createPdfSource(pdfResult)
  const annotationResult = await loadAnnotationForSource(source.filePath)
  if (annotationResult && !annotationResult.ok) return annotationResult
  if (annotationResult?.ok && annotationResult.data) {
    return loadPdfEditorSessionFromAnnotationResult({
      ...annotationResult,
      media: pdfResult,
    }, options)
  }
  const annotationFilePath = annotationResult?.annotationFilePath || `${source.filePath}.annotation.json`

  return {
    ok: true,
    input: createPdfEditorInput(pdfResult, {
      entityId: options.entityId,
    }),
    source,
    annotationFilePath,
    annotations: [],
    simpleNotes: [],
    entities: [],
    folderPath: '',
    folderImages: [],
    saveStatus: annotationResult?.missing ? 'No annotation file' : 'Not saved',
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
  if (sourceKind === 'pdf') {
    return loadPdfEditorSessionFromAnnotationResult(annotationResult, options)
  }

  const data = hydrateAnnotationDocument(annotationResult.data || {})
  const runtimeSource = createImageSource(mediaResult)
  const source = {
    ...runtimeSource,
    id: data.sources[0]?.id || runtimeSource.id,
    meta: { ...data.sources[0]?.meta, ...runtimeSource.meta },
  }
  const annotationFilePath = annotationResult.annotationFilePath || `${source.filePath}.annotation.json`

  return {
    ok: true,
    input: createAnnotationEditorInput(annotationFilePath, {
      sourcePath: source.filePath,
      entityId: options.entityId,
    }),
    source,
    annotationFilePath,
    annotations: Array.isArray(data.annotations) ? data.annotations : [],
    simpleNotes: Array.isArray(data.simpleNotes) ? data.simpleNotes : [],
    entities: Array.isArray(data.entities) ? data.entities : [],
    folderPath: mediaResult.folderPath || '',
    folderImages: Array.isArray(mediaResult.folderImages) ? mediaResult.folderImages : [],
    saveStatus: 'Loaded',
  }
}

export async function loadPdfEditorSessionFromAnnotationResult(annotationResult, options = {}) {
  if (!annotationResult?.ok) {
    return {
      ok: false,
      reason: annotationResult?.reason || 'invalid-annotation-result',
      canceled: annotationResult?.canceled || false,
    }
  }

  const pdfResult = annotationResult.media || annotationResult.image
  if (!pdfResult?.ok) {
    return { ok: false, reason: pdfResult?.reason || 'source-pdf-load-failed' }
  }

  const data = hydrateAnnotationDocument(annotationResult.data || {})
  const savedSource = data.sources?.[0] || {}
  const savedFingerprint = savedSource.fingerprint || {}
  const fingerprintChanged = (
    savedFingerprint.size != null
    && pdfResult.size != null
    && Number(savedFingerprint.size) !== Number(pdfResult.size)
  ) || (
    savedFingerprint.mtimeMs != null
    && pdfResult.mtimeMs != null
    && Number(savedFingerprint.mtimeMs) !== Number(pdfResult.mtimeMs)
  )
  const source = hydratePdfSource(savedSource, pdfResult)
  const annotationFilePath = annotationResult.annotationFilePath || `${source.filePath}.annotation.json`

  return {
    ok: true,
    input: createAnnotationEditorInput(annotationFilePath, {
      sourcePath: source.filePath,
      entityId: options.entityId,
    }),
    source,
    annotationFilePath,
    annotations: Array.isArray(data.annotations) ? data.annotations : [],
    simpleNotes: Array.isArray(data.simpleNotes) ? data.simpleNotes : [],
    entities: Array.isArray(data.entities) ? data.entities : [],
    folderPath: '',
    folderImages: [],
    saveStatus: 'Loaded',
    warning: fingerprintChanged
      ? 'The PDF file has changed since this annotation note was saved. Page references were kept unchanged.'
      : '',
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
  const annotationResult = await loadAnnotationForSource(source.filePath)
  const annotationFilePath = annotationResult?.annotationFilePath || `${source.filePath}.annotation.json`

  if (annotationResult && !annotationResult.ok) return annotationResult

  if (annotationResult?.ok && annotationResult.data) {
    return loadImageEditorSessionFromAnnotationResult({ ...annotationResult, media: imageResult }, options)
  }

  return {
    ok: true,
    input: createImageEditorInput(imageResult, {
      annotationPath: annotationFilePath,
      entityId: options.entityId,
    }),
    source,
    annotationFilePath,
    annotations: [],
    simpleNotes: [],
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

  const data = hydrateAnnotationDocument(annotationResult.data || {})
  const runtimeSource = createVideoSource(videoResult)
  const source = {
    ...runtimeSource,
    id: data.sources[0]?.id || runtimeSource.id,
    meta: {
      ...runtimeSource.meta,
      ...data.sources[0]?.meta,
    },
  }
  const annotationFilePath = annotationResult.annotationFilePath || `${source.filePath}.annotation.json`

  return {
    ok: true,
    input: createAnnotationEditorInput(annotationFilePath, {
      sourcePath: source.filePath,
      entityId: options.entityId,
    }),
    source,
    annotationFilePath,
    annotations: Array.isArray(data.annotations) ? data.annotations : [],
    simpleNotes: Array.isArray(data.simpleNotes) ? data.simpleNotes : [],
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

  if (annotationResult && !annotationResult.ok) return annotationResult

  if (annotationResult?.ok && annotationResult.data) {
    return loadVideoEditorSessionFromAnnotationResult({ ...annotationResult, media: videoResult }, options)
  }

  return {
    ok: true,
    input: createVideoEditorInput(videoResult, {
      annotationPath: annotationFilePath,
      entityId: options.entityId,
    }),
    source,
    annotationFilePath,
    annotations: [],
    simpleNotes: [],
    entities: [],
    folderPath: '',
    folderImages: [],
    saveStatus: annotationResult?.missing ? 'No annotation file' : 'Not saved',
  }
}

export async function saveAnnotationDocument(sourceFilePath, data, annotationFilePath = '') {
  let stored
  try {
    stored = serializeAnnotationDocument(data)
  } catch (error) {
    return { ok: false, reason: error.message || String(error) }
  }
  return window.labApi?.saveAnnotations?.({
    sourceFilePath,
    annotationFilePath,
    data: stored,
  })
}
