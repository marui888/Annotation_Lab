import { createId } from '../core/id'

export function createVideoSource(fileInfo) {
  const now = new Date().toISOString()
  return {
    id: createId('src'),
    kind: 'video',
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
      duration: fileInfo.duration ?? null,
      pageCount: null,
    },
    createdAt: now,
    updatedAt: now,
  }
}

export function createVideoFrame(source, frameInfo = {}) {
  return {
    id: frameInfo.id || createId('frame'),
    sourceId: source.id,
    kind: 'video-frame',
    locator: {
      time: frameInfo.time ?? 0,
    },
    meta: {
      width: frameInfo.width ?? source.meta?.width ?? null,
      height: frameInfo.height ?? source.meta?.height ?? null,
      duration: frameInfo.duration ?? source.meta?.duration ?? null,
    },
    createdAt: frameInfo.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}
