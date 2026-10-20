import { useEffect, useRef, useState } from 'react'

const DIVIDER_HEIGHT = 8

export default function AObjectSplit({ ratio, onRatioChange, list, properties }) {
  const containerRef = useRef(null)
  const dragRef = useRef(null)
  const [height, setHeight] = useState(0)
  const available = Math.max(0, height - DIVIDER_HEIGHT)
  const minimumTop = Math.min(60, available / 3)
  const maximumTop = available - Math.min(120, available * 2 / 3)
  const topHeight = Math.min(maximumTop, Math.max(minimumTop, available * ratio))
  const actualRatio = available > 0 ? topHeight / available : ratio

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height))
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const resizeTo = (nextHeight) => {
    if (available <= 0) return
    onRatioChange(Math.min(maximumTop, Math.max(minimumTop, nextHeight)) / available)
  }

  const finishDrag = (event) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div
      className="a-object-split"
      ref={containerRef}
      style={{ gridTemplateRows: `${topHeight}px ${DIVIDER_HEIGHT}px minmax(0, 1fr)` }}
    >
      {list}
      <div
        className="a-object-divider"
        role="separator"
        aria-label="Adjust A Object list and properties heights"
        aria-orientation="horizontal"
        aria-valuemin={Math.round(available > 0 ? minimumTop / available * 100 : 0)}
        aria-valuemax={Math.round(available > 0 ? maximumTop / available * 100 : 100)}
        aria-valuenow={Math.round(actualRatio * 100)}
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          dragRef.current = { pointerId: event.pointerId, startY: event.clientY, topHeight }
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (!drag || drag.pointerId !== event.pointerId) return
          resizeTo(drag.topHeight + event.clientY - drag.startY)
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={() => { dragRef.current = null }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          resizeTo(topHeight + (event.key === 'ArrowUp' ? -10 : 10))
        }}
      />
      {properties}
    </div>
  )
}
