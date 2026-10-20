// A location identifies source pixels; it is not an independently managed object.
import { getVideoStart } from './videoLocator.js'

export function resolveMediaTarget(source, annotation) {
  if (!source || !annotation || annotation.sourceId !== source.id) return null
  const locator = annotation.locator || {}
  if (source.kind === 'video') {
    const start = getVideoStart(locator)
    if (start === null) return null
    // Capture/player APIs use a single time, always derived from start, not end.
    return { kind: 'video', time: start, key: mediaLocationKey(source, locator) }
  }
  if (source.kind === 'pdf') {
    if (!Number.isInteger(locator.physicalPage) || locator.physicalPage < 1) return null
    return { kind: 'pdf', page: locator.physicalPage, key: mediaLocationKey(source, locator) }
  }
  return source.kind === 'image' ? { kind: 'image', key: mediaLocationKey(source, {}) } : null
}

export function mediaLocationKey(source, locator = {}) {
  return JSON.stringify([
    source?.fileName || source?.id || '',
    source?.fingerprint?.size ?? '',
    source?.fingerprint?.mtimeMs ?? '',
    source?.kind,
    source?.kind === 'video' ? getVideoStart(locator) : source?.kind === 'pdf' ? locator.physicalPage : 'image',
  ])
}

export function matchesMediaLocation(annotation, sourceId, locator, kind, tolerance = 0.0001) {
  if (annotation?.sourceId !== sourceId || !annotation.locator || !locator) return false
  if (kind === 'pdf') return annotation.locator.physicalPage === locator.physicalPage
  if (kind === 'video') {
    const start = getVideoStart(annotation.locator)
    const pictureStart = getVideoStart(locator)
    return start !== null && pictureStart !== null && Math.abs(start - pictureStart) <= tolerance
  }
  return kind === 'image'
}
