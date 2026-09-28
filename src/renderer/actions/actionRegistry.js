const actions = new Map()
const listeners = new Set()

export const ACTION_CATALOG = [
  { id: 'ab.aObject.goTo', label: 'A Object Go To', scope: 'global', description: 'Go to current A Object target frame.' },
  { id: 'ab.frame.goTo', label: 'Frame Go To', scope: 'global', description: 'Go to current frame.' },
  { id: 'ab.entity.goTo', label: 'Entity Go To', scope: 'global', description: 'Go to current Entity default frame.' },
  { id: 'global.openSettings', label: 'Open Settings', scope: 'global', description: 'Open application settings.' },
  { id: 'global.openSchemaEditor', label: 'Open Schema Editor', scope: 'global', description: 'Open Subject Schema Editor.' },
  { id: 'picture.openImage', label: 'Open Image', scope: 'picture', description: 'Open an image source.' },
  { id: 'picture.openAnnotation', label: 'Open JSON', scope: 'picture', description: 'Open an annotation JSON file.' },
  { id: 'picture.saveJson', label: 'Save JSON', scope: 'picture', description: 'Save current annotation JSON.' },
  { id: 'picture.previous', label: 'Previous', scope: 'picture', description: 'Open previous image in the current folder list.' },
  { id: 'picture.next', label: 'Next', scope: 'picture', description: 'Open next image in the current folder list.' },
  { id: 'picture.tool.select', label: 'Tool Select', scope: 'picture', description: 'Switch A layer tool to Select.' },
  { id: 'picture.tool.rect', label: 'Tool Rect', scope: 'picture', description: 'Switch A layer tool to Rect.' },
  { id: 'picture.tool.arrow', label: 'Tool Arrow', scope: 'picture', description: 'Switch A layer tool to Arrow.' },
  { id: 'picture.tool.text', label: 'Tool Text', scope: 'picture', description: 'Switch A layer tool to Text.' },
  { id: 'picture.deleteSelected', label: 'Delete Selected A', scope: 'picture', description: 'Delete selected A Object(s).' },
  { id: 'picture.zoom.fit', label: 'Fit', scope: 'picture', description: 'Fit source view to available area.' },
  { id: 'picture.zoom.actual', label: '100%', scope: 'picture', description: 'Show source view at actual size.' },
  { id: 'picture.zoom.out', label: 'Zoom Out', scope: 'picture', description: 'Zoom source view out.' },
  { id: 'picture.zoom.in', label: 'Zoom In', scope: 'picture', description: 'Zoom source view in.' },
  { id: 'video.openVideo', label: 'Open Video', scope: 'video', description: 'Open a video source.' },
  { id: 'video.openAnnotation', label: 'Open JSON', scope: 'video', description: 'Open an annotation JSON file.' },
  { id: 'video.saveJson', label: 'Save JSON', scope: 'video', description: 'Save current annotation JSON.' },
  { id: 'video.playPause', label: 'Play / Pause', scope: 'video', description: 'Toggle video playback.' },
  { id: 'video.longBack', label: 'Long Back', scope: 'video', description: 'Jump backward in current video.' },
  { id: 'video.longForward', label: 'Long Forward', scope: 'video', description: 'Jump forward in current video.' },
  { id: 'video.simpleNote.setStart', label: 'Set Start', scope: 'video', description: 'Set temporary SimpleNote start from playback position.' },
  { id: 'video.simpleNote.setEnd', label: 'Set End', scope: 'video', description: 'Set temporary SimpleNote end from playback position.' },
  { id: 'video.simpleNote.appendMark', label: 'Append Mark', scope: 'video', description: 'Append SimpleNote from current temporary range and content.' },
  { id: 'video.simpleNote.appendQuickMark', label: 'Append Quick Mark', scope: 'video', description: 'Append SimpleNote from current playback position.' },
  { id: 'video.simpleNote.quickUpdateRange', label: 'Quick Update Range', scope: 'video', description: 'Update selected SimpleNote range from current playback position.' },
  { id: 'video.simpleNote.writeCurrentRange', label: 'Write Current Range', scope: 'video', description: 'Write temporary range to selected SimpleNote.' },
  { id: 'video.simpleNote.updateContent', label: 'Update Content', scope: 'video', description: 'Write editor content to selected SimpleNote.' },
  { id: 'video.simpleNote.goTo', label: 'GO TO', scope: 'video', description: 'Jump to selected SimpleNote start.' },
  { id: 'video.simpleNote.delete', label: 'Delete SimpleNote', scope: 'video', description: 'Delete selected SimpleNote.' },
  { id: 'video.simpleNote.import', label: 'Import', scope: 'video', description: 'Import video note JSON as SimpleNotes.' },
]

const catalogMap = new Map(ACTION_CATALOG.map((action) => [action.id, action]))

function notifyListeners() {
  const snapshot = getRegisteredActions()
  listeners.forEach((listener) => listener(snapshot))
}

export function registerAction(action) {
  if (!action?.id || typeof action.handler !== 'function') return () => {}
  actions.set(action.id, {
    ...(catalogMap.get(action.id) || { id: action.id, label: action.id, scope: 'global', description: '' }),
    ...action,
  })
  notifyListeners()

  return () => {
    const current = actions.get(action.id)
    if (current?.handler === action.handler) {
      actions.delete(action.id)
      notifyListeners()
    }
  }
}

export function registerActions(nextActions = []) {
  const unregisterCallbacks = nextActions.map((action) => registerAction(action))
  return () => unregisterCallbacks.forEach((unregister) => unregister())
}

export async function runAction(actionId) {
  const action = actions.get(actionId)
  if (!action) return { ok: false, reason: 'action-not-found', actionId }
  await action.handler()
  return { ok: true }
}

export function getRegisteredActions() {
  const merged = new Map(catalogMap)
  actions.forEach((action, id) => merged.set(id, action))
  return [...merged.values()].map((action) => {
    const metadata = { ...action }
    delete metadata.handler
    return metadata
  })
}

export function getActionsByScope(scope) {
  return getRegisteredActions().filter((action) => action.scope === scope)
}

export function subscribeActions(listener) {
  listeners.add(listener)
  listener(getRegisteredActions())
  return () => listeners.delete(listener)
}
