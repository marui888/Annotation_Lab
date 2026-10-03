import { captureVideoFrameSnapshot } from './videoFrameSnapshot'
import { capturePdfPageSnapshot } from './pdfPageSnapshot'

const DEFAULT_MAX_CONCURRENT = 2
const DEFAULT_MAX_ENTRIES = 64
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024

export const VIDEO_PREVIEW_PRIORITIES = {
  prefetch: 10,
  visible: 20,
  source: 30,
  selected: 40,
}

function getPositiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

function estimatePreviewBytes(result) {
  return Math.max(0, String(result?.previewUrl || '').length * 2)
}

export function createVideoFramePreviewCache(options = {}) {
  let maxConcurrent = getPositiveInteger(options.maxConcurrent, DEFAULT_MAX_CONCURRENT)
  let maxEntries = getPositiveInteger(options.maxEntries, DEFAULT_MAX_ENTRIES)
  let maxBytes = getPositiveInteger(options.maxBytes, DEFAULT_MAX_BYTES)
  const cache = new Map()
  const jobs = new Map()
  const queue = []
  const scopes = new Map()
  let activeCount = 0
  let cachedBytes = 0
  let jobSequence = 0

  const getKeyPriority = (key) => {
    let priority = null
    scopes.forEach((scope) => {
      if (!scope.keys.has(key)) return
      priority = priority === null ? scope.priority : Math.max(priority, scope.priority)
    })
    return priority
  }

  const isKeyActive = (key) => getKeyPriority(key) !== null

  const removeCacheEntry = (key) => {
    const entry = cache.get(key)
    if (!entry) return
    cachedBytes = Math.max(0, cachedBytes - entry.estimatedBytes)
    cache.delete(key)
  }

  const evict = () => {
    if (cache.size <= maxEntries && cachedBytes <= maxBytes) return
    for (const key of cache.keys()) {
      if (cache.size <= maxEntries && cachedBytes <= maxBytes) break
      if (isKeyActive(key)) continue
      removeCacheEntry(key)
    }
  }

  const readCache = (key) => {
    const entry = cache.get(key)
    if (!entry) return null
    cache.delete(key)
    cache.set(key, entry)
    return entry.result
  }

  const writeCache = (key, result) => {
    removeCacheEntry(key)
    const estimatedBytes = estimatePreviewBytes(result)
    cache.set(key, { estimatedBytes, result })
    cachedBytes += estimatedBytes
    evict()
  }

  const settleJob = (job, result) => {
    if (job.settled) return
    job.settled = true
    jobs.delete(job.key)
    job.resolve(result)
  }

  const cancelJob = (job) => {
    if (!job || job.settled) return
    job.canceled = true
    if (job.started) job.controller?.abort()
    settleJob(job, {
      ok: false,
      aborted: true,
      reason: 'video-snapshot-aborted',
    })
  }

  const pump = () => {
    queue.sort((left, right) => (
      right.priority - left.priority || left.sequence - right.sequence
    ))
    while (activeCount < maxConcurrent && queue.length > 0) {
      const job = queue.shift()
      if (!job || job.settled) continue

      job.started = true
      job.controller = new AbortController()
      activeCount += 1
      const capture = job.mediaKind === 'pdf'
        ? capturePdfPageSnapshot({
            page: job.page,
            renderScale: job.renderScale,
            signal: job.controller.signal,
            src: job.src,
          })
        : captureVideoFrameSnapshot({
            signal: job.controller.signal,
            src: job.src,
            time: job.time,
          })
      capture.then((result) => {
        if (!job.canceled && result?.ok) writeCache(job.key, result)
        settleJob(job, result)
      }).catch((error) => {
        settleJob(job, {
          ok: false,
          reason: error?.message || String(error),
        })
      }).finally(() => {
        activeCount = Math.max(0, activeCount - 1)
        pump()
      })
    }
  }

  const refreshJobs = () => {
    jobs.forEach((job, key) => {
      const priority = getKeyPriority(key)
      if (priority === null) {
        cancelJob(job)
        return
      }
      job.priority = priority
    })
    evict()
    pump()
  }

  return {
    configure(nextOptions = {}) {
      maxConcurrent = getPositiveInteger(nextOptions.maxConcurrent, maxConcurrent)
      maxEntries = getPositiveInteger(nextOptions.maxEntries, maxEntries)
      maxBytes = getPositiveInteger(nextOptions.maxBytes, maxBytes)
      evict()
      pump()
    },

    get(key) {
      return readCache(key)
    },

    request({ key, mediaKind = 'video', page, priority = 0, renderScale, src, time }) {
      const cached = readCache(key)
      if (cached) return Promise.resolve(cached)
      const pending = jobs.get(key)
      if (pending) return pending.promise

      let resolveJob
      const promise = new Promise((resolve) => {
        resolveJob = resolve
      })
      const job = {
        canceled: false,
        controller: null,
        key,
        mediaKind,
        page,
        priority: getKeyPriority(key) ?? priority,
        promise,
        resolve: resolveJob,
        sequence: jobSequence,
        renderScale,
        settled: false,
        src,
        started: false,
        time,
      }
      jobSequence += 1
      jobs.set(key, job)
      queue.push(job)
      pump()
      return promise
    },

    setActiveKeys(scopeId, keys, priority = 0) {
      if (!scopeId) return
      scopes.set(scopeId, { keys: new Set(keys), priority })
      refreshJobs()
    },

    releaseScope(scopeId) {
      if (!scopeId || !scopes.delete(scopeId)) return
      refreshJobs()
    },

    clear() {
      scopes.clear()
      jobs.forEach(cancelJob)
      queue.length = 0
      cache.clear()
      cachedBytes = 0
    },
  }
}
