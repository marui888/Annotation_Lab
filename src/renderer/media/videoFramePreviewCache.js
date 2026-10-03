import { captureVideoFrameSnapshot } from './videoFrameSnapshot'

const DEFAULT_MAX_CONCURRENT = 2
const DEFAULT_MAX_ENTRIES = 64
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024

function estimatePreviewBytes(result) {
  const imageUrlBytes = String(result?.previewUrl || '').length * 2
  return Math.max(0, imageUrlBytes)
}

export function createVideoFramePreviewCache(options = {}) {
  const maxConcurrent = options.maxConcurrent || DEFAULT_MAX_CONCURRENT
  const maxEntries = options.maxEntries || DEFAULT_MAX_ENTRIES
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES
  const cache = new Map()
  const jobs = new Map()
  const queue = []
  let activeCount = 0
  let activeKeys = new Set()
  let cachedBytes = 0

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
      if (activeKeys.has(key)) continue
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

  const pump = () => {
    while (activeCount < maxConcurrent && queue.length > 0) {
      const job = queue.shift()
      if (!job || job.settled) continue

      job.started = true
      job.controller = new AbortController()
      activeCount += 1
      captureVideoFrameSnapshot({
        signal: job.controller.signal,
        src: job.src,
        time: job.time,
      }).then((result) => {
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

  const cancelJob = (job) => {
    if (!job || job.settled) return
    job.canceled = true
    if (job.started) {
      job.controller?.abort()
    }
    settleJob(job, {
      ok: false,
      aborted: true,
      reason: 'video-snapshot-aborted',
    })
  }

  return {
    get(key) {
      return readCache(key)
    },

    request({ key, src, time }) {
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
        promise,
        resolve: resolveJob,
        settled: false,
        src,
        started: false,
        time,
      }
      jobs.set(key, job)
      queue.push(job)
      pump()
      return promise
    },

    setActiveKeys(keys) {
      activeKeys = new Set(keys)
      jobs.forEach((job, key) => {
        if (!activeKeys.has(key)) cancelJob(job)
      })
      evict()
      pump()
    },

    clear() {
      jobs.forEach(cancelJob)
      queue.length = 0
      cache.clear()
      activeKeys.clear()
      cachedBytes = 0
    },
  }
}
