import { createId } from '../core/id.js'

export function createImageSource(fileInfo) {
  const now = new Date().toISOString()
  return {
    id: createId('src'),
    kind: 'image',
    filePath: fileInfo.filePath,
    fileName: fileInfo.fileName,
    fileUrl: fileInfo.fileUrl,
    fingerprint: {
      size: fileInfo.size ?? null,
      mtimeMs: fileInfo.mtimeMs ?? null,
    },
    meta: {
      width: fileInfo.width ?? null,
      height: fileInfo.height ?? null,
      duration: null,
      pageCount: null,
    },
    createdAt: now,
    updatedAt: now,
  }
}
