import { pdfjs } from 'react-pdf'
import { PDF_DOCUMENT_OPTIONS } from '../pdf/pdfConfig'

const MAX_DOCUMENTS = 4
const documentCache = new Map()

function touchDocument(src, promise) {
  documentCache.delete(src)
  documentCache.set(src, promise)
  while (documentCache.size > MAX_DOCUMENTS) {
    const oldestKey = documentCache.keys().next().value
    const oldest = documentCache.get(oldestKey)
    documentCache.delete(oldestKey)
    Promise.resolve(oldest).then((document) => document?.destroy?.()).catch(() => {})
  }
}

function loadPdfDocument(src) {
  const cached = documentCache.get(src)
  if (cached) {
    touchDocument(src, cached)
    return cached
  }
  const promise = pdfjs.getDocument({
    url: src,
    ...PDF_DOCUMENT_OPTIONS,
  }).promise
  touchDocument(src, promise)
  return promise
}

export async function capturePdfPageSnapshot({
  page = 1,
  renderScale = 2,
  signal,
  src,
}) {
  if (!src) return { ok: false, reason: 'pdf-source-empty' }
  if (signal?.aborted) return { ok: false, aborted: true, reason: 'pdf-snapshot-aborted' }

  try {
    const document = await loadPdfDocument(src)
    if (signal?.aborted) return { ok: false, aborted: true, reason: 'pdf-snapshot-aborted' }
    const physicalPage = Math.max(1, Math.min(document.numPages, Math.round(Number(page) || 1)))
    const pdfPage = await document.getPage(physicalPage)
    const viewport = pdfPage.getViewport({ scale: Math.max(0.25, Number(renderScale) || 2) })
    const canvas = window.document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(viewport.width))
    canvas.height = Math.max(1, Math.ceil(viewport.height))
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) return { ok: false, reason: 'pdf-canvas-context-unavailable' }
    const renderTask = pdfPage.render({ canvas, canvasContext: context, viewport })
    const abort = () => renderTask.cancel()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      await renderTask.promise
    } finally {
      signal?.removeEventListener('abort', abort)
      pdfPage.cleanup()
    }
    if (signal?.aborted) return { ok: false, aborted: true, reason: 'pdf-snapshot-aborted' }
    return {
      ok: true,
      page: physicalPage,
      previewUrl: canvas.toDataURL('image/png'),
      imageSize: { width: canvas.width, height: canvas.height },
    }
  } catch (error) {
    if (signal?.aborted || error?.name === 'RenderingCancelledException') {
      return { ok: false, aborted: true, reason: 'pdf-snapshot-aborted' }
    }
    return { ok: false, reason: error?.message || String(error) }
  }
}
