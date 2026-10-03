import { pdfjs } from 'react-pdf'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const rendererBaseUrl = new URL('.', window.location.href)

export const PDF_DOCUMENT_OPTIONS = {
  cMapPacked: true,
  cMapUrl: new URL('cmaps/', rendererBaseUrl).toString(),
  standardFontDataUrl: new URL('standard_fonts/', rendererBaseUrl).toString(),
}
