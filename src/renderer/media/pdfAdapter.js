import { createId } from '../core/id.js'

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
