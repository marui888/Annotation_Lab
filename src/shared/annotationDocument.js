// B-file migration boundary. Runtime and disk both use sourceId + locator.
import { normalizeAObjectProperties } from './aObjectProperties.js'
import { normalizeVideoLocator } from './videoLocator.js'

export const ANNOTATION_SCHEMA_VERSION = 3.1

export function getAnnotationSchemaVersion(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('invalid-annotation-document')
  }
  const version = data.schemaVersion ?? 1
  if (version !== 1 && version !== 2 && version !== 3 && version !== 3.1) {
    throw new Error(`unsupported-annotation-schema-version:${version}`)
  }
  for (const field of ['sources', 'annotations', 'entities', 'frames']) {
    if (data[field] !== undefined && !Array.isArray(data[field])) {
      throw new Error(`invalid-annotation-field:${field}`)
    }
  }
  return version
}

function finiteNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function resolveTarget(annotation, sources, frameMap, version) {
  const legacy = version === 1
  if (!legacy && (!annotation.sourceId || !annotation.locator || typeof annotation.locator !== 'object' || Array.isArray(annotation.locator))) {
    throw new Error(`invalid-annotation-locator:${annotation.id || ''}`)
  }
  const frame = frameMap.get(annotation.frameId)
  const sourceId = frame?.sourceId || annotation.sourceId || sources[0]?.id
  // Earlier loaders sometimes regenerated the sole source ID without updating frames.
  const source = sources.find((item) => item.id === sourceId)
    || (legacy && sources.length === 1 ? sources[0] : null)
  if (!source) throw new Error(`annotation-source-unavailable:${annotation.id || ''}`)
  let locator = {}
  if (source.kind === 'video') {
    // Legacy frame time is authoritative; annotation.timeStamp is only a fallback.
    const start = version === 3.1 ? annotation.locator.start : (
      finiteNumber(frame?.locator?.time)
      ?? finiteNumber(frame?.timeStamp)
      ?? (legacy ? finiteNumber(annotation.timeStamp) : null)
      ?? finiteNumber(annotation.locator?.start)
      ?? finiteNumber(annotation.locator?.time)
    )
    try {
      locator = normalizeVideoLocator({ start, end: annotation.locator?.end }, source.meta?.duration)
    } catch (error) {
      throw new Error(`${error.message}:${annotation.id || ''}`, { cause: error })
    }
  } else if (source.kind === 'pdf') {
    const page = finiteNumber(frame?.locator?.physicalPage ?? frame?.locator?.page)
      ?? finiteNumber(annotation.locator?.physicalPage)
    if (page === null || page < 1 || !Number.isInteger(page)) {
      throw new Error(`annotation-pdf-page-unavailable:${annotation.id}`)
    }
    locator.physicalPage = page
    locator.bookPageLabel = frame?.meta?.bookPageLabel ?? annotation.locator?.bookPageLabel ?? null
  } else if (source.kind !== 'image') {
    throw new Error(`unsupported-annotation-source-kind:${source.kind}`)
  }
  return { locator, source }
}

// Legacy Frames are read only here, then discarded. No F object is rebuilt.
export function hydrateAnnotationDocument(data) {
  return serializeAnnotationDocument(data)
}

export function serializeAnnotationDocument(data) {
  const version = getAnnotationSchemaVersion(data)
  const sources = data.sources || []
  const frameMap = new Map((version === 1 ? data.frames || [] : []).map((frame) => [frame.id, frame]))
  const annotations = (data.annotations || []).map((annotation) => {
    const { locator, source } = resolveTarget(annotation, sources, frameMap, version)
    const clean = { ...annotation, ...normalizeAObjectProperties(annotation), sourceId: source.id, locator }
    delete clean.frameId
    delete clean.timeStamp
    return clean
  })
  const result = { ...data, schemaVersion: ANNOTATION_SCHEMA_VERSION, sources, annotations }
  delete result.frames
  return result
}
