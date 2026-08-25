import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import videojs from 'video.js'
import 'video.js/dist/video-js.css'

const VideoPlayer = forwardRef(function VideoPlayer({
  onCanPlay,
  onEnded,
  onError,
  onLoadedData,
  onLoadedMetadata,
  onPause,
  onPlay,
  onPlaying,
  onReady,
  onStalled,
  onWaiting,
  src,
}, ref) {
  const containerRef = useRef(null)
  const playerRef = useRef(null)
  const handlersRef = useRef({
    onCanPlay,
    onEnded,
    onError,
    onLoadedData,
    onLoadedMetadata,
    onPause,
    onPlay,
    onPlaying,
    onReady,
    onStalled,
    onWaiting,
  })

  useEffect(() => {
    handlersRef.current = {
      onCanPlay,
      onEnded,
      onError,
      onLoadedData,
      onLoadedMetadata,
      onPause,
      onPlay,
      onPlaying,
      onReady,
      onStalled,
      onWaiting,
    }
  }, [onCanPlay, onEnded, onError, onLoadedData, onLoadedMetadata, onPause, onPlay, onPlaying, onReady, onStalled, onWaiting])

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => playerRef.current?.currentTime?.() ?? 0,
    getDuration: () => playerRef.current?.duration?.() ?? null,
    getFrameDataUrl: () => {
      const videoElement = playerRef.current?.tech?.(true)?.el?.() || null
      if (!videoElement?.videoWidth || !videoElement?.videoHeight) return ''
      const canvas = document.createElement('canvas')
      canvas.width = videoElement.videoWidth
      canvas.height = videoElement.videoHeight
      const context = canvas.getContext('2d')
      context.drawImage(videoElement, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/png')
    },
    getVideoSize: () => {
      const techElement = playerRef.current?.tech?.(true)?.el?.() || null
      return {
        width: techElement?.videoWidth || playerRef.current?.videoWidth?.() || null,
        height: techElement?.videoHeight || playerRef.current?.videoHeight?.() || null,
      }
    },
    isPaused: () => playerRef.current?.paused?.() ?? true,
    pause: () => playerRef.current?.pause?.(),
    play: () => playerRef.current?.play?.(),
    seek: (time) => {
      if (!Number.isFinite(time)) return
      playerRef.current?.currentTime?.(Math.max(0, time))
    },
  }), [])

  useEffect(() => {
    if (!containerRef.current || playerRef.current) {
      return undefined
    }

    const videoElement = document.createElement('video-js')
    videoElement.className = 'video-js vjs-default-skin vjs-big-play-centered'
    videoElement.setAttribute('playsinline', 'true')
    containerRef.current.appendChild(videoElement)

    const player = videojs(videoElement, {
      controls: true,
      preload: 'auto',
      fluid: false,
      fill: true,
      playbackRates: [0.1, 0.3, 0.5, 0.8, 0.9, 1, 1.2, 1.4, 1.6, 1.8, 2],
    })

    playerRef.current = player
    player.on('loadedmetadata', () => handlersRef.current.onLoadedMetadata?.(player))
    player.on('loadeddata', () => handlersRef.current.onLoadedData?.(player))
    player.on('canplay', () => handlersRef.current.onCanPlay?.(player))
    player.on('play', () => handlersRef.current.onPlay?.(player))
    player.on('pause', () => handlersRef.current.onPause?.(player))
    player.on('playing', () => handlersRef.current.onPlaying?.(player))
    player.on('waiting', () => handlersRef.current.onWaiting?.(player))
    player.on('stalled', () => handlersRef.current.onStalled?.(player))
    player.on('ended', () => handlersRef.current.onEnded?.(player))
    player.on('error', () => handlersRef.current.onError?.(player))
    handlersRef.current.onReady?.(player)

    return () => {
      player.dispose()
      playerRef.current = null
    }
  }, [])

  useEffect(() => {
    const player = playerRef.current
    if (!player || !src) {
      return
    }

    player.src({ src, type: 'video/mp4' })
    player.load()
    player.trigger('resize')
  }, [src])

  return (
    <div className="video-js-host" data-vjs-player ref={containerRef} />
  )
})

export default VideoPlayer
