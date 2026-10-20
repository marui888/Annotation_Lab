export const DEFAULT_VIDEO_RANGE_SECONDS = 2.55

// Read-only compatibility for old snapshots and transient callers. New data
// always writes start/end; an explicitly invalid start never falls back to time.
export function getVideoStart(locator) {
  const start = locator?.start !== undefined ? locator.start : locator?.time
  return typeof start === 'number' && Number.isFinite(start) && start >= 0 ? start : null
}

function clampDefaultEnd(start, end, duration) {
  return typeof duration === 'number' && Number.isFinite(duration) && duration >= 0
    ? Math.max(start, Math.min(end, duration))
    : end
}

export function normalizeVideoLocator(locator, duration) {
  const start = locator?.start
  if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) {
    throw new Error('invalid-video-locator-start')
  }
  const end = locator.end === undefined
    ? clampDefaultEnd(start, start + DEFAULT_VIDEO_RANGE_SECONDS, duration)
    : locator.end
  if (typeof end !== 'number' || !Number.isFinite(end) || end < start) {
    throw new Error('invalid-video-locator-end')
  }
  return { start, end }
}

export function createVideoLocator(start, duration) {
  return normalizeVideoLocator({ start }, duration)
}

export function relocateVideoLocator(locator, start, duration) {
  const previousStart = getVideoStart(locator)
  const previousEnd = locator?.end
  if (previousStart === null || !Number.isFinite(previousEnd) || previousEnd < previousStart) {
    return createVideoLocator(start, duration)
  }
  if (previousStart === start) return normalizeVideoLocator({ start, end: previousEnd }, duration)
  return normalizeVideoLocator({
    start,
    end: clampDefaultEnd(start, start + (previousEnd - previousStart), duration),
  }, duration)
}
