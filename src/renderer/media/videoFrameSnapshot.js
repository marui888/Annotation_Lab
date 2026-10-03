export function captureVideoFrameSnapshot({
  signal,
  src,
  time,
  timeoutMs = 10000,
}) {
  return new Promise((resolve) => {
    if (!src || !Number.isFinite(time)) {
      resolve({
        ok: false,
        reason: 'invalid-video-snapshot-request',
      })
      return
    }

    if (signal?.aborted) {
      resolve({
        ok: false,
        aborted: true,
        reason: 'video-snapshot-aborted',
      })
      return
    }

    const video = document.createElement('video')
    let settled = false
    let timeoutId = null

    const cleanup = () => {
      if (timeoutId) window.clearTimeout(timeoutId)
      signal?.removeEventListener('abort', handleAbort)
      video.removeEventListener('error', handleError)
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('seeked', handleSeeked)
      video.removeAttribute('src')
      video.load()
      video.remove()
    }

    const finish = (result) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    const handleAbort = () => {
      finish({
        ok: false,
        aborted: true,
        reason: 'video-snapshot-aborted',
      })
    }

    const handleError = () => {
      finish({
        ok: false,
        reason: video.error?.message || `video-snapshot-error-${video.error?.code || 'unknown'}`,
      })
    }

    const handleLoadedMetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : null
      const safeTime = duration === null
        ? Math.max(0, time)
        : Math.max(0, Math.min(time, Math.max(0, duration - 0.05)))
      try {
        video.currentTime = safeTime
      } catch (error) {
        finish({
          ok: false,
          reason: error?.message || 'video-snapshot-seek-failed',
        })
      }
    }

    const handleSeeked = () => {
      const width = video.videoWidth || null
      const height = video.videoHeight || null
      if (!width || !height) {
        finish({
          ok: false,
          reason: 'video-snapshot-size-unavailable',
        })
        return
      }

      try {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        context.drawImage(video, 0, 0, width, height)
        finish({
          ok: true,
          previewUrl: canvas.toDataURL('image/png'),
          imageSize: {
            width,
            height,
          },
        })
      } catch (error) {
        finish({
          ok: false,
          reason: error?.message || 'video-snapshot-canvas-failed',
        })
      }
    }

    timeoutId = window.setTimeout(() => {
      finish({
        ok: false,
        reason: 'video-snapshot-timeout',
      })
    }, timeoutMs)

    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    video.style.position = 'fixed'
    video.style.left = '-10000px'
    video.style.top = '-10000px'
    video.style.width = '1px'
    video.style.height = '1px'
    document.body.appendChild(video)

    signal?.addEventListener('abort', handleAbort, { once: true })
    video.addEventListener('error', handleError)
    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('seeked', handleSeeked, { once: true })

    video.src = src
    video.load()
  })
}
