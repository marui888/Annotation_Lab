import { createId } from '../core/id'

export function createPdfSource(fileInfo) {
  const now = new Date().toISOString()
  return {
    id: createId('src'),
    kind: 'pdf',
    filePath: fileInfo.filePath,
    fileName: fileInfo.fileName,
    fileUrl: fileInfo.fileUrl,
    fingerprint: {
      size: fileInfo.size ?? null,
      mtimeMs: fileInfo.mtimeMs ?? null,
    },
    meta: {
      pageCount: fileInfo.pageCount ?? null,
    },
    createdAt: now,
    updatedAt: now,
  }
}

export function hydratePdfSource(savedSource = {}, fileInfo = {}) {
  const runtimeSource = createPdfSource(fileInfo)
  return {
    ...runtimeSource,
    ...savedSource,
    id: savedSource.id || runtimeSource.id,
    kind: 'pdf',
    filePath: fileInfo.filePath || savedSource.filePath || '',
    fileName: fileInfo.fileName || savedSource.fileName || '',
    fileUrl: fileInfo.fileUrl || savedSource.fileUrl || '',
    fingerprint: {
      ...(savedSource.fingerprint || {}),
      size: fileInfo.size ?? savedSource.fingerprint?.size ?? null,
      mtimeMs: fileInfo.mtimeMs ?? savedSource.fingerprint?.mtimeMs ?? null,
    },
    meta: {
      ...(savedSource.meta || {}),
      pageCount: fileInfo.pageCount ?? savedSource.meta?.pageCount ?? null,
    },
    updatedAt: new Date().toISOString(),
  }
}

export function getPdfFramePage(frame) {
  const page = Number(frame?.locator?.physicalPage ?? frame?.locator?.page)
  return Number.isFinite(page) && page > 0 ? Math.round(page) : null
}

export function createPdfPageFrame(source, pageInfo = {}) {
  const page = Math.max(1, Math.round(Number(pageInfo.physicalPage ?? pageInfo.page) || 1))
  const now = new Date().toISOString()
  return {
    id: pageInfo.id || `${source.id}:page:${page}`,
    sourceId: source.id,
    kind: 'pdf-page',
    locator: { physicalPage: page },
    meta: {
      width: pageInfo.width ?? null,
      height: pageInfo.height ?? null,
      rotation: pageInfo.rotation ?? null,
      bookPageLabel: pageInfo.bookPageLabel ?? null,
    },
    createdAt: pageInfo.createdAt || now,
    updatedAt: now,
  }
}
