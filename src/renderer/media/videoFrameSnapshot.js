export function captureVideoFrameSnapshot({
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

    const video = document.createElement('video')
    let settled = false
    let timeoutId = null

    const cleanup = () => {
      if (timeoutId) window.clearTimeout(timeoutId)
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

    video.addEventListener('error', () => {
      finish({
        ok: false,
        reason: video.error?.message || `video-snapshot-error-${video.error?.code || 'unknown'}`,
      })
    })

    video.addEventListener('loadedmetadata', () => {
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
    })

    video.addEventListener('seeked', () => {
      const width = video.videoWidth || null
      const height = video.videoHeight || null
      if (!width || !height) {
        finish({
          ok: false,
          reason: 'video-snapshot-size-unavailable',
        })
        return
      }

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
    }, { once: true })

    video.src = src
    video.load()
  })
}
