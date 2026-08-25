import { Group, Rect } from 'react-konva'
import { getRectBorderHotZones, getRectHandles } from './rectInteraction'

export default function ResizableRect({
  annotation,
  bodyVisible = true,
  isSelected,
  onContextMenu,
  onDragStart,
  onHandleDragStart,
  onSelect,
  rect,
}) {
  const handleSize = 8
  const hotZoneSize = 14

  return (
    <Group>
      {bodyVisible ? (
        <Rect
          fill={annotation.style?.fill || 'rgba(255, 212, 90, 0.12)'}
          height={rect.height}
          onContextMenu={(event) => onContextMenu?.(annotation.id, event)}
          onMouseDown={(event) => {
            event.cancelBubble = true
            if (event.evt?.button === 2) return
            onSelect(annotation.id, event)
          }}
          stroke={isSelected ? '#000' : annotation.style?.stroke || '#ffd45a'}
          strokeWidth={isSelected ? 3 : annotation.style?.strokeWidth || 2}
          width={rect.width}
          x={rect.x}
          y={rect.y}
        />
      ) : null}

      {isSelected ? (
        <>
          {bodyVisible ? getRectBorderHotZones(rect, hotZoneSize).map((zone) => (
            <Rect
              fill="rgba(0, 0, 0, 0)"
              height={zone.height}
              key={`hot-${zone.name}`}
              onMouseDown={(event) => {
                event.cancelBubble = true
                if (event.evt?.button === 2) return
                onDragStart(annotation.id, event)
              }}
              width={zone.width}
              x={zone.x}
              y={zone.y}
            />
          )) : null}

          {getRectHandles(rect, handleSize).map((handle) => (
            <Rect
              fill="#000"
              height={handle.height}
              key={handle.name}
              onMouseDown={(event) => {
                event.cancelBubble = true
                if (event.evt?.button === 2) return
                onHandleDragStart(annotation.id, handle.name, event)
              }}
              stroke="#fff"
              strokeWidth={1}
              width={handle.width}
              x={handle.x}
              y={handle.y}
            />
          ))}
        </>
      ) : null}
    </Group>
  )
}
