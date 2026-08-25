export const RECT_HANDLE_NAMES = [
  'top-left',
  'top',
  'top-right',
  'right',
  'bottom-right',
  'bottom',
  'bottom-left',
  'left',
]

export function getRectHandles(rect, handleSize = 8) {
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  const half = handleSize / 2

  const points = {
    'top-left': { x: rect.x, y: rect.y },
    top: { x: centerX, y: rect.y },
    'top-right': { x: right, y: rect.y },
    right: { x: right, y: centerY },
    'bottom-right': { x: right, y: bottom },
    bottom: { x: centerX, y: bottom },
    'bottom-left': { x: rect.x, y: bottom },
    left: { x: rect.x, y: centerY },
  }

  return RECT_HANDLE_NAMES.map((name) => ({
    name,
    x: points[name].x - half,
    y: points[name].y - half,
    width: handleSize,
    height: handleSize,
  }))
}

export function getRectBorderHotZones(rect, hotSize = 12) {
  const half = hotSize / 2
  return [
    {
      name: 'top',
      x: rect.x,
      y: rect.y - half,
      width: rect.width,
      height: hotSize,
    },
    {
      name: 'right',
      x: rect.x + rect.width - half,
      y: rect.y,
      width: hotSize,
      height: rect.height,
    },
    {
      name: 'bottom',
      x: rect.x,
      y: rect.y + rect.height - half,
      width: rect.width,
      height: hotSize,
    },
    {
      name: 'left',
      x: rect.x - half,
      y: rect.y,
      width: hotSize,
      height: rect.height,
    },
  ]
}
