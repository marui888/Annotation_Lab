import { useEffect, useLayoutEffect, useRef } from 'react'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

export default function usePreviewWheelZoom({
  enabled = true,
  maxScale = 3,
  minScale = 0.5,
  scale,
  setScale,
  step = 0.05,
}) {
  const containerRef = useRef(null)
  const pendingAnchorRef = useRef(null)
  const setScaleRef = useRef(setScale)

  useEffect(() => {
    setScaleRef.current = setScale
  }, [setScale])

  useEffect(() => {
    const container = containerRef.current
    if (!enabled || !container) return undefined

    const handleWheel = (event) => {
      if (!event.ctrlKey || !event.deltaY) return
      event.preventDefault()
      event.stopPropagation()

      const rect = container.getBoundingClientRect()
      const offsetX = clamp(event.clientX - rect.left, 0, container.clientWidth)
      const offsetY = clamp(event.clientY - rect.top, 0, container.clientHeight)
      const scrollWidth = Math.max(1, container.scrollWidth)
      const scrollHeight = Math.max(1, container.scrollHeight)
      const delta = event.deltaY < 0 ? step : -step

      setScaleRef.current?.((current) => {
        const next = clamp(Number((current + delta).toFixed(2)), minScale, maxScale)
        if (next === current) {
          pendingAnchorRef.current = null
          return current
        }
        pendingAnchorRef.current = {
          offsetX,
          offsetY,
          xRatio: (container.scrollLeft + offsetX) / scrollWidth,
          yRatio: (container.scrollTop + offsetY) / scrollHeight,
        }
        return next
      })
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [enabled, maxScale, minScale, step])

  useLayoutEffect(() => {
    const container = containerRef.current
    const anchor = pendingAnchorRef.current
    if (!container || !anchor) return

    container.scrollLeft = clamp(
      anchor.xRatio * container.scrollWidth - anchor.offsetX,
      0,
      Math.max(0, container.scrollWidth - container.clientWidth),
    )
    container.scrollTop = clamp(
      anchor.yRatio * container.scrollHeight - anchor.offsetY,
      0,
      Math.max(0, container.scrollHeight - container.clientHeight),
    )
    pendingAnchorRef.current = null
  }, [scale])

  return containerRef
}
