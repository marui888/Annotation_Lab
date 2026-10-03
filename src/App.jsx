import { useCallback, useEffect, useRef, useState } from 'react'
import ABEditor from './renderer/ab-editor/ABEditor'
import AppTooltip from './renderer/components/AppTooltip'
import EntitySourceKindIcon from './renderer/components/EntitySourceKindIcon'
import CompositeEditor from './renderer/c-editor/CompositeEditor'
import { prepareCompositeExport } from './renderer/c-editor/compositeExport'
import {
  createAnnotationEditorInput,
  createImageEditorInput,
  createPdfEditorInput,
  createVideoEditorInput,
  openAnnotationFile,
  openImageFile,
  openPdfFile,
  openVideoFile,
  saveAnnotationDocument,
} from './renderer/ab-editor/abEditorLoader'
import { createAnnotationExportTask } from './renderer/ab-editor/exportCropRect'
import { registerActions, runAction, subscribeActions } from './renderer/actions/actionRegistry'
import { createId } from './renderer/core/id'
import { createVideoFrame } from './renderer/media/videoAdapter'
import { createPdfPageFrame, getPdfFramePage } from './renderer/media/pdfAdapter'
import {
  appendRefsToACardTree,
  createACardPatch,
  flattenACardTree,
  getEntityACardTree,
  refsToACardTree,
  removeACardsByAObjectIds,
  updateACardRolesByAObjectId,
} from './renderer/domain/aCardTree'
import {
  createBRefItem,
  createCRefItem,
  createEmptyCDocument,
  createFileRefItem,
  createTextItem,
  normalizeCDocument,
} from './renderer/domain/cDocument'
import { createDefaultEntityFilter } from './renderer/domain/entityFilter'
import {
  DOMAIN_SCHEMAS,
  getDomainDefaultSubKind,
  getDomainEntityRoleRule,
  getDomainKind,
  getDomainRole,
  getDomainRolesForKind,
  getDomainSchema,
  getDomainSubKind,
  getEntityAObjectIds,
  getEntityAObjectRefs,
  normalizeSubjectSchemas,
  validateDomainEntity,
} from './renderer/domain/domainSchemas'
import {
  createSimpleNote,
  formatSimpleNoteTime,
  getSimpleNoteImportKey,
  importOldSimpleNotes,
  normalizeSimpleNoteRange,
  normalizeSimpleNotes,
  parseTimeText,
} from './renderer/domain/simpleNotes'
import { captureVideoFrameSnapshot } from './renderer/media/videoFrameSnapshot'
import { capturePdfPageSnapshot } from './renderer/media/pdfPageSnapshot'
import { getAnnotationNormalizedBounds } from './renderer/pdf/pdfNavigation'
import { createVideoFramePreviewCache } from './renderer/media/videoFramePreviewCache'
import { createAnnotationFilePreviewCache } from './renderer/c-editor/entityPreviewResources'
import useShortcutManager, { formatShortcutEvent } from './renderer/hooks/useShortcutManager'
import './App.css'

const RECENT_FILES_KEY = 'annotationLab.recentFiles'
const LEGACY_RECENT_IMAGES_KEY = 'annotationLab.recentImages'
const MAX_RECENT_FILES = 20
const MAX_DELETE_UNDO_ENTRIES = 20
const A_OBJECT_DRAG_TYPE = 'application/x-annotation-lab-a-object'
const DEFAULT_APP_SETTINGS = {
  frameTimestampToleranceSeconds: 0.1,
  videoPreviewCacheMaxMB: 128,
  videoPreviewCacheMaxFrames: 64,
  videoPreviewMaxConcurrentCaptures: 2,
  shortcuts: {
    video: {
      'video.playPause': 'Space',
      'video.longBack': 'Ctrl+ArrowLeft',
      'video.longForward': 'Ctrl+ArrowRight',
      'video.simpleNote.setStart': 'F2',
      'video.simpleNote.setEnd': 'F3',
      'video.simpleNote.appendQuickMark': 'Ctrl+S',
      'video.simpleNote.quickUpdateRange': 'Ctrl+G',
      'video.simpleNote.writeCurrentRange': 'Ctrl+W',
    },
    picture: {
      'picture.previous': '',
      'picture.next': '',
    },
    pdf: {},
    global: {
      'global.undoDelete': 'Ctrl+Z',
      'global.openSettings': '',
      'global.openSchemaEditor': '',
    },
  },
}
const LEFT_PANEL_DEFAULT_WIDTH = 180
const LEFT_PANEL_MIN_WIDTH = 132
const PANEL_MAX_WIDTH = 560
const DEFAULT_C_WORKSPACE_LAYOUT = {
  columnWidths: {
    source: 'calc((100% - 10px) / 3)',
    builder: 'calc((100% - 10px) / 3)',
    preview: 'calc((100% - 10px) / 3)',
  },
  builderControlHeight: 142,
}

const LEFT_TABS = [
  { id: 'entityFiles', icon: 'fa-solid fa-screwdriver-wrench', label: 'EntityFiles' },
  { id: 'compositeFiles', icon: 'fa-solid fa-book-open', label: 'CompositeFiles' },
  { id: 'folder', icon: 'fa-solid fa-folder-open', label: 'Folder' },
  { id: 'recent', icon: 'fa-solid fa-clock-rotate-left', label: 'Recent' },
]

const AB_INSPECTOR_TABS = [
  { id: 'source', icon: 'fa-solid fa-file-image', label: 'Source' },
  { id: 'frame', icon: 'fa-solid fa-film', label: 'Frames' },
  { id: 'a', icon: 'fa-solid fa-vector-square', label: 'A Objects' },
  { id: 'b', icon: 'fa-solid fa-layer-group', label: 'B Entities' },
  { id: 'simpleNotes', icon: 'fa-solid fa-note-sticky', label: 'SimpleNotes' },
]

const SETTINGS_MAIN_TABS = [
  { id: 'general', label: 'General' },
  { id: 'shortcuts', label: 'Shortcuts' },
]

const SETTINGS_SHORTCUT_TABS = [
  { id: 'video', label: 'Video' },
  { id: 'picture', label: 'Picture' },
  { id: 'pdf', label: 'PDF' },
  { id: 'global', label: 'Global' },
]

function getShortcutConflicts(shortcuts) {
  const conflicts = {}
  Object.entries(shortcuts || {}).forEach(([scope, rows]) => {
    const shortcutToActions = {}
    Object.entries(rows || {}).forEach(([actionId, shortcut]) => {
      const value = typeof shortcut === 'string' ? shortcut.trim() : ''
      if (!value) return
      if (!shortcutToActions[value]) shortcutToActions[value] = []
      shortcutToActions[value].push(actionId)
    })

    conflicts[scope] = new Set(
      Object.values(shortcutToActions)
        .filter((actionIds) => actionIds.length > 1)
        .flat()
    )
  })

  return conflicts
}

const IMAGE_FILE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp'])
const VIDEO_FILE_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv'])
const PDF_FILE_EXTENSIONS = new Set(['.pdf'])

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const normalizeIntegerSetting = (value, min, max, fallback) => {
  const number = Number(value)
  return Number.isFinite(number) ? clamp(Math.round(number), min, max) : fallback
}

const normalizeAppSettings = (settings = {}) => {
  const tolerance = Number(settings.frameTimestampToleranceSeconds)
  return {
    ...DEFAULT_APP_SETTINGS,
    ...settings,
    frameTimestampToleranceSeconds: Number.isFinite(tolerance) && tolerance >= 0
      ? tolerance
      : DEFAULT_APP_SETTINGS.frameTimestampToleranceSeconds,
    videoPreviewCacheMaxMB: normalizeIntegerSetting(
      settings.videoPreviewCacheMaxMB,
      32,
      2048,
      DEFAULT_APP_SETTINGS.videoPreviewCacheMaxMB,
    ),
    videoPreviewCacheMaxFrames: normalizeIntegerSetting(
      settings.videoPreviewCacheMaxFrames,
      8,
      512,
      DEFAULT_APP_SETTINGS.videoPreviewCacheMaxFrames,
    ),
    videoPreviewMaxConcurrentCaptures: normalizeIntegerSetting(
      settings.videoPreviewMaxConcurrentCaptures,
      1,
      8,
      DEFAULT_APP_SETTINGS.videoPreviewMaxConcurrentCaptures,
    ),
    shortcuts: {
      video: {
        ...DEFAULT_APP_SETTINGS.shortcuts.video,
        ...(settings.shortcuts?.video || {}),
      },
      picture: {
        ...DEFAULT_APP_SETTINGS.shortcuts.picture,
        ...(settings.shortcuts?.picture || {}),
      },
      pdf: {
        ...DEFAULT_APP_SETTINGS.shortcuts.pdf,
        ...(settings.shortcuts?.pdf || {}),
      },
      global: {
        ...DEFAULT_APP_SETTINGS.shortcuts.global,
        ...(settings.shortcuts?.global || {}),
      },
    },
  }
}

const getPathFileName = (filePath = '') => {
  const parts = String(filePath).split(/[\\/]/)
  return parts[parts.length - 1] || filePath || 'Empty'
}

const getPathExtension = (filePath = '') => {
  const fileName = getPathFileName(filePath).toLowerCase()
  const index = fileName.lastIndexOf('.')
  return index >= 0 ? fileName.slice(index) : ''
}

const getSimpleNoteImportBaseName = (filePath = '') => (
  getPathFileName(filePath)
    .replace(/\.json$/i, '')
    .replace(/\.annotation$/i, '')
    .replace(/\.(mp4|webm|mov|m4v|mkv)$/i, '')
)

const inferRecentFileKind = (filePath = '', savedKind = '') => {
  const extension = getPathExtension(filePath)
  if (VIDEO_FILE_EXTENSIONS.has(extension)) return 'video'
  if (IMAGE_FILE_EXTENSIONS.has(extension)) return 'image'
  if (PDF_FILE_EXTENSIONS.has(extension)) return 'pdf'
  return ['video', 'image', 'pdf'].includes(savedKind) ? savedKind : 'image'
}

const normalizeRecentFileItem = (item = {}) => ({
  ...item,
  kind: inferRecentFileKind(item.filePath, item.kind),
  fileName: item.fileName || getPathFileName(item.filePath),
})

const getInputTitle = (input) => (
  input?.fileInfo?.fileName || getPathFileName(input?.sourcePath || input?.annotationPath) || 'Empty'
)

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds)) return '--'
  const safeSeconds = Math.max(0, seconds)
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const secs = Math.floor(safeSeconds % 60)
  const millis = Math.floor((safeSeconds - Math.floor(safeSeconds)) * 1000)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

const createEmptyEditorSession = (overrides = {}) => ({
  id: createId('editor'),
  title: 'Empty',
  input: null,
  source: null,
  frame: null,
  frames: [],
  framePreviewUrl: '',
  framePreviewCache: {},
  selectedFrameId: null,
  message: '',
  imageSize: null,
  zoomMode: 'fit',
  zoom: 1,
  pdfPage: 1,
  pdfViewMode: 'single',
  toolMode: 'select',
  annotations: [],
  simpleNotes: [],
  selectedSimpleNoteId: null,
  simpleNoteDraft: '',
  curStart: '',
  curEnd: '',
  videoPlaybackInfo: {
    currentTime: 0,
    duration: null,
    state: 'Paused',
    status: 'Ready',
  },
  selectedAnnotationIds: [],
  annotationFilePath: '',
  saveStatus: 'Not saved',
  editingTextId: null,
  textDraft: '',
  imageFolderPath: '',
  imageFolderItems: [],
  entities: [],
  selectedEntityId: null,
  layoutState: {
    bWorkflowWidth: 420,
    inspectorWidth: 300,
    aPreviewHeight: 128,
  },
  ...overrides,
})

const createInitialEditorWorkspace = () => {
  const firstSession = createEmptyEditorSession()
  return {
    activeId: firstSession.id,
    sessions: [firstSession],
  }
}

const INITIAL_EDITOR_WORKSPACE = createInitialEditorWorkspace()

const createEmptyCWorkspace = (overrides = {}) => ({
  cDocument: createEmptyCDocument(),
  cDocumentFilePath: '',
  cSaveStatus: 'Unsaved',
  bIndexItems: [],
  bIndexSources: [],
  bIndexFilter: createDefaultEntityFilter(),
  selectedBIndexItemKey: '',
  selectedCItemId: null,
  layoutState: DEFAULT_C_WORKSPACE_LAYOUT,
  ...overrides,
})

const updateCItemInTree = (items, itemId, updater) => (
  items.map((item) => (
    item.id === itemId
      ? updater(item)
      : {
          ...item,
          children: updateCItemInTree(item.children || [], itemId, updater),
        }
  ))
)

const removeCItemFromTree = (items, itemId) => (
  items
    .filter((item) => item.id !== itemId)
    .map((item) => ({
      ...item,
      children: removeCItemFromTree(item.children || [], itemId),
    }))
)

const cItemTreeContains = (items, itemId) => (
  items.some((item) => (
    item.id === itemId || cItemTreeContains(item.children || [], itemId)
  ))
)

const findCItemInTree = (items, itemId) => {
  for (const item of items) {
    if (item.id === itemId) return item
    const nestedItem = findCItemInTree(item.children || [], itemId)
    if (nestedItem) return nestedItem
  }
  return null
}

function cloneUndoValue(value) {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

function areUndoContentsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isUnsavedSaveStatus(status) {
  return status === 'Unsaved'
    || status === 'Saving...'
    || String(status || '').startsWith('Save failed:')
}

function getUnsavedAppWorkspaceItems(closeData = {}) {
  const abItems = (closeData.abSessions || [])
    .filter((session) => isUnsavedSaveStatus(session.saveStatus))
    .map((session) => ({
      id: session.id,
      type: 'ab',
      editorLabel: 'ABEditor',
      title: session.title || 'Untitled',
    }))
  const cItems = Object.entries(closeData.cWorkspaces || {})
    .filter(([, workspace]) => isUnsavedSaveStatus(workspace.cSaveStatus))
    .map(([workspaceId, workspace]) => ({
      id: workspaceId,
      type: 'c',
      editorLabel: 'CEditor',
      title: workspace.cDocument.title || getPathFileName(workspace.cDocumentFilePath) || 'Untitled',
    }))
  return [...abItems, ...cItems]
}

function getFrameTimeStamp(targetFrame) {
  const time = Number(targetFrame?.timeStamp ?? targetFrame?.locator?.time)
  return Number.isFinite(time) ? time : null
}

function normalizeFrameTimeStamps(sourceKind, frameItems = []) {
  return frameItems.map((frameItem) => {
    if (sourceKind === 'video' || frameItem.kind === 'video-frame') {
      const timeStamp = getFrameTimeStamp(frameItem) ?? 0
      return {
        ...frameItem,
        timeStamp,
        locator: {
          ...frameItem.locator,
          time: timeStamp,
        },
      }
    }
    if (sourceKind === 'pdf' || frameItem.kind === 'pdf-page') {
      const pdfFrame = { ...frameItem }
      delete pdfFrame.timeStamp
      return pdfFrame
    }
    return {
      ...frameItem,
      timeStamp: null,
    }
  })
}

function findFrameByTimeStamp(frameItems = [], timeStamp, toleranceSeconds = DEFAULT_APP_SETTINGS.frameTimestampToleranceSeconds) {
  const targetTime = Number(timeStamp)
  const tolerance = Number(toleranceSeconds)
  if (!Number.isFinite(targetTime)) return null
  return frameItems.find((frameItem) => {
    const frameTime = getFrameTimeStamp(frameItem)
    return Number.isFinite(frameTime) && Math.abs(frameTime - targetTime) <= Math.max(0, tolerance)
  }) || null
}

function normalizeAnnotationTimeStamps(sourceKind, annotationItems = [], frameItems = []) {
  const normalizedFrames = normalizeFrameTimeStamps(sourceKind, frameItems)
  const frameMap = new Map(normalizedFrames.map((item) => [item.id, item]))
  return annotationItems.map((annotation) => {
    if (annotation.timeStamp !== undefined) return annotation
    if (sourceKind !== 'video') {
      return {
        ...annotation,
        timeStamp: null,
      }
    }
    return {
      ...annotation,
      timeStamp: getFrameTimeStamp(frameMap.get(annotation.frameId)),
    }
  })
}

function ensureFramesForAnnotationTimeStamps(source, frameItems = [], annotationItems = [], toleranceSeconds = DEFAULT_APP_SETTINGS.frameTimestampToleranceSeconds) {
  const normalizedFrameItems = normalizeFrameTimeStamps(source?.kind, frameItems)
  if (source?.kind !== 'video') {
    return {
      frames: normalizedFrameItems,
      annotations: annotationItems,
    }
  }

  const frameMap = new Map(normalizedFrameItems.map((item) => [item.id, item]))
  const nextFrames = [...normalizedFrameItems]
  const nextAnnotations = annotationItems.map((annotation) => {
    const timeStamp = Number(annotation.timeStamp)
    if (!Number.isFinite(timeStamp)) return annotation

    const existingFrame = findFrameByTimeStamp(nextFrames, timeStamp, toleranceSeconds)
    const frameId = existingFrame?.id || annotation.frameId || createId('frame')
    if (!frameMap.has(frameId)) {
      const nextFrame = createVideoFrame(source, {
        id: frameId,
        timeStamp,
        width: source.meta?.width ?? null,
        height: source.meta?.height ?? null,
        duration: source.meta?.duration ?? null,
        createdAt: annotation.createdAt,
      })
      frameMap.set(nextFrame.id, nextFrame)
      nextFrames.push(nextFrame)
    }

    return annotation.frameId === frameId
      ? annotation
      : {
          ...annotation,
          frameId,
        }
  })

  return {
    frames: nextFrames,
    annotations: nextAnnotations,
  }
}

function stripEntityFrameFields(entity = {}) {
  const {
    frame,
    frameId,
    defaultFrame,
    defaultFrameId,
    currentFrame,
    currentFrameId,
    ...rest
  } = entity
  return rest
}

function sanitizeEntityForPersistence(entity = {}) {
  const cleanEntity = stripEntityFrameFields(entity)
  return {
    ...cleanEntity,
    ...createACardPatch(getEntityACardTree(cleanEntity)),
  }
}

function App() {
  const pendingPreviewFrameIdsRef = useRef(new Set())
  const actionHandlersRef = useRef({})
  const appSettingsRef = useRef(DEFAULT_APP_SETTINGS)
  const appCloseDataRef = useRef({ abSessions: [], cWorkspaces: {} })
  const simpleNoteListRef = useRef(null)
  const [source, setSource] = useState(null)
  const [frame, setFrame] = useState(null)
  const [frames, setFrames] = useState([])
  const [message, setMessage] = useState('')
  const [imageSize, setImageSize] = useState(null)
  const [framePreviewUrl, setFramePreviewUrl] = useState('')
  const [framePreviewCache, setFramePreviewCache] = useState({})
  const [selectedFrameId, setSelectedFrameId] = useState(null)
  const [zoomMode, setZoomMode] = useState('fit')
  const [zoom, setZoom] = useState(1)
  const [pdfPage, setPdfPage] = useState(1)
  const [pdfNavigationRequest, setPdfNavigationRequest] = useState(null)
  const [pdfViewMode, setPdfViewMode] = useState('single')
  const [toolMode, setToolMode] = useState('select')
  const [annotations, setAnnotations] = useState([])
  const [simpleNotes, setSimpleNotes] = useState([])
  const [selectedSimpleNoteId, setSelectedSimpleNoteId] = useState(null)
  const [simpleNoteDraft, setSimpleNoteDraft] = useState('')
  const [simpleNoteFilter, setSimpleNoteFilter] = useState('')
  const [simpleNoteReverse, setSimpleNoteReverse] = useState(false)
  const [curStart, setCurStart] = useState('')
  const [curEnd, setCurEnd] = useState('')
  const [abMediaBottomTab, setAbMediaBottomTab] = useState('aPreview')
  const [videoPlaybackInfo, setVideoPlaybackInfo] = useState({
    currentTime: 0,
    duration: null,
    state: 'Paused',
    status: 'Ready',
  })
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState([])
  const [lastPreviewAnnotationId, setLastPreviewAnnotationId] = useState(null)
  const [annotationFilePath, setAnnotationFilePath] = useState('')
  const [saveStatus, setSaveStatus] = useState('Not saved')
  const [editingTextId, setEditingTextId] = useState(null)
  const [textDraft, setTextDraft] = useState('')
  const [leftTab, setLeftTab] = useState('entityFiles')
  const [abInspectorTab, setAbInspectorTab] = useState('source')
  const [recentFiles, setRecentFiles] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(RECENT_FILES_KEY) || '[]')
      if (Array.isArray(saved) && saved.length > 0) {
        return saved.map(normalizeRecentFileItem)
      }
      const legacy = JSON.parse(localStorage.getItem(LEGACY_RECENT_IMAGES_KEY) || '[]')
      return Array.isArray(legacy)
        ? legacy.map(normalizeRecentFileItem)
        : []
    } catch {
      return []
    }
  })
  const [imageFolderPath, setImageFolderPath] = useState('')
  const [imageFolderItems, setImageFolderItems] = useState([])
  const [entities, setEntities] = useState([])
  const [entityMenu, setEntityMenu] = useState(null)
  const [aObjectMenu, setAObjectMenu] = useState(null)
  const [frameMenu, setFrameMenu] = useState(null)
  const [simpleNoteMenu, setSimpleNoteMenu] = useState(null)
  const [expandedAObjectId, setExpandedAObjectId] = useState(null)
  const [expandedInspectorEntityIds, setExpandedInspectorEntityIds] = useState([])
  const [entityDialog, setEntityDialog] = useState(null)
  const [addToEntityDialog, setAddToEntityDialog] = useState(null)
  const [selectedEntityId, setSelectedEntityId] = useState(null)
  const [cWorkspaces, setCWorkspaces] = useState({})
  const [pendingImageSwitch, setPendingImageSwitch] = useState(null)
  const [pendingAnnotationDelete, setPendingAnnotationDelete] = useState(null)
  const [pendingEditorCloseSessionId, setPendingEditorCloseSessionId] = useState(null)
  const [appCloseDialog, setAppCloseDialog] = useState(null)
  const [workspaceTabMenu, setWorkspaceTabMenu] = useState(null)
  const [currentABInput, setCurrentABInput] = useState(null)
  const [pendingABInput, setPendingABInput] = useState(null)
  const [editorWorkspace, setEditorWorkspace] = useState(() => INITIAL_EDITOR_WORKSPACE)
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = useState(() => INITIAL_EDITOR_WORKSPACE.activeId)
  const [compositeRepairRequestId, setCompositeRepairRequestId] = useState(0)
  const [playPauseRequestId, setPlayPauseRequestId] = useState(0)
  const [bindFrameRequest, setBindFrameRequest] = useState(null)
  const [pendingBindFrame, setPendingBindFrame] = useState(null)
  const [bindFrameDialogPosition, setBindFrameDialogPosition] = useState(null)
  const [appSettings, setAppSettings] = useState(DEFAULT_APP_SETTINGS)
  const [cPreviewResources] = useState(() => ({
    annotationFiles: createAnnotationFilePreviewCache(),
    videoFrames: createVideoFramePreviewCache(),
  }))
  const [settingsDialog, setSettingsDialog] = useState(null)
  const [exportResultDialog, setExportResultDialog] = useState(null)
  const [deleteUndoStacks, setDeleteUndoStacks] = useState({})
  const [registeredActions, setRegisteredActions] = useState([])
  const [pendingShortcutCapture, setPendingShortcutCapture] = useState(null)
  const [bindFrameDialogDrag, setBindFrameDialogDrag] = useState(null)
  const [videoSeekRequest, setVideoSeekRequest] = useState(null)
  const [leftPanelWidth, setLeftPanelWidth] = useState(LEFT_PANEL_DEFAULT_WIDTH)
  const [lastLeftPanelWidth, setLastLeftPanelWidth] = useState(LEFT_PANEL_DEFAULT_WIDTH)
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)
  const [resizingPanel, setResizingPanel] = useState(null)
  const [subjectSchemas, setSubjectSchemas] = useState(() => normalizeSubjectSchemas(DOMAIN_SCHEMAS))

  useEffect(() => {
    cPreviewResources.videoFrames.configure({
      maxBytes: appSettings.videoPreviewCacheMaxMB * 1024 * 1024,
      maxConcurrent: appSettings.videoPreviewMaxConcurrentCaptures,
      maxEntries: appSettings.videoPreviewCacheMaxFrames,
    })
  }, [
    appSettings.videoPreviewCacheMaxFrames,
    appSettings.videoPreviewCacheMaxMB,
    appSettings.videoPreviewMaxConcurrentCaptures,
    cPreviewResources,
  ])

  useEffect(() => () => {
    cPreviewResources.annotationFiles.clear()
    cPreviewResources.videoFrames.clear()
  }, [cPreviewResources])

  const formatGeometryValue = (value) => (
    Number.isFinite(value) ? value.toFixed(6) : '--'
  )

  const getSubjectLabel = (subjectId) => getDomainSchema(subjectId, subjectSchemas)?.label || subjectId

  const getKindLabel = (subjectId, kindValue) => {
    const schema = getDomainSchema(subjectId, subjectSchemas)
    return getDomainKind(schema, kindValue)?.label || kindValue
  }

  const getSubKindLabel = (subjectId, kindValue, subKindValue) => {
    if (!subKindValue) return '--'
    const schema = getDomainSchema(subjectId, subjectSchemas)
    return getDomainSubKind(schema, kindValue, subKindValue)?.label || subKindValue
  }

  const getEntityDefaultRole = (entity) => {
    const schema = getDomainSchema(entity.subject, subjectSchemas)
    return getDomainRolesForKind(schema, entity.kind)[0]?.value || 'default'
  }

  const getEntityRuleText = (entity) => {
    const rule = getDomainEntityRoleRule(entity, subjectSchemas)
    return {
      required: rule.requiredRoles.map((role) => role.label).join(', ') || '--',
      optional: rule.optionalRoles.map((role) => role.label).join(', ') || '--',
    }
  }

  const cWorkspaceEntries = Object.entries(cWorkspaces)
  const activeCWorkspaceId = activeWorkspaceTabId.startsWith('c-') ? activeWorkspaceTabId : ''
  const activeCWorkspace = activeCWorkspaceId
    ? cWorkspaces[activeCWorkspaceId] || createEmptyCWorkspace({ cSaveStatus: 'Not saved' })
    : createEmptyCWorkspace({ cSaveStatus: 'Not saved' })
  const firstCWorkspace = cWorkspaceEntries[0]?.[1] || null
  const visibleCWorkspace = activeCWorkspaceId ? activeCWorkspace : firstCWorkspace || createEmptyCWorkspace({ cSaveStatus: 'Not saved' })
  useEffect(() => {
    let canceled = false
    window.labApi?.listSubjectSchemas?.().then(async (listResult) => {
      if (canceled) return
      if (!listResult?.ok) {
        setSubjectSchemas(normalizeSubjectSchemas(DOMAIN_SCHEMAS))
        return
      }

      const readResults = await Promise.all(
        (listResult.files || []).map((file) => window.labApi?.readSubjectSchemaFile?.(file.filePath))
      )
      if (canceled) return
      const schemas = readResults
        .filter((result) => result?.ok && result.data)
        .map((result) => result.data)
      setSubjectSchemas(normalizeSubjectSchemas(schemas))
    })
    return () => {
      canceled = true
    }
  }, [])

  useEffect(() => {
    appSettingsRef.current = appSettings
  }, [appSettings])

  useEffect(() => subscribeActions(setRegisteredActions), [])

  useEffect(() => {
    let canceled = false
    window.labApi?.readSettings?.().then((result) => {
      if (canceled || !result?.ok) return
      setAppSettings(normalizeAppSettings(result.settings))
    })
    const unsubscribe = window.labApi?.onOpenSettings?.(() => {
      setSettingsDialog({
        draft: normalizeAppSettings(appSettingsRef.current),
        error: '',
        filePath: '',
      })
    })
    return () => {
      canceled = true
      unsubscribe?.()
    }
  }, [])

  const workspaceTabs = [
    ...editorWorkspace.sessions.map((session) => {
      const isActive = session.id === editorWorkspace.activeId
      return {
        id: session.id,
        type: 'ab',
        title: isActive
          ? (source?.fileName || getInputTitle(currentABInput))
          : session.title,
        dirty: isActive
          ? isUnsavedSaveStatus(saveStatus)
          : isUnsavedSaveStatus(session.saveStatus),
      }
    }),
    ...cWorkspaceEntries.map(([workspaceId, workspace]) => ({
      id: workspaceId,
      type: 'c',
      title: workspace.cDocument.title || getPathFileName(workspace.cDocumentFilePath) || 'CompositeEditor',
      dirty: isUnsavedSaveStatus(workspace.cSaveStatus),
    })),
  ]

  const saveSettingsDialog = async ({ close = false } = {}) => {
    if (!settingsDialog) return
    const shortcutConflicts = getShortcutConflicts(settingsDialog.draft.shortcuts)
    const hasConflicts = Object.values(shortcutConflicts).some((items) => items.size > 0)
    if (hasConflicts) {
      setSettingsDialog((current) => ({
        ...current,
        error: 'Shortcut conflict',
      }))
      return
    }
    const nextSettings = normalizeAppSettings(settingsDialog.draft)
    const result = await window.labApi?.saveSettings?.(nextSettings)
    if (!result?.ok) {
      setSettingsDialog((current) => ({
        ...current,
        error: `Save failed: ${result?.reason || 'unknown error'}`,
      }))
      return
    }
    setAppSettings(normalizeAppSettings(result.settings))
    if (close) {
      setSettingsDialog(null)
      return
    }
    setSettingsDialog((current) => current
      ? {
          ...current,
          draft: normalizeAppSettings(result.settings),
          error: '',
        }
      : current)
  }

  const patchSettingsDraft = (patch) => {
    setSettingsDialog((current) => current
      ? {
          ...current,
          draft: {
            ...current.draft,
            ...patch,
          },
        }
      : current)
  }

  const setShortcutDraftValue = (scope, actionId, value) => {
    setPendingShortcutCapture(null)
    setSettingsDialog((current) => current
      ? {
          ...current,
          error: '',
          draft: {
            ...current.draft,
            shortcuts: {
              ...current.draft.shortcuts,
              [scope]: {
                ...(current.draft.shortcuts?.[scope] || {}),
                [actionId]: value,
              },
            },
          },
        }
      : current)
  }

  const captureShortcutDraftValue = (scope, actionId, shortcut) => {
    setSettingsDialog((current) => {
      if (!current) return current

      if (
        scope === 'global'
        && pendingShortcutCapture?.scope === scope
        && pendingShortcutCapture?.actionId === actionId
      ) {
        setPendingShortcutCapture(null)
        return {
          ...current,
          error: '',
          draft: {
            ...current.draft,
            shortcuts: {
              ...current.draft.shortcuts,
              [scope]: {
                ...(current.draft.shortcuts?.[scope] || {}),
                [actionId]: `${pendingShortcutCapture.shortcut} ${shortcut}`,
              },
            },
          },
        }
      }

      if (scope === 'global' && shortcut.includes('+')) {
        setPendingShortcutCapture({ scope, actionId, shortcut })
        return {
          ...current,
          error: 'Press second key for chord shortcut',
          draft: {
            ...current.draft,
            shortcuts: {
              ...current.draft.shortcuts,
              [scope]: {
                ...(current.draft.shortcuts?.[scope] || {}),
                [actionId]: shortcut,
              },
            },
          },
        }
      }

      setPendingShortcutCapture(null)
      return {
        ...current,
        error: '',
        draft: {
          ...current.draft,
          shortcuts: {
            ...current.draft.shortcuts,
            [scope]: {
              ...(current.draft.shortcuts?.[scope] || {}),
              [actionId]: shortcut,
            },
          },
        },
      }
    })
  }

  const cancelShortcutCapture = () => {
    setPendingShortcutCapture(null)
    setSettingsDialog((current) => current ? { ...current, error: '' } : current)
  }

  const openSettingsDialog = () => {
    setSettingsDialog({
      draft: normalizeAppSettings(appSettingsRef.current),
      error: '',
      filePath: '',
    })
  }

  const activeWorkspaceTab = workspaceTabs.find((tab) => tab.id === activeWorkspaceTabId)
    || workspaceTabs.find((tab) => tab.id === editorWorkspace.activeId)
    || workspaceTabs[0]

  const activeShortcutScope = activeWorkspaceTab?.type === 'ab'
    ? source?.kind === 'video'
      ? 'video'
      : source?.kind === 'image'
        ? 'picture'
        : source?.kind === 'pdf'
          ? 'pdf'
          : 'global'
    : 'global'

  useShortcutManager(activeShortcutScope, appSettings.shortcuts, Boolean(settingsDialog))

  const getCurrentABUndoContent = () => ({ annotations, entities })
  const getCurrentCUndoContent = () => ({ cDocument: activeCWorkspace.cDocument })
  const activeDeleteUndoKey = activeWorkspaceTab?.type === 'c'
    ? activeCWorkspaceId
    : editorWorkspace.activeId
  const activeDeleteUndoStack = deleteUndoStacks[activeDeleteUndoKey] || []
  const activeDeleteUndoEntry = activeDeleteUndoStack[activeDeleteUndoStack.length - 1] || null
  const activeDeleteUndoContent = activeWorkspaceTab?.type === 'c'
    ? getCurrentCUndoContent()
    : getCurrentABUndoContent()
  const canUndoDelete = Boolean(
    activeDeleteUndoEntry
    && activeDeleteUndoEntry.editorType === activeWorkspaceTab?.type
    && areUndoContentsEqual(activeDeleteUndoContent, activeDeleteUndoEntry.after)
  )
  const pushDeleteUndo = (workspaceId, entry) => {
    if (!workspaceId || !entry?.before || !entry?.after) return
    const safeEntry = cloneUndoValue(entry)
    setDeleteUndoStacks((current) => {
      const existing = current[workspaceId] || []
      const previousEntry = existing[existing.length - 1]
      const compatibleHistory = previousEntry && areUndoContentsEqual(previousEntry.after, safeEntry.before.content)
        ? existing
        : []
      return {
        ...current,
        [workspaceId]: [...compatibleHistory, safeEntry].slice(-MAX_DELETE_UNDO_ENTRIES),
      }
    })
  }

  const clearDeleteUndo = (workspaceId) => {
    if (!workspaceId) return
    setDeleteUndoStacks((current) => {
      if (!current[workspaceId]) return current
      const next = { ...current }
      delete next[workspaceId]
      return next
    })
  }

  const popDeleteUndo = (workspaceId) => {
    setDeleteUndoStacks((current) => {
      const stack = current[workspaceId] || []
      if (stack.length === 0) return current
      const next = { ...current }
      const remaining = stack.slice(0, -1)
      if (remaining.length > 0) next[workspaceId] = remaining
      else delete next[workspaceId]
      return next
    })
  }

  const undoLastDelete = () => {
    const workspaceId = activeDeleteUndoKey
    const entry = activeDeleteUndoEntry
    if (!workspaceId || !entry) return
    const currentContent = entry.editorType === 'c'
      ? getCurrentCUndoContent()
      : getCurrentABUndoContent()
    if (!areUndoContentsEqual(currentContent, entry.after)) {
      clearDeleteUndo(workspaceId)
      setMessage('Undo Delete is unavailable because the document changed after the deletion.')
      return
    }

    if (entry.editorType === 'c') {
      updateCWorkspace(workspaceId, {
        cDocument: cloneUndoValue(entry.before.content.cDocument),
        selectedBIndexItemKey: entry.before.selection?.selectedBIndexItemKey || '',
        selectedCItemId: entry.before.selection?.selectedCItemId || null,
        cSaveStatus: 'Unsaved',
      })
    } else {
      setAnnotations(cloneUndoValue(entry.before.content.annotations))
      setEntities(cloneUndoValue(entry.before.content.entities))
      setSelectedAnnotationIds(entry.before.selection?.selectedAnnotationIds || [])
      setSelectedEntityId(entry.before.selection?.selectedEntityId || null)
      setLastPreviewAnnotationId(entry.before.selection?.lastPreviewAnnotationId || null)
      setSaveStatus('Unsaved')
    }
    popDeleteUndo(workspaceId)
    setMessage(`${entry.label} undone.`)
  }

  const updateCWorkspace = (workspaceId, updater) => {
    setCWorkspaces((current) => {
      const existing = current[workspaceId] || createEmptyCWorkspace()
      const patch = typeof updater === 'function' ? updater(existing) : updater
      return {
        ...current,
        [workspaceId]: {
          ...existing,
          ...patch,
        },
      }
    })
  }

  const updateActiveCWorkspace = (updater) => {
    if (!activeCWorkspaceId) return
    updateCWorkspace(activeCWorkspaceId, updater)
  }

  const updateActiveEditorLayoutState = (patch) => {
    setEditorWorkspace((current) => ({
      ...current,
      sessions: current.sessions.map((session) => (
        session.id === current.activeId
          ? {
              ...session,
              layoutState: {
                ...session.layoutState,
                ...patch,
              },
            }
          : session
      )),
    }))
  }

  const updateActiveCLayoutState = (patch) => {
    if (!activeCWorkspaceId) return
    updateActiveCWorkspace((workspace) => ({
      layoutState: {
        ...workspace.layoutState,
        ...patch,
      },
    }))
  }

  const hasUnsavedCWorkspaceChanges = (workspace = activeCWorkspace) => (
    workspace?.cSaveStatus === 'Unsaved'
  )

  const isEmptyCWorkspace = (workspace) => (
    !workspace?.cDocumentFilePath
    && (workspace?.cDocument?.title || 'Untitled') === 'Untitled'
    && (workspace?.cDocument?.items || []).length === 0
  )

  const requestActivateWorkspaceTab = (workspaceId) => {
    if (workspaceId === activeWorkspaceTabId) return true
    setWorkspaceTabMenu(null)
    if (workspaceId.startsWith('c-')) {
      setActiveWorkspaceTabId(workspaceId)
      return true
    }
    activateEditorSession(workspaceId)
    return true
  }

  const confirmDiscardCWorkspaceChanges = (workspace = activeCWorkspace) => {
    if (!hasUnsavedCWorkspaceChanges(workspace)) return true
    return window.confirm('Current C document has unsaved changes. Discard them?')
  }

  const openWorkspaceTabMenu = (event, tab) => {
    event.preventDefault()
    event.stopPropagation()
    const menuWidth = 112
    const menuHeight = 72
    setWorkspaceTabMenu({
      tabId: tab.id,
      x: clamp(event.clientX + 2, 8, Math.max(8, window.innerWidth - menuWidth - 8)),
      y: clamp(event.clientY + 2, 8, Math.max(8, window.innerHeight - menuHeight - 8)),
    })
  }

  const closeWorkspaceTabMenu = () => setWorkspaceTabMenu(null)

  useEffect(() => {
    if (!resizingPanel) return undefined

    const handleMouseMove = (event) => {
      if (resizingPanel === 'left') {
        const nextWidth = clamp(event.clientX, LEFT_PANEL_MIN_WIDTH, PANEL_MAX_WIDTH)
        setLeftPanelWidth(nextWidth)
        setLastLeftPanelWidth(nextWidth)
        setLeftPanelCollapsed(false)
      }
    }

    const handleMouseUp = () => setResizingPanel(null)

    document.body.classList.add('panel-resizing')
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.body.classList.remove('panel-resizing')
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [resizingPanel])

  useEffect(() => {
    if (!workspaceTabMenu) return undefined

    const closeMenu = () => closeWorkspaceTabMenu()
    const closeMenuOnEscape = (event) => {
      if (event.key === 'Escape') closeWorkspaceTabMenu()
    }

    window.addEventListener('click', closeMenu)
    window.addEventListener('contextmenu', closeMenu)
    window.addEventListener('keydown', closeMenuOnEscape)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('contextmenu', closeMenu)
      window.removeEventListener('keydown', closeMenuOnEscape)
    }
  }, [workspaceTabMenu])

  useEffect(() => {
    if (!bindFrameDialogDrag) return undefined

    const handleMouseMove = (event) => {
      const width = 430
      const height = 260
      setBindFrameDialogPosition({
        x: clamp(event.clientX - bindFrameDialogDrag.offsetX, 8, Math.max(8, window.innerWidth - width - 8)),
        y: clamp(event.clientY - bindFrameDialogDrag.offsetY, 8, Math.max(8, window.innerHeight - height - 8)),
      })
    }

    const handleMouseUp = () => setBindFrameDialogDrag(null)

    document.body.classList.add('panel-resizing')
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.body.classList.remove('panel-resizing')
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [bindFrameDialogDrag])

  const startPanelResize = (panel, event) => {
    event.preventDefault()
    setResizingPanel(panel)
  }

  const toggleLeftPanelCollapsed = () => {
    if (leftPanelCollapsed) {
      setLeftPanelWidth(lastLeftPanelWidth || LEFT_PANEL_DEFAULT_WIDTH)
      setLeftPanelCollapsed(false)
      return
    }
    setLastLeftPanelWidth(leftPanelWidth || LEFT_PANEL_DEFAULT_WIDTH)
    setLeftPanelCollapsed(true)
  }

  const saveRecentFiles = (items) => {
    const normalizedItems = items.map(normalizeRecentFileItem)
    setRecentFiles(normalizedItems)
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(normalizedItems))
  }

  const rememberRecentFile = (fileResult, kind = 'image') => {
    if (!fileResult?.filePath) return
    const nextItem = {
      kind: inferRecentFileKind(fileResult.filePath, kind),
      filePath: fileResult.filePath,
      fileName: fileResult.fileName,
      openedAt: new Date().toISOString(),
    }
    const nextItems = [
      nextItem,
      ...recentFiles.filter((item) => item.filePath !== fileResult.filePath),
    ].slice(0, MAX_RECENT_FILES)
    saveRecentFiles(nextItems)
  }

  const buildCurrentEditorSessionSnapshot = (overrides = {}) => ({
    id: editorWorkspace.activeId,
    title: source?.fileName || getInputTitle(currentABInput),
    input: currentABInput,
    source,
    frame,
    frames: normalizeFrameTimeStamps(source?.kind, frames),
    framePreviewUrl,
    framePreviewCache,
    selectedFrameId,
    message,
    imageSize,
    zoomMode,
    zoom,
    pdfPage,
    pdfViewMode,
    toolMode,
    annotations,
    simpleNotes,
    selectedSimpleNoteId,
    simpleNoteDraft,
    curStart,
    curEnd,
    abMediaBottomTab,
    videoPlaybackInfo,
    selectedAnnotationIds,
    annotationFilePath,
    saveStatus,
    editingTextId,
    textDraft,
    imageFolderPath,
    imageFolderItems,
    entities: entities.map((entity) => sanitizeEntityForPersistence(entity)),
    selectedEntityId,
    layoutState: editorWorkspace.sessions.find((session) => session.id === editorWorkspace.activeId)?.layoutState,
    ...overrides,
  })

  const activeABSessionSnapshot = buildCurrentEditorSessionSnapshot()
  appCloseDataRef.current = {
    abSessions: editorWorkspace.sessions.map((session) => (
      session.id === editorWorkspace.activeId ? activeABSessionSnapshot : session
    )),
    cWorkspaces,
  }

  useEffect(() => {
    const unsubscribe = window.labApi?.onAppCloseRequested?.(() => {
      const items = getUnsavedAppWorkspaceItems(appCloseDataRef.current)
      if (items.length === 0) {
        window.labApi?.confirmAppClose?.()
        return
      }
      setAppCloseDialog({
        error: '',
        items,
        saving: false,
      })
    })
    return () => unsubscribe?.()
  }, [])

  useEffect(() => {
    window.labApi?.updateAppUnsavedState?.(getUnsavedAppWorkspaceItems(appCloseDataRef.current).length > 0)
  }, [cWorkspaces, editorWorkspace, saveStatus])

  const applyEditorSessionSnapshot = (session) => {
    const sessionFrames = normalizeFrameTimeStamps(session.source?.kind, session.frames || [])
    const sessionFrame = sessionFrames.find((item) => item.id === session.frame?.id) || sessionFrames[0] || null
    const sessionAnnotations = normalizeAnnotationTimeStamps(session.source?.kind, session.annotations || [], sessionFrames)
    setMessage(session.message || '')
    setSource(session.source || null)
    setFrame(sessionFrame)
    setFrames(sessionFrames)
    setFramePreviewUrl(session.framePreviewUrl || '')
    setFramePreviewCache(session.framePreviewCache || {})
    setSelectedFrameId(session.selectedFrameId || sessionFrame?.id || null)
    setImageFolderPath(session.imageFolderPath || '')
    setImageFolderItems(session.imageFolderItems || [])
    setImageSize(session.imageSize || null)
    setZoomMode(session.zoomMode || 'fit')
    setZoom(session.zoom || 1)
    setPdfPage(session.pdfPage || 1)
    setPdfNavigationRequest(null)
    setPdfViewMode(session.pdfViewMode || 'single')
    setToolMode(session.toolMode || 'select')
    setAnnotations(sessionAnnotations)
    setSimpleNotes(normalizeSimpleNotes(session.simpleNotes || []))
    setSelectedSimpleNoteId(session.selectedSimpleNoteId || null)
    setSimpleNoteDraft(session.simpleNoteDraft || '')
    setCurStart(session.curStart || '')
    setCurEnd(session.curEnd || '')
    setAbMediaBottomTab(session.abMediaBottomTab || 'aPreview')
    setVideoPlaybackInfo(session.videoPlaybackInfo || {
      currentTime: 0,
      duration: null,
      state: 'Paused',
      status: 'Ready',
    })
    setSelectedAnnotationIds(session.selectedAnnotationIds || [])
    setAnnotationFilePath(session.annotationFilePath || '')
    setSaveStatus(session.saveStatus || 'Not saved')
    setEditingTextId(session.editingTextId || null)
    setTextDraft(session.textDraft || '')
    setEntities((session.entities || []).map((entity) => sanitizeEntityForPersistence(entity)))
    setSelectedEntityId(session.selectedEntityId || null)
    setCurrentABInput(session.input || null)
    setPendingABInput(null)
    setPendingImageSwitch(null)
    setPendingEditorCloseSessionId(null)
    setEntityMenu(null)
    setAObjectMenu(null)
    setFrameMenu(null)
    setSimpleNoteMenu(null)
    setEntityDialog(null)
    setAddToEntityDialog(null)
  }

  const getEditorSessionSnapshot = (sessionId) => (
    sessionId === editorWorkspace.activeId
      ? buildCurrentEditorSessionSnapshot()
      : editorWorkspace.sessions.find((session) => session.id === sessionId)
  )

  const buildAnnotationDocumentFromSession = (session) => {
    const rawSessionAnnotations = session.editingTextId
      ? (session.annotations || []).map((annotation) => (
          annotation.id === session.editingTextId
            ? { ...annotation, text: session.textDraft, updatedAt: new Date().toISOString() }
            : annotation
        ))
      : (session.annotations || [])
    const normalized = ensureFramesForAnnotationTimeStamps(
      session.source,
      session.frames || (session.frame ? [session.frame] : []),
      rawSessionAnnotations,
      appSettings.frameTimestampToleranceSeconds,
    )

    return {
      schemaVersion: 1,
      sources: session.source ? [session.source] : [],
      frames: normalized.frames,
      annotations: normalized.annotations,
      simpleNotes: normalizeSimpleNotes(session.simpleNotes || []),
      entities: (session.entities || []).map((entity) => sanitizeEntityForPersistence(entity)),
      collections: [],
    }
  }

  const saveEditorSessionSnapshot = async (session) => {
    if (!session?.source?.filePath) return false
    const result = await saveAnnotationDocument(
      session.source.filePath,
      buildAnnotationDocumentFromSession(session),
      session.annotationFilePath
    )
    if (result?.ok) {
      clearDeleteUndo(session.id)
      setEditorWorkspace((current) => ({
        ...current,
        sessions: current.sessions.map((item) => (
          item.id === session.id
            ? {
                ...item,
                annotationFilePath: result.annotationFilePath || item.annotationFilePath,
                saveStatus: 'Saved',
              }
            : item
        )),
      }))
    }
    return Boolean(result?.ok)
  }

  const startLoadInCurrentEditor = (input) => {
    const loadInput = {
      ...input,
      loadRequestId: createId('load'),
    }
    setCurrentABInput(input)
    setPendingABInput(loadInput)
  }

  const openInputInNewEditor = (input) => {
    const currentSnapshot = buildCurrentEditorSessionSnapshot()
    const nextSession = createEmptyEditorSession({
      title: getInputTitle(input),
      input,
    })
    setEditorWorkspace((current) => ({
      activeId: nextSession.id,
      sessions: [
        ...current.sessions.map((session) => (
          session.id === current.activeId ? { ...session, ...currentSnapshot } : session
        )),
        nextSession,
      ],
    }))
    setActiveWorkspaceTabId(nextSession.id)
    applyEditorSessionSnapshot(nextSession)
    startLoadInCurrentEditor(input)
  }

  const activateEditorSession = (sessionId) => {
    if (sessionId === editorWorkspace.activeId) {
      setActiveWorkspaceTabId(sessionId)
      return
    }
    const targetSession = editorWorkspace.sessions.find((session) => session.id === sessionId)
    if (!targetSession) return
    const currentSnapshot = buildCurrentEditorSessionSnapshot()
    setEditorWorkspace((current) => ({
      activeId: sessionId,
      sessions: current.sessions.map((session) => (
        session.id === current.activeId ? { ...session, ...currentSnapshot } : session
      )),
    }))
    setActiveWorkspaceTabId(sessionId)
    applyEditorSessionSnapshot(targetSession)
  }

  const closeEditorSession = (sessionId) => {
    clearDeleteUndo(sessionId)
    const currentSnapshot = buildCurrentEditorSessionSnapshot()
    const sessionsWithSnapshot = editorWorkspace.sessions.map((session) => (
      session.id === editorWorkspace.activeId ? { ...session, ...currentSnapshot } : session
    ))
    const closeIndex = sessionsWithSnapshot.findIndex((session) => session.id === sessionId)
    const nextSessions = sessionsWithSnapshot.filter((session) => session.id !== sessionId)

    if (nextSessions.length === 0) {
      const emptySession = createEmptyEditorSession()
      setEditorWorkspace({
        activeId: emptySession.id,
        sessions: [emptySession],
      })
      if (!activeWorkspaceTabId.startsWith('c-')) {
        setActiveWorkspaceTabId(emptySession.id)
      }
      applyEditorSessionSnapshot(emptySession)
      return
    }

    if (sessionId !== editorWorkspace.activeId) {
      setEditorWorkspace({
        activeId: editorWorkspace.activeId,
        sessions: nextSessions,
      })
      if (activeWorkspaceTabId === sessionId) {
        setActiveWorkspaceTabId(editorWorkspace.activeId)
      }
      return
    }

    const nextActiveSession = nextSessions[Math.min(closeIndex, nextSessions.length - 1)]
    setEditorWorkspace({
      activeId: nextActiveSession.id,
      sessions: nextSessions,
    })
    if (!activeWorkspaceTabId.startsWith('c-')) {
      setActiveWorkspaceTabId(nextActiveSession.id)
    }
    applyEditorSessionSnapshot(nextActiveSession)
  }

  const requestCloseEditorSession = (sessionId, event) => {
    event?.stopPropagation()
    const session = getEditorSessionSnapshot(sessionId)
    if (!session) return
    if (session.saveStatus === 'Unsaved') {
      setPendingEditorCloseSessionId(sessionId)
      return
    }
    closeEditorSession(sessionId)
  }

  const confirmEditorClose = async (mode) => {
    const sessionId = pendingEditorCloseSessionId
    if (!sessionId) return
    if (mode === 'cancel') {
      setPendingEditorCloseSessionId(null)
      return
    }

    const session = getEditorSessionSnapshot(sessionId)
    if (!session) {
      setPendingEditorCloseSessionId(null)
      return
    }

    if (mode === 'save') {
      const saved = sessionId === editorWorkspace.activeId
        ? await saveAnnotations()
        : await saveEditorSessionSnapshot(session)
      if (!saved) return
    }

    setPendingEditorCloseSessionId(null)
    closeEditorSession(sessionId)
  }

  const applyImageEditorSession = (session) => {
    clearDeleteUndo(editorWorkspace.activeId)
    const sessionEntities = (session.entities || []).map((entity) => sanitizeEntityForPersistence(entity))
    const targetEntity = sessionEntities.find((entity) => entity.id === session.input?.entityId)
      || sessionEntities[0]
      || null
    const sessionFrames = normalizeFrameTimeStamps(session.source?.kind, session.frames || (session.frame ? [session.frame] : []))
    const sessionFrame = sessionFrames.find((item) => item.id === session.frame?.id) || sessionFrames[0] || null
    const sessionAnnotations = normalizeAnnotationTimeStamps(session.source?.kind, session.annotations, sessionFrames)
    setMessage(session.warning || '')
    setSource(session.source)
    setFrame(sessionFrame)
    setFrames(sessionFrames)
    setFramePreviewUrl(session.source?.kind === 'image' ? session.source.fileUrl : '')
    setFramePreviewCache({})
    setImageFolderPath(session.folderPath)
    setImageFolderItems(session.folderImages)
    setImageSize(null)
    setZoomMode('fit')
    setZoom(1)
    setPdfPage(1)
    setPdfNavigationRequest(null)
    setPdfViewMode('single')
    setToolMode('select')
    setSelectedFrameId(sessionFrame?.id || null)
    setSelectedAnnotationIds([])
    setSimpleNotes(normalizeSimpleNotes(session.simpleNotes || []))
    setSelectedSimpleNoteId(null)
    setSimpleNoteDraft('')
    setCurStart('')
    setCurEnd('')
    setAbMediaBottomTab('aPreview')
    setVideoPlaybackInfo({
      currentTime: 0,
      duration: null,
      state: 'Paused',
      status: 'Ready',
    })
    setEditingTextId(null)
    setEntityMenu(null)
    setAObjectMenu(null)
    setFrameMenu(null)
    setEntityDialog(null)
    setAddToEntityDialog(null)
    setSelectedEntityId(targetEntity?.id || null)
    setAnnotationFilePath(session.annotationFilePath)
    setAnnotations(sessionAnnotations)
    const sessionSimpleNotes = normalizeSimpleNotes(session.simpleNotes || [])
    setSimpleNotes(sessionSimpleNotes)
    setEntities(sessionEntities)
    setSaveStatus(session.saveStatus)
    setCurrentABInput(session.input)
    setPendingABInput(null)
    if (session.input?.fileInfo && ['image', 'video', 'pdf'].includes(session.source?.kind)) {
      rememberRecentFile(session.input.fileInfo, session.source.kind)
    }
  }

  const requestLoadABInput = (input) => {
    if (!input?.sourcePath && !input?.annotationPath) return false
    if (activeWorkspaceTab.type === 'c') {
      openInputInNewEditor(input)
      return false
    }
    setActiveWorkspaceTabId(editorWorkspace.activeId)
    if (
      input.kind === 'image'
      && source?.filePath === input.sourcePath
      && !input.entityId
    ) {
      return true
    }
    if (source) {
      openInputInNewEditor(input)
      return false
    }
    startLoadInCurrentEditor(input)
    return true
  }

  const handleABSessionLoadStart = () => {
    setMessage('')
    setSaveStatus('Loading annotations...')
  }

  const handleABSessionLoadError = (result) => {
    setSaveStatus('Not saved')
    setMessage(`Open source failed: ${result?.reason || 'unknown error'}`)
  }

  const openImage = async () => {
    setMessage('')
    const result = await openImageFile()
    if (!result?.ok) {
      if (!result?.canceled) setMessage('Open image failed.')
      return
    }

    requestLoadABInput(createImageEditorInput(result))
  }

  const openVideo = async () => {
    setMessage('')
    const result = await openVideoFile()
    if (!result?.ok) {
      if (!result?.canceled) setMessage('Open video failed.')
      return
    }

    requestLoadABInput(createVideoEditorInput(result))
  }

  const openPdf = async () => {
    setMessage('')
    const result = await openPdfFile()
    if (!result?.ok) {
      if (!result?.canceled) setMessage(`Open PDF failed: ${result?.reason || 'unknown error'}`)
      return
    }

    requestLoadABInput(createPdfEditorInput(result))
  }

  const requestPlayPauseVideo = () => {
    if (source?.kind !== 'video') return
    setPlayPauseRequestId((current) => current + 1)
  }

  const getCurrentVideoTime = () => {
    const time = Number(videoPlaybackInfo.currentTime)
    return Number.isFinite(time) ? time : 0
  }

  const buildCurrentSimpleNoteRange = () => (
    normalizeSimpleNoteRange({
      start: curStart || formatSimpleNoteTime(getCurrentVideoTime()),
      end: curEnd || formatSimpleNoteTime(getCurrentVideoTime() + 2),
    })
  )

  const selectSimpleNote = (noteId) => {
    const note = simpleNotes.find((item) => item.id === noteId) || null
    setSelectedSimpleNoteId(note?.id || null)
    setSimpleNoteDraft(note?.content || '')
    if (note) setAbMediaBottomTab('simpleNote')
  }

  const setSimpleNoteStartFromPlayback = () => {
    if (source?.kind !== 'video') return
    setCurStart(formatSimpleNoteTime(getCurrentVideoTime()))
  }

  const setSimpleNoteEndFromPlayback = () => {
    if (source?.kind !== 'video') return
    setCurEnd(formatSimpleNoteTime(getCurrentVideoTime()))
  }

  const appendSimpleNoteMark = ({ quick = false } = {}) => {
    if (source?.kind !== 'video') return
    const range = quick
      ? normalizeSimpleNoteRange({
          start: formatSimpleNoteTime(getCurrentVideoTime()),
          end: formatSimpleNoteTime(getCurrentVideoTime() + 2),
        })
      : buildCurrentSimpleNoteRange()
    if (!range) {
      setMessage('Append SimpleNote failed: invalid current range.')
      return
    }

    const note = createSimpleNote({
      ...range,
      content: quick ? 'None' : simpleNoteDraft,
      createdBy: 'User',
    })
    if (!note) return
    setSimpleNotes((current) => [...current, note])
    setSelectedSimpleNoteId(note.id)
    setSimpleNoteDraft(note.content)
    setCurStart(note.start)
    setCurEnd(note.end)
    setAbInspectorTab('simpleNotes')
    setSaveStatus('Unsaved')
  }

  const quickUpdateSimpleNoteRange = () => {
    if (!selectedSimpleNoteId) {
      setMessage('No SimpleNote selected.')
      return
    }
    const range = normalizeSimpleNoteRange({
      start: formatSimpleNoteTime(getCurrentVideoTime()),
      end: formatSimpleNoteTime(getCurrentVideoTime() + 2),
    })
    if (!range) return
    setSimpleNotes((current) => current.map((note) => (
      note.id === selectedSimpleNoteId
        ? { ...note, ...range, updatedAt: new Date().toISOString() }
        : note
    )))
    setCurStart(range.start)
    setCurEnd(range.end)
    setSaveStatus('Unsaved')
  }

  const writeCurrentRangeToSimpleNote = () => {
    if (!selectedSimpleNoteId) {
      setMessage('No SimpleNote selected.')
      return
    }
    const range = normalizeSimpleNoteRange({ start: curStart, end: curEnd })
    if (!range) {
      setMessage('Write Current Range failed: invalid curStart / curEnd.')
      return
    }
    setSimpleNotes((current) => current.map((note) => (
      note.id === selectedSimpleNoteId
        ? { ...note, ...range, updatedAt: new Date().toISOString() }
        : note
    )))
    setSaveStatus('Unsaved')
  }

  const updateSimpleNoteContent = () => {
    if (!selectedSimpleNoteId) {
      setMessage('No SimpleNote selected.')
      return
    }
    setSimpleNotes((current) => current.map((note) => (
      note.id === selectedSimpleNoteId
        ? { ...note, content: simpleNoteDraft, updatedAt: new Date().toISOString() }
        : note
    )))
    setSaveStatus('Unsaved')
  }

  const deleteSimpleNote = (noteId = selectedSimpleNoteId) => {
    if (!noteId) return
    if (!window.confirm('Delete this SimpleNote?')) return
    setSimpleNotes((current) => current.filter((note) => note.id !== noteId))
    if (selectedSimpleNoteId === noteId) {
      setSelectedSimpleNoteId(null)
      setSimpleNoteDraft('')
    }
    setSaveStatus('Unsaved')
  }

  const goToSimpleNote = (noteId = selectedSimpleNoteId) => {
    const note = simpleNotes.find((item) => item.id === noteId)
    if (!note || source?.kind !== 'video') return
    const time = parseTimeText(note.start)
    if (!Number.isFinite(time)) {
      setMessage('SimpleNote GO TO failed: invalid start time.')
      return
    }
    selectSimpleNote(note.id)
    setVideoSeekRequest({
      id: createId('seek'),
      annotationId: null,
      frameId: frame?.id || '',
      time,
    })
  }

  const importVideoNotes = async () => {
    if (source?.kind !== 'video') {
      setMessage('Import is only available for video source.')
      return
    }

    const result = await window.labApi?.importSimpleNotes?.()
    if (!result?.ok) {
      if (!result?.canceled) setMessage(`Import failed: ${result?.reason || 'unknown error'}`)
      return
    }

    const sourceBaseName = getSimpleNoteImportBaseName(source.filePath)
    const importBaseName = getSimpleNoteImportBaseName(result.filePath)
    if (sourceBaseName && importBaseName && sourceBaseName !== importBaseName) {
      const reason = `Import failed: file name mismatch. Current video is "${sourceBaseName}", import file is "${importBaseName}".`
      window.alert(reason)
      setMessage(reason)
      return
    }

    const importedResult = importOldSimpleNotes(result.data, result.filePath)
    if (importedResult.imported.length === 0) {
      setMessage(`Import: no valid item imported. Skipped ${importedResult.skipped}/${importedResult.total}.`)
      return
    }

    const existingKeys = new Set(simpleNotes.map(getSimpleNoteImportKey))
    const duplicateCount = importedResult.imported.filter((note) => existingKeys.has(getSimpleNoteImportKey(note))).length
    let notesToAppend = importedResult.imported
    if (duplicateCount > 0) {
      const allowDuplicate = window.confirm(`Found ${duplicateCount} SimpleNote(s) imported before. Import them again?`)
      if (!allowDuplicate) {
        notesToAppend = importedResult.imported.filter((note) => !existingKeys.has(getSimpleNoteImportKey(note)))
      }
    }

    if (notesToAppend.length === 0) {
      setMessage(`Import canceled for ${duplicateCount} duplicate SimpleNote(s).`)
      return
    }

    setSimpleNotes((current) => [...current, ...notesToAppend])
    const firstImported = notesToAppend[0]
    setSelectedSimpleNoteId(firstImported.id)
    setSimpleNoteDraft(firstImported.content)
    setCurStart(firstImported.start)
    setCurEnd(firstImported.end)
    setAbInspectorTab('simpleNotes')
    setAbMediaBottomTab('simpleNote')
    setSaveStatus('Unsaved')
    setMessage(`Imported ${notesToAppend.length} SimpleNote(s). Skipped ${importedResult.skipped + importedResult.imported.length - notesToAppend.length}.`)
  }

  const seekCurrentVideoBy = (deltaSeconds) => {
    if (source?.kind !== 'video') return
    setVideoSeekRequest({
      id: createId('seek'),
      annotationId: null,
      frameId: frame?.id || '',
      time: Math.max(0, getCurrentVideoTime() + deltaSeconds),
    })
  }

  const useVideoFrame = (nextFrame, videoSize = {}, previewUrl = '', options = {}) => {
    if (!nextFrame) return
    const frameTimeStamp = getFrameTimeStamp(nextFrame)
    const width = videoSize.width || nextFrame.meta?.width || imageSize?.width || null
    const height = videoSize.height || nextFrame.meta?.height || imageSize?.height || null
    const existingFrame = source?.kind === 'video'
      ? findFrameByTimeStamp(frames, frameTimeStamp, appSettings.frameTimestampToleranceSeconds)
      : null
    const targetFrame = existingFrame
      ? {
          ...existingFrame,
          timeStamp: frameTimeStamp ?? getFrameTimeStamp(existingFrame),
          locator: {
            ...existingFrame.locator,
            time: frameTimeStamp ?? getFrameTimeStamp(existingFrame) ?? 0,
          },
          meta: {
            ...existingFrame.meta,
            width: width ?? existingFrame.meta?.width ?? null,
            height: height ?? existingFrame.meta?.height ?? null,
            duration: nextFrame.meta?.duration ?? existingFrame.meta?.duration ?? null,
          },
          updatedAt: new Date().toISOString(),
        }
      : {
          ...nextFrame,
          timeStamp: source?.kind === 'video' ? frameTimeStamp ?? 0 : null,
          locator: source?.kind === 'video'
            ? {
                ...nextFrame.locator,
                time: frameTimeStamp ?? 0,
              }
            : nextFrame.locator || {},
        }
    setFrame(targetFrame)
    setSelectedFrameId(targetFrame.id)
    setFrames((current) => {
      const normalizedCurrent = normalizeFrameTimeStamps(source?.kind, current)
      const currentMatch = source?.kind === 'video'
        ? findFrameByTimeStamp(normalizedCurrent, getFrameTimeStamp(targetFrame), appSettings.frameTimestampToleranceSeconds)
        : null
      const nextFrames = normalizedCurrent.some((item) => item.id === targetFrame.id || item.id === currentMatch?.id)
        ? normalizedCurrent.map((item) => (item.id === targetFrame.id || item.id === currentMatch?.id ? targetFrame : item))
        : [...normalizedCurrent, targetFrame]
      return nextFrames
    })
    setFramePreviewUrl(previewUrl)
    if (previewUrl && width && height) {
      setFramePreviewCache((current) => ({
        ...current,
        [targetFrame.id]: {
          frameId: targetFrame.id,
          ok: true,
          imageUrl: previewUrl,
          imageSize: {
            width,
            height,
          },
          updatedAt: new Date().toISOString(),
        },
      }))
    }
    if (width && height) {
      setImageSize({ width, height })
    }
    setSource((current) => {
      if (!current || current.id !== nextFrame.sourceId) return current
      return {
        ...current,
        meta: {
          ...current.meta,
          width: width ?? current.meta?.width ?? null,
          height: height ?? current.meta?.height ?? null,
          duration: targetFrame.meta?.duration ?? current.meta?.duration ?? null,
        },
        updatedAt: new Date().toISOString(),
      }
    })
    setToolMode('select')
    if (!options.previewOnly) {
      setSaveStatus('Unsaved')
      setMessage(`Using video frame at ${Number(targetFrame.locator?.time || 0).toFixed(2)}s.`)
    }
  }

  const openAnnotation = async () => {
    setMessage('')
    const result = await openAnnotationFile()
    if (!result?.ok) {
      if (!result?.canceled) setMessage(`Open annotation failed: ${result?.reason || 'unknown error'}`)
      return
    }

    requestLoadABInput(createAnnotationEditorInput(result.annotationFilePath, {
      sourcePath: result.sourceFilePath,
      annotationData: result,
    }))
  }

  const openImageByPath = (filePath) => {
    setMessage('')
    requestLoadABInput({
      kind: 'image',
      sourcePath: filePath,
      annotationPath: '',
      entityId: '',
    })
  }

  const openVideoByPath = (filePath) => {
    setMessage('')
    requestLoadABInput({
      kind: 'video',
      sourcePath: filePath,
      annotationPath: '',
      entityId: '',
    })
  }

  const openPdfByPath = (filePath) => {
    setMessage('')
    requestLoadABInput({
      kind: 'pdf',
      sourcePath: filePath,
      annotationPath: '',
      entityId: '',
    })
  }

  const openRecentFile = (item) => {
    const kind = inferRecentFileKind(item?.filePath, item?.kind)
    if (kind === 'video') {
      openVideoByPath(item.filePath)
      return
    }
    if (kind === 'pdf') {
      openPdfByPath(item.filePath)
      return
    }
    openImageByPath(item?.filePath)
  }

  const updatePdfDocumentInfo = ({ pageCount, pageLabels = [] }) => {
    if (source?.kind !== 'pdf') return
    const safePageCount = Math.max(1, Math.round(Number(pageCount) || 1))
    const nextSource = {
      ...source,
      meta: {
        ...source.meta,
        pageCount: safePageCount,
      },
      updatedAt: new Date().toISOString(),
    }
    const frameByPage = new Map((frames || []).map((item) => [getPdfFramePage(item), item]))
    const nextFrames = Array.from({ length: safePageCount }, (_value, index) => {
      const page = index + 1
      const existingFrame = frameByPage.get(page)
      return createPdfPageFrame(nextSource, {
        ...(existingFrame?.meta || {}),
        ...existingFrame,
        physicalPage: page,
        bookPageLabel: pageLabels[page - 1] ?? existingFrame?.meta?.bookPageLabel ?? null,
      })
    })
    const nextPage = clamp(pdfPage, 1, safePageCount)
    const nextFrame = nextFrames[nextPage - 1]
    setSource(nextSource)
    setFrames(nextFrames)
    setPdfPage(nextPage)
    setFrame(nextFrame)
    setSelectedFrameId(nextFrame.id)
    setFramePreviewUrl(framePreviewCache[nextFrame.id]?.imageUrl || '')
  }

  const updatePdfPageInfo = ({ page, width, height, rotation = 0, bookPageLabel = null }) => {
    if (source?.kind !== 'pdf') return
    const pageNumber = Math.max(1, Math.round(Number(page) || 1))
    setFrames((current) => {
      const hasPage = current.some((item) => getPdfFramePage(item) === pageNumber)
      if (!hasPage) {
        return [...current, createPdfPageFrame(source, {
          physicalPage: pageNumber,
          width,
          height,
          rotation,
          bookPageLabel,
        })]
      }
      return current.map((item) => {
        if (getPdfFramePage(item) !== pageNumber) return item
        if (
          item.meta?.width === width
          && item.meta?.height === height
          && item.meta?.rotation === rotation
          && item.meta?.bookPageLabel === bookPageLabel
        ) return item
        return {
          ...item,
          meta: {
            ...item.meta,
            width,
            height,
            rotation,
            bookPageLabel,
          },
          updatedAt: new Date().toISOString(),
        }
      })
    })
    if (pageNumber === pdfPage) {
      setImageSize({ width, height })
      setFrame((current) => current ? {
        ...current,
        meta: {
          ...current.meta,
          width,
          height,
          rotation,
          bookPageLabel,
        },
      } : current)
    }
  }

  const changePdfPage = (page) => {
    if (source?.kind !== 'pdf') return
    const pageCount = Math.max(1, Number(source.meta?.pageCount) || frames.length || 1)
    const nextPage = clamp(Math.round(Number(page) || 1), 1, pageCount)
    const nextFrame = frames.find((item) => getPdfFramePage(item) === nextPage)
      || createPdfPageFrame(source, { physicalPage: nextPage })
    setPdfPage(nextPage)
    setFrame(nextFrame)
    setSelectedFrameId(nextFrame.id)
    setImageSize(nextFrame.meta?.width && nextFrame.meta?.height
      ? { width: nextFrame.meta.width, height: nextFrame.meta.height }
      : null)
  }

  const usePdfPageSnapshot = ({ page, dataUrl, width, height }) => {
    if (source?.kind !== 'pdf' || !dataUrl || !width || !height) return
    const targetFrame = frames.find((item) => getPdfFramePage(item) === page)
      || (getPdfFramePage(frame) === page ? frame : null)
    if (!targetFrame) return
    const preview = {
      frameId: targetFrame.id,
      ok: true,
      imageUrl: dataUrl,
      imageSize: { width, height },
      updatedAt: new Date().toISOString(),
    }
    setFramePreviewCache((current) => ({ ...current, [targetFrame.id]: preview }))
    if (getPdfFramePage(frame) === page) setFramePreviewUrl(dataUrl)
  }

  const changeActiveToolMode = (nextMode) => {
    setToolMode(nextMode)
  }

  const openRelativeImageFromFolder = (delta) => {
    if (source?.kind !== 'image' || imageFolderItems.length === 0) return
    const currentIndex = imageFolderItems.findIndex((item) => item.filePath === source.filePath)
    if (currentIndex < 0) return
    const nextIndex = clamp(currentIndex + delta, 0, imageFolderItems.length - 1)
    const nextItem = imageFolderItems[nextIndex]
    if (!nextItem || nextItem.filePath === source.filePath) return
    openImageByPath(nextItem.filePath)
  }

  const confirmPendingImageSwitch = async (mode) => {
    const target = pendingImageSwitch
    if (!target) return
    if (mode === 'cancel') {
      setPendingImageSwitch(null)
      return
    }
    if (mode === 'save') {
      const saved = await saveAnnotations()
      if (!saved) return
    }
    setPendingImageSwitch(null)
    startLoadInCurrentEditor(target)
  }

  const setFitZoom = () => {
    setZoomMode('fit')
    setZoom(1)
  }

  const setActualSizeZoom = () => {
    setZoomMode('manual')
    setZoom(1)
  }

  const changeZoom = (delta) => {
    setZoomMode('manual')
    setZoom((current) => Math.max(0.1, Math.min(6, Number((current + delta).toFixed(2)))))
  }

  const setManualZoom = (nextZoom) => {
    const numericZoom = Number(nextZoom)
    if (!Number.isFinite(numericZoom)) return
    setZoomMode('manual')
    setZoom(Math.max(0.1, Math.min(6, Number(numericZoom.toFixed(2)))))
  }

  const normalizeNewAnnotation = (annotation) => {
    const timeStamp = source?.kind === 'video' && frame?.kind === 'video-frame'
      ? getFrameTimeStamp(frame)
      : null
    if (
      ((source?.kind === 'video' && frame?.kind === 'video-frame')
        || (source?.kind === 'pdf' && frame?.kind === 'pdf-page'))
      && !annotation.frameId
    ) {
      return {
        ...annotation,
        frameId: frame.id,
        timeStamp,
      }
    }
    return {
      ...annotation,
      timeStamp,
    }
  }

  const addAnnotation = (annotation) => {
    const nextAnnotation = normalizeNewAnnotation(annotation)
    setAnnotations((current) => [...current, nextAnnotation])
    setLastPreviewAnnotationId(nextAnnotation.id)
    setSelectedAnnotationIds([nextAnnotation.id])
    setSaveStatus('Unsaved')
  }

  const addTextAnnotation = (annotation) => {
    const nextAnnotation = normalizeNewAnnotation(annotation)
    setAnnotations((current) => [...current, nextAnnotation])
    setLastPreviewAnnotationId(nextAnnotation.id)
    setSelectedAnnotationIds([nextAnnotation.id])
    setEditingTextId(nextAnnotation.id)
    setTextDraft(nextAnnotation.text || '')
    setSaveStatus('Unsaved')
  }

  const syncSelectedFrameFromAnnotationIds = (annotationIds) => {
    const firstAnnotation = annotations.find((annotation) => annotationIds.includes(annotation.id))
    if (firstAnnotation?.frameId) setSelectedFrameId(firstAnnotation.frameId)
  }

  const selectSingleAnnotation = (annotationId) => {
    if (annotationId) setLastPreviewAnnotationId(annotationId)
    if (annotationId) syncSelectedFrameFromAnnotationIds([annotationId])
    setSelectedAnnotationIds(annotationId ? [annotationId] : [])
  }

  const toggleAnnotationSelection = (annotationId) => {
    if (annotationId) setLastPreviewAnnotationId(annotationId)
    const nextIds = selectedAnnotationIds.includes(annotationId)
      ? selectedAnnotationIds.filter((id) => id !== annotationId)
      : [...selectedAnnotationIds, annotationId]
    syncSelectedFrameFromAnnotationIds(nextIds)
    setSelectedAnnotationIds(nextIds)
  }

  const selectAnnotationsFromChild = (annotationIds) => {
    const nextIds = Array.isArray(annotationIds) ? annotationIds : []
    if (nextIds.length === 1) setLastPreviewAnnotationId(nextIds[0])
    syncSelectedFrameFromAnnotationIds(nextIds)
    setSelectedAnnotationIds(nextIds)
  }

  const selectAnnotationFromEvent = (annotationId, event) => {
    if (event?.evt?.ctrlKey || event?.ctrlKey) {
      toggleAnnotationSelection(annotationId)
      return
    }

    selectSingleAnnotation(annotationId)
  }

  const updateAnnotation = (annotationId, patch) => {
    setAnnotations((current) => current.map((annotation) => (
      annotation.id === annotationId
        ? { ...annotation, ...patch }
        : annotation
    )))
    setSaveStatus('Unsaved')
  }

  const startEditTextAnnotation = (annotationId) => {
    const annotation = annotations.find((item) => item.id === annotationId)
    if (!annotation || annotation.type !== 'text') return
    selectSingleAnnotation(annotationId)
    setEditingTextId(annotationId)
    setTextDraft(annotation.text || '')
  }

  const commitTextEdit = () => {
    if (!editingTextId) return
    updateAnnotation(editingTextId, {
      text: textDraft,
      updatedAt: new Date().toISOString(),
    })
    setEditingTextId(null)
  }

  const cancelTextEdit = () => {
    setEditingTextId(null)
    setTextDraft('')
  }

  const clearSelection = () => {
    if (editingTextId) commitTextEdit()
    setSelectedAnnotationIds([])
    setEntityMenu(null)
  }

  const deleteSelectedAnnotation = useCallback(() => {
    if (selectedAnnotationIds.length === 0) return
    const annotationIds = [...selectedAnnotationIds]
    const selectedIdSet = new Set(annotationIds)
    const typeCounts = annotations.reduce((counts, annotation) => {
      if (!selectedIdSet.has(annotation.id)) return counts
      const type = annotation.type || 'unknown'
      counts[type] = (counts[type] || 0) + 1
      return counts
    }, {})
    const typeLabels = {
      arrow: 'Arrow',
      polygon: 'Polygon',
      rect: 'Rect',
      text: 'Text',
      unknown: 'Unknown',
    }
    const typeSummary = Object.entries(typeCounts)
      .map(([type, count]) => `${typeLabels[type] || type} × ${count}`)
      .join(', ')
    const referencedEntityCount = entities.reduce((count, entity) => {
      const usesSelectedObject = flattenACardTree(getEntityACardTree(entity))
        .some((card) => selectedIdSet.has(card.aObjectId))
      return count + (usesSelectedObject ? 1 : 0)
    }, 0)

    setPendingAnnotationDelete({
      annotationIds,
      objectCount: annotationIds.length,
      referencedEntityCount,
      typeSummary,
    })
  }, [annotations, entities, selectedAnnotationIds])

  const confirmDeleteSelectedAnnotations = () => {
    if (!pendingAnnotationDelete) return
    const annotationIds = pendingAnnotationDelete.annotationIds || []
    if (annotationIds.length === 0) {
      setPendingAnnotationDelete(null)
      return
    }
    const nextAnnotations = annotations.filter((annotation) => !annotationIds.includes(annotation.id))
    const nextEntities = entities.map((entity) => ({
      ...entity,
      ...createACardPatch(removeACardsByAObjectIds(getEntityACardTree(entity), annotationIds)),
    }))
    pushDeleteUndo(editorWorkspace.activeId, {
      editorType: 'ab',
      label: `Delete ${annotationIds.length} A Object${annotationIds.length === 1 ? '' : 's'}`,
      before: {
        content: cloneUndoValue(getCurrentABUndoContent()),
        selection: {
          selectedAnnotationIds: [...selectedAnnotationIds],
          selectedEntityId,
          lastPreviewAnnotationId,
        },
      },
      after: cloneUndoValue({ annotations: nextAnnotations, entities: nextEntities }),
    })
    setAnnotations(nextAnnotations)
    setEntities(nextEntities)
    setLastPreviewAnnotationId((current) => (
      annotationIds.includes(current) ? null : current
    ))
    setSelectedAnnotationIds([])
    setPendingAnnotationDelete(null)
    setSaveStatus('Unsaved')
  }

  useEffect(() => {
    const handleKeyDown = (event) => {
      const target = event.target
      const targetTag = target?.tagName?.toLowerCase()
      if (targetTag === 'textarea' || targetTag === 'input' || targetTag === 'select' || target?.isContentEditable) return
      if (event.key !== 'Delete') return
      if (selectedAnnotationIds.length === 0 || pendingAnnotationDelete) return
      event.preventDefault()
      deleteSelectedAnnotation()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [deleteSelectedAnnotation, pendingAnnotationDelete, selectedAnnotationIds])

  const requestBindSelectedAnnotationsToCurrentPlaybackFrame = () => {
    if (source?.kind !== 'video') {
      setMessage('Bind failed: current source is not a video.')
      return
    }
    if (selectedAnnotationIds.length === 0) return
    setBindFrameRequest({
      id: createId('bind_frame'),
      annotationIds: [...selectedAnnotationIds],
    })
  }

  const openBindFrameConfirmDialog = ({
    annotationIds = [],
    duration = null,
    previewUrl = '',
    time,
    videoSize = {},
  }) => {
    if (source?.kind !== 'video' || !Number.isFinite(time) || annotationIds.length === 0) {
      setMessage('Bind failed: current playback frame is not available.')
      return
    }
    setPendingBindFrame({
      annotationIds,
      duration,
      previewUrl,
      time,
      videoSize,
    })
  }

  const adjustPendingBindFrameTime = (delta) => {
    if (!pendingBindFrame) return
    const nextTime = Math.max(0, Number(pendingBindFrame.time || 0) + delta)
    setBindFrameRequest({
      id: createId('bind_frame'),
      annotationIds: [...pendingBindFrame.annotationIds],
      time: nextTime,
    })
  }

  const confirmBindFrame = () => {
    if (!pendingBindFrame) return
    const {
      annotationIds = [],
      duration = null,
      previewUrl = '',
      time,
      videoSize = {},
    } = pendingBindFrame
    if (source?.kind !== 'video' || !Number.isFinite(time) || annotationIds.length === 0) {
      setPendingBindFrame(null)
      setMessage('Bind failed: current playback frame is not available.')
      return
    }
    const existingFrame = findFrameByTimeStamp(frames, time, appSettings.frameTimestampToleranceSeconds)
    const nextFrame = existingFrame
      ? {
          ...existingFrame,
          timeStamp: time,
          locator: {
            ...existingFrame.locator,
            time,
          },
          meta: {
            ...existingFrame.meta,
            width: videoSize.width || existingFrame.meta?.width || source.meta?.width || imageSize?.width || null,
            height: videoSize.height || existingFrame.meta?.height || source.meta?.height || imageSize?.height || null,
            duration: duration ?? existingFrame.meta?.duration ?? source.meta?.duration ?? null,
          },
          updatedAt: now,
        }
      : createVideoFrame(source, {
          timeStamp: time,
          width: videoSize.width || source.meta?.width || imageSize?.width || null,
          height: videoSize.height || source.meta?.height || imageSize?.height || null,
          duration: duration ?? source.meta?.duration ?? null,
        })
    const width = videoSize.width || nextFrame.meta?.width || imageSize?.width || null
    const height = videoSize.height || nextFrame.meta?.height || imageSize?.height || null
    const selectedIdSet = new Set(annotationIds)
    const now = new Date().toISOString()
    setAnnotations((current) => current.map((annotation) => (
      selectedIdSet.has(annotation.id)
        ? {
            ...annotation,
            frameId: nextFrame.id,
            timeStamp: time,
            updatedAt: now,
          }
        : annotation
    )))
    setFrames((current) => {
      const normalizedCurrent = normalizeFrameTimeStamps(source?.kind, current)
      return normalizedCurrent.some((item) => item.id === nextFrame.id)
        ? normalizedCurrent.map((item) => (item.id === nextFrame.id ? nextFrame : item))
        : [...normalizedCurrent, nextFrame]
    })
    setFrame(nextFrame)
    setSelectedFrameId(nextFrame.id)
    if (previewUrl && width && height) {
      setFramePreviewUrl(previewUrl)
      setFramePreviewCache((current) => ({
        ...current,
        [nextFrame.id]: {
          frameId: nextFrame.id,
          ok: true,
          imageUrl: previewUrl,
          imageSize: { width, height },
          updatedAt: now,
        },
      }))
    }
    if (width && height) setImageSize({ width, height })
    setSaveStatus('Unsaved')
    setPendingBindFrame(null)
    setMessage(`Bound ${annotationIds.length} A object(s) to current playback frame ${formatTime(time)}.`)
  }

  const cancelBindFrame = () => {
    setPendingBindFrame(null)
  }

  const getBindFrameDialogPosition = () => {
    const width = 430
    const defaultX = Math.max(8, window.innerWidth - width - 18)
    const defaultY = 84
    return bindFrameDialogPosition || {
      x: clamp(defaultX, 8, Math.max(8, window.innerWidth - width - 8)),
      y: defaultY,
    }
  }

  const startBindFrameDialogDrag = (event) => {
    const position = getBindFrameDialogPosition()
    setBindFrameDialogPosition(position)
    setBindFrameDialogDrag({
      offsetX: event.clientX - position.x,
      offsetY: event.clientY - position.y,
    })
  }

  const buildAnnotationDocument = () => {
    const rawAnnotations = editingTextId
      ? annotations.map((annotation) => (
          annotation.id === editingTextId
            ? { ...annotation, text: textDraft, updatedAt: new Date().toISOString() }
            : annotation
        ))
      : annotations
    const normalized = ensureFramesForAnnotationTimeStamps(source, frames, rawAnnotations, appSettings.frameTimestampToleranceSeconds)

    return {
      schemaVersion: 1,
      sources: source ? [source] : [],
      frames: normalized.frames,
      annotations: normalized.annotations,
      simpleNotes: normalizeSimpleNotes(simpleNotes),
      entities: entities.map((entity) => sanitizeEntityForPersistence(entity)),
      collections: [],
    }
  }

  const saveAnnotations = async () => {
    if (!source) return false
    setSaveStatus('Saving...')
    const result = await saveAnnotationDocument(source.filePath, buildAnnotationDocument(), annotationFilePath)

    if (result?.ok) {
      clearDeleteUndo(editorWorkspace.activeId)
      setAnnotationFilePath(result.annotationFilePath || annotationFilePath)
      setSaveStatus('Saved')
      return true
    }

    setSaveStatus(`Save failed: ${result?.reason || 'unknown error'}`)
    return false
  }

  actionHandlersRef.current = {
    appendSimpleNoteMark,
    changeZoom,
    deleteSelectedAnnotation,
    deleteSimpleNote,
    goToSimpleNote,
    importVideoNotes,
    undoLastDelete,
    openAnnotation,
    openImage,
    openPdf,
    openRelativeImageFromFolder,
    openSettingsDialog,
    openVideo,
    quickUpdateSimpleNoteRange,
    requestPlayPauseVideo,
    saveAnnotations,
    seekCurrentVideoBy,
    setActualSizeZoom,
    setFitZoom,
    setSimpleNoteEndFromPlayback,
    setSimpleNoteStartFromPlayback,
    setToolMode: changeActiveToolMode,
    updateSimpleNoteContent,
    writeCurrentRangeToSimpleNote,
  }

  useEffect(() => {
    const unregister = registerActions([
      { id: 'ab.aObject.goTo', handler: () => actionHandlersRef.current.goToAObjectFromMenu?.() },
      { id: 'ab.frame.goTo', handler: () => actionHandlersRef.current.goToFrameFromMenu?.() },
      { id: 'ab.entity.goTo', handler: () => actionHandlersRef.current.goToEntityFromMenu?.() },
      { id: 'global.undoDelete', handler: () => actionHandlersRef.current.undoLastDelete?.() },
      { id: 'global.openSettings', handler: () => actionHandlersRef.current.openSettingsDialog?.() },
      { id: 'global.openSchemaEditor', handler: () => window.labApi?.openSchemaEditor?.() },
      { id: 'pdf.openPdf', handler: () => actionHandlersRef.current.openPdf?.() },
      { id: 'picture.openImage', handler: () => actionHandlersRef.current.openImage?.() },
      { id: 'picture.openAnnotation', handler: () => actionHandlersRef.current.openAnnotation?.() },
      { id: 'picture.saveJson', handler: () => actionHandlersRef.current.saveAnnotations?.() },
      { id: 'picture.previous', handler: () => actionHandlersRef.current.openRelativeImageFromFolder?.(-1) },
      { id: 'picture.next', handler: () => actionHandlersRef.current.openRelativeImageFromFolder?.(1) },
      { id: 'picture.tool.select', handler: () => actionHandlersRef.current.setToolMode?.('select') },
      { id: 'picture.tool.rect', handler: () => actionHandlersRef.current.setToolMode?.('rect') },
      { id: 'picture.tool.arrow', handler: () => actionHandlersRef.current.setToolMode?.('arrow') },
      { id: 'picture.tool.polygon', handler: () => actionHandlersRef.current.setToolMode?.('polygon') },
      { id: 'picture.tool.text', handler: () => actionHandlersRef.current.setToolMode?.('text') },
      { id: 'picture.deleteSelected', handler: () => actionHandlersRef.current.deleteSelectedAnnotation?.() },
      { id: 'picture.zoom.fit', handler: () => actionHandlersRef.current.setFitZoom?.() },
      { id: 'picture.zoom.actual', handler: () => actionHandlersRef.current.setActualSizeZoom?.() },
      { id: 'picture.zoom.out', handler: () => actionHandlersRef.current.changeZoom?.(-0.1) },
      { id: 'picture.zoom.in', handler: () => actionHandlersRef.current.changeZoom?.(0.1) },
      { id: 'video.openVideo', handler: () => actionHandlersRef.current.openVideo?.() },
      { id: 'video.openAnnotation', handler: () => actionHandlersRef.current.openAnnotation?.() },
      { id: 'video.saveJson', handler: () => actionHandlersRef.current.saveAnnotations?.() },
      { id: 'video.playPause', handler: () => actionHandlersRef.current.requestPlayPauseVideo?.() },
      { id: 'video.longBack', handler: () => actionHandlersRef.current.seekCurrentVideoBy?.(-10) },
      { id: 'video.longForward', handler: () => actionHandlersRef.current.seekCurrentVideoBy?.(10) },
      { id: 'video.simpleNote.setStart', handler: () => actionHandlersRef.current.setSimpleNoteStartFromPlayback?.() },
      { id: 'video.simpleNote.setEnd', handler: () => actionHandlersRef.current.setSimpleNoteEndFromPlayback?.() },
      { id: 'video.simpleNote.appendMark', handler: () => actionHandlersRef.current.appendSimpleNoteMark?.() },
      { id: 'video.simpleNote.appendQuickMark', handler: () => actionHandlersRef.current.appendSimpleNoteMark?.({ quick: true }) },
      { id: 'video.simpleNote.quickUpdateRange', handler: () => actionHandlersRef.current.quickUpdateSimpleNoteRange?.() },
      { id: 'video.simpleNote.writeCurrentRange', handler: () => actionHandlersRef.current.writeCurrentRangeToSimpleNote?.() },
      { id: 'video.simpleNote.updateContent', handler: () => actionHandlersRef.current.updateSimpleNoteContent?.() },
      { id: 'video.simpleNote.goTo', handler: () => actionHandlersRef.current.goToSimpleNote?.() },
      { id: 'video.simpleNote.delete', handler: () => actionHandlersRef.current.deleteSimpleNote?.() },
      { id: 'video.simpleNote.import', handler: () => actionHandlersRef.current.importVideoNotes?.() },
    ])
    return unregister
  }, [])

  const showExportResult = ({
    title,
    result = null,
    outputFolder = '',
    requestedCount = 0,
    entityCount = 0,
    aObjectCount = 0,
    otherItemCount = 0,
    reason = '',
  }) => {
    const exported = Array.isArray(result?.exported) ? result.exported : []
    const successCount = exported.filter((item) => item.ok).length
    const failedCount = exported.length > 0
      ? exported.length - successCount
      : result?.ok ? 0 : Math.max(1, requestedCount)
    const reasons = Array.from(new Set([
      ...exported.filter((item) => !item.ok).map((item) => item.reason),
      reason,
      result?.reason,
    ].filter(Boolean)))
    const status = successCount > 0 && failedCount > 0
      ? 'partial'
      : result?.ok && failedCount === 0
        ? 'success'
        : 'failed'

    setExportResultDialog({
      title,
      status,
      folderPath: result?.folderPath || outputFolder || '',
      requestedCount: exported.length || Math.max(requestedCount, result?.ok ? 0 : 1),
      successCount,
      failedCount,
      entityCount,
      aObjectCount,
      otherItemCount,
      reasons,
    })
  }

  const chooseExportFolder = async () => {
    const result = await window.labApi?.chooseExportFolder?.()
    if (!result?.ok) {
      if (!result?.canceled) setMessage(`Choose export folder failed: ${result?.reason || 'unknown error'}`)
      return ''
    }
    return result.folderPath || ''
  }

  const exportTasks = async ({
    outputFolder,
    tasks,
    entity = null,
    frameImages = [],
    mode = 'items',
    summary = {},
  }) => {
    if (!source?.filePath || !outputFolder || tasks.length === 0) {
      showExportResult({
        ...summary,
        outputFolder,
        requestedCount: tasks.length,
        reason: 'invalid-export-request',
      })
      return false
    }
    try {
      const result = await window.labApi?.exportAnnotationCrops?.({
        sourceKind: source.kind,
        sourceFilePath: source.filePath,
        outputFolder,
        entity,
        frameImages,
        mode,
        tasks,
      })
      const okCount = result?.exported?.filter((item) => item.ok).length || 0
      const totalCount = result?.exported?.length || tasks.length
      const failedCount = totalCount - okCount
      if (result?.ok) {
        setMessage(`Exported ${okCount}/${totalCount} item(s) to ${result.folderPath}${failedCount ? ' ; see _export_errors.txt' : ''}`)
      } else {
        setMessage(`Export failed: ${result?.reason || 'unknown error'}`)
      }
      showExportResult({
        ...summary,
        result,
        outputFolder,
        requestedCount: tasks.length,
      })
      return Boolean(result?.ok)
    } catch (error) {
      const reason = error?.message || String(error)
      setMessage(`Export failed: ${reason}`)
      showExportResult({
        ...summary,
        outputFolder,
        requestedCount: tasks.length,
        reason,
      })
      return false
    }
  }

  const prepareAnnotationExportBatch = async (entries = []) => {
    const snapshotPromises = new Map()
    const frameImagesById = new Map()

    const getMediaSnapshot = (annotation) => {
      const mediaTarget = source?.kind === 'pdf'
        ? getAnnotationPdfTarget(annotation)
        : getAnnotationVideoTarget(annotation)
      if (!mediaTarget) {
        return Promise.resolve({ ok: false, reason: 'media-frame-target-unavailable' })
      }

      const frameId = mediaTarget.frame.id
      if (snapshotPromises.has(frameId)) return snapshotPromises.get(frameId)

      const cached = framePreviewCache[frameId]
      if (source?.kind !== 'pdf' && cached?.imageUrl && cached?.imageSize) {
        const cachedResult = Promise.resolve({
          ok: true,
          frameId,
          imageUrl: cached.imageUrl,
          imageSize: cached.imageSize,
        })
        snapshotPromises.set(frameId, cachedResult)
        return cachedResult
      }

      if (source?.kind === 'video' && frame?.id === frameId && framePreviewUrl && imageSize) {
        const currentResult = Promise.resolve({
          ok: true,
          frameId,
          imageUrl: framePreviewUrl,
          imageSize,
        })
        snapshotPromises.set(frameId, currentResult)
        return currentResult
      }

      const capturePromise = source?.kind === 'pdf'
        ? capturePdfPageSnapshot({
            src: source.fileUrl,
            page: mediaTarget.page,
            renderScale: 2,
          })
        : captureVideoFrameSnapshot({
            src: source?.fileUrl,
            time: mediaTarget.time,
          })
      const snapshotPromise = capturePromise.then((result) => {
        if (!result?.ok) return result
        const normalizedResult = {
          ok: true,
          frameId,
          imageUrl: result.previewUrl,
          imageSize: result.imageSize,
        }
        setFramePreviewCache((current) => ({
          ...current,
          [frameId]: normalizedResult,
        }))
        return normalizedResult
      })
      snapshotPromises.set(frameId, snapshotPromise)
      return snapshotPromise
    }

    const prepared = await Promise.all(entries.map(async ({ annotation, options = {} }) => {
      if (!annotation) return { ok: false, reason: 'annotation-not-found' }

      if (!['video', 'pdf'].includes(source?.kind) || annotation.type === 'text') {
        const task = createAnnotationExportTask(annotation, imageSize, options)
        return task ? { ok: true, task } : { ok: false, reason: 'invalid-a-object' }
      }

      const snapshot = await getMediaSnapshot(annotation)
      if (!snapshot?.ok || !snapshot.imageUrl || !snapshot.imageSize) {
        return {
          ok: false,
          reason: snapshot?.reason || 'media-frame-snapshot-failed',
        }
      }

      const task = createAnnotationExportTask(annotation, snapshot.imageSize, options)
      if (!task) return { ok: false, reason: 'invalid-a-object' }
      frameImagesById.set(snapshot.frameId, {
        frameId: snapshot.frameId,
        dataUrl: snapshot.imageUrl,
      })
      return {
        ok: true,
        task: {
          ...task,
          sourceFrameId: snapshot.frameId,
        },
      }
    }))

    const failed = prepared.find((item) => !item.ok)
    if (failed) return { ok: false, reason: failed.reason }
    return {
      ok: true,
      tasks: prepared.map((item) => item.task),
      frameImages: [...frameImagesById.values()],
    }
  }

  const exportSingleAnnotationCrop = async (annotationIds = selectedAnnotationIds) => {
    if (!source || annotationIds.length !== 1) return false
    const annotation = annotations.find((item) => item.id === annotationIds[0])
    if (!annotation) return false
    const outputFolder = await chooseExportFolder()
    if (!outputFolder) return false
    setMessage(source.kind === 'video' ? 'Preparing video frame for export...' : 'Preparing export...')
    const prepared = await prepareAnnotationExportBatch([{ annotation }])
    if (!prepared.ok) {
      setMessage(`Export failed: ${prepared.reason}`)
      showExportResult({
        title: 'Export Crop',
        outputFolder,
        requestedCount: 1,
        aObjectCount: 1,
        reason: prepared.reason,
      })
      return false
    }
    return exportTasks({
      outputFolder,
      tasks: prepared.tasks,
      frameImages: prepared.frameImages,
      mode: 'single-a-object',
      summary: {
        title: 'Export Crop',
        aObjectCount: 1,
      },
    })
  }

  const exportEntityCrops = async (
    entity = entities.find((item) => item.id === selectedEntityId) || null,
    selectedCards = null,
  ) => {
    if (!source || !entity) return false
    const selectedMode = Array.isArray(selectedCards)
    const refs = selectedMode
      ? selectedCards.map((card) => ({
          aObjectId: card.aObjectId,
          role: card.role,
        }))
      : getEntityAObjectRefs(entity)
    const exportTitle = selectedMode ? 'Export Selected' : 'Export Entity'
    const entries = refs.map((ref, index) => {
      const annotation = annotations.find((item) => item.id === ref.aObjectId)
      return {
        annotation,
        options: {
          index,
          role: ref.role,
        },
      }
    })
    if (entries.length === 0) {
      setMessage('Export failed: current Entity has no exportable A object.')
      showExportResult({
        title: exportTitle,
        requestedCount: 0,
        entityCount: 1,
        reason: 'current Entity has no exportable A object',
      })
      return false
    }
    const outputFolder = await chooseExportFolder()
    if (!outputFolder) return false
    setMessage(source.kind === 'video' ? 'Preparing video frames for export...' : 'Preparing export...')
    const prepared = await prepareAnnotationExportBatch(entries)
    if (!prepared.ok) {
      setMessage(`Export failed: ${prepared.reason}`)
      showExportResult({
        title: exportTitle,
        outputFolder,
        requestedCount: entries.length,
        entityCount: 1,
        aObjectCount: entries.length,
        reason: prepared.reason,
      })
      return false
    }
    return exportTasks({
      outputFolder,
      tasks: prepared.tasks,
      frameImages: prepared.frameImages,
      mode: selectedMode ? 'selected-entity-items' : 'entity',
      summary: {
        title: exportTitle,
        entityCount: 1,
        aObjectCount: entries.length,
      },
      entity: {
        id: entity.id,
        label: entity.label,
      },
    })
  }

  const exportSelectedEntityItems = (entity, selectedCards) => (
    exportEntityCrops(entity, selectedCards)
  )

  const editingTextAnnotation = editingTextId
    ? annotations.find((annotation) => annotation.id === editingTextId && annotation.type === 'text')
    : null

  const getAnnotationSummary = (annotation) => {
    if (annotation.type === 'rect') {
      return `x:${formatGeometryValue(annotation.geometry.x)} y:${formatGeometryValue(annotation.geometry.y)}`
    }
    if (annotation.type === 'arrow') {
      return `(${formatGeometryValue(annotation.geometry.x1)}, ${formatGeometryValue(annotation.geometry.y1)}) -> (${formatGeometryValue(annotation.geometry.x2)}, ${formatGeometryValue(annotation.geometry.y2)})`
    }
    if (annotation.type === 'text') {
      return annotation.text || 'FreeText'
    }
    if (annotation.type === 'polygon') {
      return `${annotation.geometry?.points?.length || 0} vertices`
    }
    return annotation.id
  }

  const getAnnotationFrame = useCallback((annotation) => {
    if (!annotation) return null
    const matchedFrame = frames.find((item) => item.id === annotation.frameId)
    if (matchedFrame) return matchedFrame
    if (frame?.id === annotation.frameId) return frame
    const timeStamp = Number(annotation.timeStamp)
    if (source?.kind === 'video' && Number.isFinite(timeStamp)) {
      return {
        id: annotation.frameId || `frame_timestamp_${annotation.id}`,
        sourceId: source.id,
        kind: 'video-frame',
        locator: {
          time: timeStamp,
        },
        meta: {
          width: source.meta?.width ?? imageSize?.width ?? null,
          height: source.meta?.height ?? imageSize?.height ?? null,
          duration: source.meta?.duration ?? null,
        },
        virtual: true,
      }
    }

    return null
  }, [frame, frames, imageSize?.height, imageSize?.width, source])

  const getAnnotationVideoTarget = useCallback((annotation) => {
    if (source?.kind !== 'video') return null
    const annotationFrame = getAnnotationFrame(annotation)
    if (annotationFrame?.kind !== 'video-frame') return null
    const time = Number(annotationFrame.locator?.time)
    if (!Number.isFinite(time)) return null
    return {
      frame: annotationFrame,
      time,
    }
  }, [getAnnotationFrame, source?.kind])

  const getAnnotationPdfTarget = useCallback((annotation) => {
    if (source?.kind !== 'pdf') return null
    const annotationFrame = getAnnotationFrame(annotation)
    const page = getPdfFramePage(annotationFrame)
    return page ? { frame: annotationFrame, page } : null
  }, [getAnnotationFrame, source?.kind])

  const getAnnotationPreview = (annotation) => {
    if (!annotation) return null
    if (source?.kind === 'image') {
      return {
        imageUrl: source.fileUrl,
        imageSize,
      }
    }
    if (source?.kind === 'pdf') {
      const pdfTarget = getAnnotationPdfTarget(annotation)
      if (!pdfTarget) return null
      const cachedPreview = framePreviewCache[pdfTarget.frame.id]
      if (cachedPreview?.imageUrl && cachedPreview?.imageSize) return cachedPreview
      if (cachedPreview?.ok === false) return cachedPreview
      return null
    }
    const videoTarget = getAnnotationVideoTarget(annotation)
    if (!videoTarget) return null
    const cachedPreview = framePreviewCache[videoTarget.frame.id]
    if (cachedPreview?.imageUrl && cachedPreview?.imageSize) return cachedPreview
    if (cachedPreview?.ok === false) {
      return {
        frameId: videoTarget.frame.id,
        ok: false,
        reason: cachedPreview.reason || 'frame-preview-failed',
      }
    }
    if (frame?.id === videoTarget.frame.id && framePreviewUrl && imageSize) {
      return {
        frameId: videoTarget.frame.id,
        imageUrl: framePreviewUrl,
        imageSize,
      }
    }
    return null
  }

  const ensureAnnotationPreview = useCallback((annotation) => {
    if (!annotation || !source?.fileUrl || !['video', 'pdf'].includes(source.kind)) return
    if (source.kind === 'pdf') {
      const pdfTarget = getAnnotationPdfTarget(annotation)
      if (!pdfTarget) return
      if (framePreviewCache[pdfTarget.frame.id]?.imageUrl) return
      if (framePreviewCache[pdfTarget.frame.id]?.ok === false) return
      if (pendingPreviewFrameIdsRef.current.has(pdfTarget.frame.id)) return
      pendingPreviewFrameIdsRef.current.add(pdfTarget.frame.id)
      capturePdfPageSnapshot({ src: source.fileUrl, page: pdfTarget.page, renderScale: 2 })
        .then((result) => {
          setFramePreviewCache((current) => ({
            ...current,
            [pdfTarget.frame.id]: result?.ok
              ? {
                  frameId: pdfTarget.frame.id,
                  ok: true,
                  imageUrl: result.previewUrl,
                  imageSize: result.imageSize,
                  updatedAt: new Date().toISOString(),
                }
              : {
                  frameId: pdfTarget.frame.id,
                  ok: false,
                  reason: result?.reason || 'pdf-page-snapshot-failed',
                  updatedAt: new Date().toISOString(),
                },
          }))
        })
        .finally(() => pendingPreviewFrameIdsRef.current.delete(pdfTarget.frame.id))
      return
    }
    const videoTarget = getAnnotationVideoTarget(annotation)
    if (!videoTarget) return
    if (framePreviewCache[videoTarget.frame.id]?.imageUrl) return
    if (framePreviewCache[videoTarget.frame.id]?.ok === false) return
    if (pendingPreviewFrameIdsRef.current.has(videoTarget.frame.id)) return

    pendingPreviewFrameIdsRef.current.add(videoTarget.frame.id)
    captureVideoFrameSnapshot({
      src: source.fileUrl,
      time: videoTarget.time,
    }).then((result) => {
      if (!result?.ok) {
        setFramePreviewCache((current) => ({
          ...current,
          [videoTarget.frame.id]: {
            frameId: videoTarget.frame.id,
            ok: false,
            reason: result?.reason || 'video-snapshot-failed',
            updatedAt: new Date().toISOString(),
          },
        }))
        return
      }
      setFramePreviewCache((current) => ({
        ...current,
        [videoTarget.frame.id]: {
          frameId: videoTarget.frame.id,
          ok: true,
          imageUrl: result.previewUrl,
          imageSize: result.imageSize,
          updatedAt: new Date().toISOString(),
        },
      }))
      setFrames((current) => current.map((item) => (
        item.id === videoTarget.frame.id
          ? {
              ...item,
              meta: {
                ...item.meta,
                width: result.imageSize.width,
                height: result.imageSize.height,
              },
              updatedAt: new Date().toISOString(),
            }
          : item
      )))
    }).finally(() => {
      pendingPreviewFrameIdsRef.current.delete(videoTarget.frame.id)
    })
  }, [framePreviewCache, getAnnotationPdfTarget, getAnnotationVideoTarget, source])

  const previewAnnotationId = selectedAnnotationIds.length === 1
    ? selectedAnnotationIds[0]
    : selectedAnnotationIds.length === 0
      ? lastPreviewAnnotationId
      : null
  const selectedFrameForInspector = frames.find((item) => item.id === selectedFrameId) || null
  const selectedEntityForInspector = entities.find((entity) => entity.id === selectedEntityId) || null
  const selectedSimpleNote = simpleNotes.find((note) => note.id === selectedSimpleNoteId) || null
  const simpleNoteFilterText = simpleNoteFilter.trim().toLowerCase()
  const filteredSimpleNotes = simpleNotes
    .map((note, index) => ({ note, index }))
    .filter(({ note }) => (
      !simpleNoteFilterText
      || String(note.content || '').toLowerCase().includes(simpleNoteFilterText)
    ))
  const visibleSimpleNotes = simpleNoteReverse
    ? [...filteredSimpleNotes].reverse()
    : filteredSimpleNotes
  const getSimpleNoteDurationLabel = (note) => {
    const startSeconds = parseTimeText(note?.start)
    const endSeconds = parseTimeText(note?.end)
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) return '--'
    const duration = Math.max(0, endSeconds - startSeconds)
    return `+${duration.toFixed(1)}s`
  }
  const moveSelectedSimpleNote = (delta) => {
    if (visibleSimpleNotes.length === 0) return
    const currentIndex = visibleSimpleNotes.findIndex(({ note }) => note.id === selectedSimpleNoteId)
    const fallbackIndex = delta > 0 ? -1 : visibleSimpleNotes.length
    const nextIndex = Math.max(
      0,
      Math.min(visibleSimpleNotes.length - 1, (currentIndex >= 0 ? currentIndex : fallbackIndex) + delta),
    )
    selectSimpleNote(visibleSimpleNotes[nextIndex].note.id)
  }

  const handleSimpleNoteListKeyDown = (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    moveSelectedSimpleNote(event.key === 'ArrowDown' ? 1 : -1)
  }
  const getCompactId = (id) => (
    id ? `${String(id).slice(0, 8)}...` : '--'
  )

  useEffect(() => {
    if (abInspectorTab !== 'simpleNotes' || !selectedSimpleNoteId) return
    const selectedRow = simpleNoteListRef.current?.querySelector(`[data-simple-note-id="${selectedSimpleNoteId}"]`)
    selectedRow?.scrollIntoView({ block: 'nearest' })
  }, [abInspectorTab, selectedSimpleNoteId, simpleNoteFilterText])

  useEffect(() => {
    setExpandedInspectorEntityIds((current) => (
      current.filter((entityId) => entities.some((entity) => entity.id === entityId))
    ))
  }, [entities])

  useEffect(() => {
    if (!['video', 'pdf'].includes(source?.kind) || !previewAnnotationId) return
    const annotation = annotations.find((item) => item.id === previewAnnotationId)
    ensureAnnotationPreview(annotation)
  }, [annotations, ensureAnnotationPreview, previewAnnotationId, source?.kind])

  const getAnnotationFrameLabel = (annotation) => {
    const annotationFrame = getAnnotationFrame(annotation)
    if (!annotationFrame) return annotation.frameId ? 'missing frame' : '--'
    if (annotationFrame.kind === 'video-frame') {
      return formatTime(annotationFrame.locator?.time)
    }
    if (annotationFrame.kind === 'pdf-page') {
      const page = getPdfFramePage(annotationFrame)
      const bookPageLabel = annotationFrame.meta?.bookPageLabel
      return bookPageLabel ? `PDF ${page} · Book ${bookPageLabel}` : `PDF page ${page || '--'}`
    }
    return 'image'
  }

  const getFrameLabel = (targetFrame) => {
    if (!targetFrame) return '--'
    if (targetFrame.kind === 'video-frame') {
      return formatTime(Number(targetFrame.locator?.time))
    }
    if (targetFrame.kind === 'pdf-page') {
      const page = getPdfFramePage(targetFrame)
      return targetFrame.meta?.bookPageLabel
        ? `Page ${page || '--'} · Book ${targetFrame.meta.bookPageLabel}`
        : `Page ${page || '--'}`
    }
    return 'image'
  }

  const toggleInspectorEntityExpanded = (entityId) => {
    setExpandedInspectorEntityIds((current) => (
      current.includes(entityId)
        ? current.filter((id) => id !== entityId)
        : [...current, entityId]
    ))
  }

  const expandAllInspectorEntities = () => {
    setExpandedInspectorEntityIds(entities.map((entity) => entity.id))
  }

  const collapseAllInspectorEntities = () => {
    setExpandedInspectorEntityIds([])
  }

  const renderInspectorEntityTreeNodes = (nodes, entity) => {
    const schema = getDomainSchema(entity.subject, subjectSchemas)
    return (
      <ul className="inspector-entity-tree">
        {nodes.map((node) => {
          const annotation = getAnnotationById(node.aObjectId)
          const roleLabel = getDomainRole(schema, entity.kind, node.role)?.label || node.role || '--'
          return (
            <li className="inspector-entity-tree-node" key={node.id}>
              <button
                className={selectedAnnotationIds.includes(node.aObjectId) ? 'selected' : ''}
                onClick={(event) => {
                  event.stopPropagation()
                  if (annotation) selectAnnotationsFromChild([node.aObjectId])
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (annotation) openAObjectMenu(node.aObjectId, event.clientX, event.clientY)
                }}
                title={node.aObjectId}
                type="button"
              >
                <strong>{roleLabel}</strong>
                <span>{annotation ? annotation.type : 'Missing A Object'}</span>
                <small>{annotation ? getAnnotationSummary(annotation) : getCompactId(node.aObjectId)}</small>
              </button>
              {node.children?.length ? renderInspectorEntityTreeNodes(node.children, entity) : null}
            </li>
          )
        })}
      </ul>
    )
  }

  const selectFrameFromInspector = (targetFrame) => {
    if (!targetFrame) return
    setSelectedFrameId(targetFrame.id)
  }

  const goToFrame = (targetFrame) => {
    if (!targetFrame) return
    setSelectedFrameId(targetFrame.id)
    if (source?.kind === 'video' && targetFrame.kind === 'video-frame') {
      const time = Number(targetFrame.locator?.time)
      if (!Number.isFinite(time)) return
      setVideoSeekRequest({
        id: createId('seek'),
        annotationId: null,
        frameId: targetFrame.id,
        time,
      })
      setFrame(targetFrame)
      return
    }

    setFrame(targetFrame)
    if (source?.kind === 'pdf' && targetFrame.kind === 'pdf-page') {
      changePdfPage(getPdfFramePage(targetFrame))
      return
    }
    if (source?.kind === 'image') {
      setFramePreviewUrl(source.fileUrl || '')
      if (targetFrame.meta?.width && targetFrame.meta?.height) {
        setImageSize({ width: targetFrame.meta.width, height: targetFrame.meta.height })
      }
      return
    }

    const cachedPreview = framePreviewCache[targetFrame.id]
    if (cachedPreview?.imageUrl) setFramePreviewUrl(cachedPreview.imageUrl)
    if (cachedPreview?.imageSize) {
      setImageSize(cachedPreview.imageSize)
      return
    }
    if (targetFrame.meta?.width && targetFrame.meta?.height) {
      setImageSize({ width: targetFrame.meta.width, height: targetFrame.meta.height })
    }
  }

  const seekVideoToAnnotation = (annotation) => {
    const videoTarget = getAnnotationVideoTarget(annotation)
    if (!videoTarget) {
      setMessage(`Go To failed: missing video frame for A object ${annotation?.id || ''}`)
      return
    }
    setSelectedAnnotationIds([annotation.id])
    setVideoSeekRequest({
      id: createId('seek'),
      annotationId: annotation.id,
      frameId: videoTarget.frame.id,
      time: videoTarget.time,
    })
    setFrame(videoTarget.frame)
    setSelectedFrameId(videoTarget.frame.id)
  }

  const goToAnnotation = (annotation) => {
    if (source?.kind === 'pdf') {
      const pdfTarget = getAnnotationPdfTarget(annotation)
      if (!pdfTarget) {
        setMessage(`Go To failed: missing PDF page for A object ${annotation?.id || ''}`)
        return
      }
      changePdfPage(pdfTarget.page)
      setSelectedAnnotationIds([annotation.id])
      setLastPreviewAnnotationId(annotation.id)
      const bounds = getAnnotationNormalizedBounds(annotation)
      if (bounds) {
        setPdfNavigationRequest({
          id: createId('pdf-nav'),
          annotationId: annotation.id,
          bounds,
          page: pdfTarget.page,
        })
      }
      return
    }
    seekVideoToAnnotation(annotation)
  }

  const openEntityDialog = ({ sourceAObjectIds = [], entityId = null } = {}) => {
    const entity = entityId ? entities.find((item) => item.id === entityId) : null
    const schema = getDomainSchema(entity?.subject || subjectSchemas[0]?.id, subjectSchemas)
    const kind = entity?.kind || schema.defaultKind
    setEntityDialog({
      mode: entity ? 'edit' : 'create',
      entityId: entity?.id || null,
      sourceAObjectIds,
      subject: schema.id,
      kind,
      subKind: entity?.subKind || getDomainDefaultSubKind(schema, kind),
      label: entity?.label || (sourceAObjectIds.length ? schema.defaultLabel : 'New Entity'),
    })
    setEntityMenu(null)
  }

  const closeEntityDialog = () => {
    setEntityDialog(null)
  }

  const updateEntityDialogSubject = (subject) => {
    const schema = getDomainSchema(subject, subjectSchemas)
    setEntityDialog((current) => ({
      ...current,
      subject: schema.id,
      kind: schema.defaultKind,
      subKind: getDomainDefaultSubKind(schema, schema.defaultKind),
      label: current.label === getDomainSchema(current.subject, subjectSchemas)?.defaultLabel
        ? schema.defaultLabel
        : current.label,
    }))
  }

  const updateEntityDialogKind = (kind) => {
    setEntityDialog((current) => ({
      ...current,
      kind,
      subKind: getDomainDefaultSubKind(getDomainSchema(current.subject, subjectSchemas), kind),
    }))
  }

  const saveEntityDialog = () => {
    if (!entityDialog) return
    if (entityDialog.mode === 'edit') {
      setEntities((current) => current.map((entity) => (
        entity.id === entityDialog.entityId
          ? {
              ...entity,
              subject: entityDialog.subject,
              kind: entityDialog.kind,
              subKind: entityDialog.subKind || '',
              label: entityDialog.label.trim() || 'Entity',
              updatedAt: new Date().toISOString(),
            }
          : entity
      )))
      setAbInspectorTab('b')
      setSaveStatus('Unsaved')
      closeEntityDialog()
      return
    }

    const now = new Date().toISOString()
    const entity = {
      id: createId('b'),
      subject: entityDialog.subject,
      kind: entityDialog.kind,
      subKind: entityDialog.subKind || '',
      label: entityDialog.label.trim() || 'Entity',
      ...createACardPatch(refsToACardTree((entityDialog.sourceAObjectIds || []).map((aObjectId) => ({
        aObjectId,
        role: getDomainRolesForKind(getDomainSchema(entityDialog.subject, subjectSchemas), entityDialog.kind)[0]?.value || 'default',
      })))),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
    setEntities((current) => [...current, entity])
    setSelectedEntityId(entity.id)
    setAbInspectorTab('b')
    setSaveStatus('Unsaved')
    closeEntityDialog()
  }

  const openAddToEntityDialog = (entityId, annotationIds = []) => {
    const entity = entities.find((item) => item.id === entityId)
    const idsToAdd = annotationIds
    if (!entity || idsToAdd.length === 0) return
    setAddToEntityDialog({
      entityId,
      annotationIds: idsToAdd,
      role: getEntityDefaultRole(entity),
    })
  }

  const closeAddToEntityDialog = () => {
    setAddToEntityDialog(null)
  }

  const addAObjectToEntity = () => {
    const entityId = addToEntityDialog?.entityId
    const idsToAdd = addToEntityDialog?.annotationIds || []
    const role = addToEntityDialog?.role
    if (idsToAdd.length === 0) return
    setEntities((current) => current.map((entity) => {
      if (entity.id !== entityId) return entity
      const currentTree = getEntityACardTree(entity)
      const currentRefs = getEntityAObjectRefs(entity)
      const existingIds = new Set(currentRefs.map((ref) => ref.aObjectId))
      const refsToAdd = idsToAdd
        .filter((aObjectId) => !existingIds.has(aObjectId))
        .map((aObjectId) => ({
          aObjectId,
          role,
        }))
      if (refsToAdd.length === 0) return entity
      return {
        ...entity,
        ...createACardPatch(appendRefsToACardTree(currentTree, refsToAdd)),
        updatedAt: new Date().toISOString(),
      }
    }))
    setAbInspectorTab('b')
    setSaveStatus('Unsaved')
    closeAddToEntityDialog()
  }

  const openEntityMenu = (entityId, x, y) => {
    setAbInspectorTab('b')
    setAObjectMenu(null)
    setEntityMenu({ entityId, x, y })
  }

  const closeEntityMenu = () => {
    setEntityMenu(null)
  }

  const openAObjectMenu = (annotationId, x, y) => {
    selectAnnotationsFromChild([annotationId])
    setEntityMenu(null)
    setAObjectMenu({ annotationId, x, y })
  }

  const closeAObjectMenu = () => {
    setAObjectMenu(null)
  }

  const openFrameMenu = (frameId, x, y) => {
    setSelectedFrameId(frameId)
    setFrameMenu({ frameId, x, y })
  }

  const closeFrameMenu = () => {
    setFrameMenu(null)
  }

  const goToFrameFromMenu = () => {
    const targetFrame = frames.find((item) => item.id === frameMenu?.frameId)
    goToFrame(targetFrame)
    closeFrameMenu()
  }

  const goToAObjectFromMenu = () => {
    const annotation = getAnnotationById(aObjectMenu?.annotationId)
    if (!annotation) return
    goToAnnotation(annotation)
    closeAObjectMenu()
  }

  const getFirstEntityAnnotation = (entity) => {
    const firstCard = flattenACardTree(getEntityACardTree(entity))
      .find((card) => getAnnotationById(card.aObjectId))
    return firstCard ? getAnnotationById(firstCard.aObjectId) : null
  }

  const getEntityDefaultFrame = (entity) => {
    const annotation = getFirstEntityAnnotation(entity)
    return annotation ? getAnnotationFrame(annotation) : null
  }

  const goToEntityFromMenu = (entityId) => {
    const entity = entities.find((item) => item.id === entityId)
    if (!entity) return
    const annotation = getFirstEntityAnnotation(entity)
    const defaultFrame = getEntityDefaultFrame(entity)
    setSelectedEntityId(entity.id)
    setAbInspectorTab('b')
    if (annotation) {
      const videoTarget = getAnnotationVideoTarget(annotation)
      if (source?.kind === 'pdf') {
        goToAnnotation(annotation)
      } else if (source?.kind === 'image' && defaultFrame) {
        goToFrame(defaultFrame)
        setSelectedAnnotationIds([annotation.id])
        setLastPreviewAnnotationId(annotation.id)
      } else if (!videoTarget) {
        setMessage(`Entity Go To failed: missing video frame for A object ${annotation.id}`)
      } else {
        setSelectedAnnotationIds([annotation.id])
        setLastPreviewAnnotationId(annotation.id)
        setVideoSeekRequest({
          id: createId('seek'),
          annotationId: annotation.id,
          frameId: videoTarget.frame.id,
          time: videoTarget.time,
        })
        setFrame(videoTarget.frame)
        setSelectedFrameId(videoTarget.frame.id)
      }
    }
    closeEntityMenu()
  }

  actionHandlersRef.current.goToAObjectFromMenu = goToAObjectFromMenu
  actionHandlersRef.current.goToFrameFromMenu = goToFrameFromMenu
  actionHandlersRef.current.goToEntityFromMenu = () => goToEntityFromMenu(entityMenu?.entityId)

  const removeAObjectFromEntity = (entityId, annotationId) => {
    setEntities((current) => current.map((entity) => (
      entity.id === entityId
        ? {
            ...entity,
            ...createACardPatch(removeACardsByAObjectIds(getEntityACardTree(entity), [annotationId])),
            updatedAt: new Date().toISOString(),
          }
        : entity
    )))
    setSaveStatus('Unsaved')
  }

  const updateEntityAObjectRole = (entityId, annotationId, role) => {
    setEntities((current) => current.map((entity) => (
      entity.id === entityId
        ? {
            ...entity,
            ...createACardPatch(updateACardRolesByAObjectId(getEntityACardTree(entity), annotationId, role)),
            updatedAt: new Date().toISOString(),
          }
        : entity
    )))
    setSaveStatus('Unsaved')
  }

  const getAnnotationById = (annotationId) => (
    annotations.find((annotation) => annotation.id === annotationId) || null
  )

  const startAObjectDrag = (event, annotationIds) => {
    const ids = annotationIds.filter((id) => annotations.some((annotation) => annotation.id === id))
    if (ids.length === 0) return
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(A_OBJECT_DRAG_TYPE, JSON.stringify({ ids }))
    event.dataTransfer.setData('text/plain', ids[0])
  }

  const deleteBEntity = (entityId) => {
    const entity = entities.find((item) => item.id === entityId)
    if (!entity) return
    const nextEntities = entities.filter((item) => item.id !== entityId)
    pushDeleteUndo(editorWorkspace.activeId, {
      editorType: 'ab',
      label: `Delete Entity: ${entity.label || entity.id}`,
      before: {
        content: cloneUndoValue(getCurrentABUndoContent()),
        selection: {
          selectedAnnotationIds: [...selectedAnnotationIds],
          selectedEntityId,
          lastPreviewAnnotationId,
        },
      },
      after: cloneUndoValue({ annotations, entities: nextEntities }),
    })
    setEntities(nextEntities)
    if (selectedEntityId === entityId) setSelectedEntityId(null)
    setSaveStatus('Unsaved')
    closeEntityMenu()
  }

  const duplicateBEntity = (entityId) => {
    const entity = entities.find((item) => item.id === entityId)
    if (!entity) return
    const now = new Date().toISOString()
    const nextEntity = {
      ...stripEntityFrameFields(entity),
      id: createId('b'),
      label: `${entity.label || 'Entity'} Copy`,
      ...createACardPatch(refsToACardTree(getEntityAObjectRefs(entity))),
      createdAt: now,
      updatedAt: now,
    }
    setEntities((current) => [...current, nextEntity])
    setSelectedEntityId(nextEntity.id)
    setAbInspectorTab('b')
    setSaveStatus('Unsaved')
    closeEntityMenu()
  }

  const createBWorkflowEntity = (entityInput) => {
    const now = new Date().toISOString()
    const entity = {
      id: createId('b'),
      subject: entityInput.subject,
      kind: entityInput.kind,
      subKind: entityInput.subKind || '',
      label: entityInput.label?.trim() || 'Entity',
      ...createACardPatch(getEntityACardTree(entityInput)),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
    setEntities((current) => [...current, entity])
    setSelectedEntityId(entity.id)
    setAbInspectorTab('b')
    setSaveStatus('Unsaved')
    return entity.id
  }

  const updateBWorkflowEntity = (entityId, patch, options = {}) => {
    const cleanPatch = stripEntityFrameFields(patch)
    const hasACardPatch = (
      cleanPatch.aCards !== undefined ||
      cleanPatch.aObjectRefs !== undefined ||
      cleanPatch.aObjectIds !== undefined
    )
    const nextEntities = entities.map((entity) => (
      entity.id === entityId
        ? {
            ...entity,
            ...cleanPatch,
            label: cleanPatch.label !== undefined ? cleanPatch.label?.trim() || 'Entity' : entity.label,
            ...(hasACardPatch ? createACardPatch(getEntityACardTree(cleanPatch)) : {}),
            updatedAt: new Date().toISOString(),
          }
        : entity
    ))
    if (options.undoDeleteLabel) {
      pushDeleteUndo(editorWorkspace.activeId, {
        editorType: 'ab',
        label: options.undoDeleteLabel,
        before: {
          content: cloneUndoValue(getCurrentABUndoContent()),
          selection: {
            selectedAnnotationIds: [...selectedAnnotationIds],
            selectedEntityId,
            lastPreviewAnnotationId,
          },
        },
        after: cloneUndoValue({ annotations, entities: nextEntities }),
      })
    }
    setEntities(nextEntities)
    setSelectedEntityId(entityId)
    setAbInspectorTab('b')
    setSaveStatus('Unsaved')
  }

  const editEntityInWorkflow = (entityId) => {
    const entity = entities.find((item) => item.id === entityId)
    if (!entity) return
    setSelectedEntityId(entity.id)
    setAbInspectorTab('b')
    closeEntityMenu()
  }

  const getEntitiesForAnnotation = (annotationId) => (
    entities.filter((entity) => getEntityAObjectIds(entity).includes(annotationId))
  )

  const markCDocumentUnsaved = (nextDocument) => {
    if (!activeCWorkspaceId) return
    updateActiveCWorkspace({
      cDocument: {
        ...nextDocument,
        updatedAt: new Date().toISOString(),
      },
      cSaveStatus: 'Unsaved',
    })
  }

  const createCompositeWorkspaceId = () => `c-${createId('composite')}`

  const openCDocumentInWorkspace = (workspaceId, result) => {
    clearDeleteUndo(workspaceId)
    updateCWorkspace(workspaceId, {
      cDocument: normalizeCDocument(result.data),
      cDocumentFilePath: result.filePath,
      selectedCItemId: null,
      selectedBIndexItemKey: '',
      cSaveStatus: 'Saved',
    })
    setActiveWorkspaceTabId(workspaceId)
    setLeftTab('compositeFiles')
  }

  const openCDocumentInNewWorkspace = (result) => {
    const workspaceId = createCompositeWorkspaceId()
    setCWorkspaces((current) => ({
      ...current,
      [workspaceId]: {
        ...createEmptyCWorkspace({ cSaveStatus: 'Saved' }),
        cDocument: normalizeCDocument(result.data),
        cDocumentFilePath: result.filePath,
      },
    }))
    setActiveWorkspaceTabId(workspaceId)
    setLeftTab('compositeFiles')
  }

  const newCDocument = () => {
    const workspaceId = createCompositeWorkspaceId()
    setCWorkspaces((current) => ({
      ...current,
      [workspaceId]: createEmptyCWorkspace(),
    }))
    setActiveWorkspaceTabId(workspaceId)
    setLeftTab('compositeFiles')
  }

  const openCDocument = async () => {
    const result = await window.labApi?.openCDocument?.()
    if (!result?.ok) return
    if (activeCWorkspaceId && isEmptyCWorkspace(activeCWorkspace)) {
      openCDocumentInWorkspace(activeCWorkspaceId, result)
      return
    }
    if (!activeCWorkspaceId) {
      openCDocumentInNewWorkspace(result)
      return
    }
    openCDocumentInNewWorkspace(result)
  }

  const reloadCDocument = async () => {
    if (!activeCWorkspace.cDocumentFilePath) return
    if (!confirmDiscardCWorkspaceChanges()) return
    const result = await window.labApi?.readCDocumentFile?.(activeCWorkspace.cDocumentFilePath)
    if (!result?.ok) {
      updateActiveCWorkspace({ cSaveStatus: `Reload failed: ${result?.reason || 'unknown error'}` })
      return
    }
    updateActiveCWorkspace({
      cDocument: normalizeCDocument(result.data),
      cDocumentFilePath: result.filePath,
      selectedCItemId: null,
      cSaveStatus: 'Saved',
    })
    clearDeleteUndo(activeCWorkspaceId)
    setLeftTab('compositeFiles')
  }

  const closeCDocument = () => {
    if (!activeCWorkspaceId) return
    if (!confirmDiscardCWorkspaceChanges(activeCWorkspace)) return
    clearDeleteUndo(activeCWorkspaceId)
    const workspaceIds = Object.keys(cWorkspaces)
    const closeIndex = workspaceIds.indexOf(activeCWorkspaceId)
    const nextWorkspaceIds = workspaceIds.filter((workspaceId) => workspaceId !== activeCWorkspaceId)
    setCWorkspaces((current) => {
      const next = { ...current }
      delete next[activeCWorkspaceId]
      return next
    })
    setActiveWorkspaceTabId(nextWorkspaceIds[Math.min(closeIndex, nextWorkspaceIds.length - 1)] || editorWorkspace.activeId)
    setLeftTab('compositeFiles')
  }

  const requestCloseCWorkspace = (workspaceId, event) => {
    event?.stopPropagation()
    const workspace = cWorkspaces[workspaceId]
    if (!workspace) return
    if (!confirmDiscardCWorkspaceChanges(workspace)) return
    clearDeleteUndo(workspaceId)
    const workspaceIds = Object.keys(cWorkspaces)
    const closeIndex = workspaceIds.indexOf(workspaceId)
    const nextWorkspaceIds = workspaceIds.filter((item) => item !== workspaceId)
    setCWorkspaces((current) => {
      const next = { ...current }
      delete next[workspaceId]
      return next
    })
    if (activeWorkspaceTabId === workspaceId) {
      setActiveWorkspaceTabId(nextWorkspaceIds[Math.min(closeIndex, nextWorkspaceIds.length - 1)] || editorWorkspace.activeId)
    }
  }

  const saveCDocumentToPath = async (filePath, workspaceId = activeCWorkspaceId) => {
    if (!filePath) return false
    const workspace = cWorkspaces[workspaceId] || activeCWorkspace
    const data = normalizeCDocument(workspace.cDocument)
    updateCWorkspace(workspaceId, { cSaveStatus: 'Saving...' })
    const result = await window.labApi?.saveCDocument?.({ filePath, data })
    if (!result?.ok) {
      updateCWorkspace(workspaceId, { cSaveStatus: `Save failed: ${result?.reason || 'unknown error'}` })
      return false
    }
    updateCWorkspace(workspaceId, {
      cDocument: data,
      cDocumentFilePath: result.filePath,
      cSaveStatus: 'Saved',
    })
    clearDeleteUndo(workspaceId)
    return true
  }

  const saveCDocument = async () => {
    if (activeCWorkspace.cDocumentFilePath) {
      await saveCDocumentToPath(activeCWorkspace.cDocumentFilePath)
      return
    }
    await saveCDocumentAs()
  }

  const saveCDocumentAs = async (workspaceId = activeCWorkspaceId) => {
    const workspace = cWorkspaces[workspaceId] || activeCWorkspace
    const result = await window.labApi?.chooseCDocumentPath?.(workspace.cDocument.title)
    if (!result?.ok) return false
    return saveCDocumentToPath(result.filePath, workspaceId)
  }

  const saveWorkspaceTab = async (tabId) => {
    const tab = workspaceTabs.find((item) => item.id === tabId)
    if (!tab) return

    closeWorkspaceTabMenu()
    if (tab.type === 'ab') {
      if (tabId === editorWorkspace.activeId) {
        await saveAnnotations()
        return
      }

      const session = getEditorSessionSnapshot(tabId)
      await saveEditorSessionSnapshot(session)
      return
    }

    const workspace = cWorkspaces[tabId]
    if (!workspace) return
    if (workspace.cDocumentFilePath) {
      await saveCDocumentToPath(workspace.cDocumentFilePath, tabId)
      return
    }

    await saveCDocumentAs(tabId)
  }

  const setAppCloseError = (error) => {
    setAppCloseDialog((current) => current
      ? {
          ...current,
          error,
          items: getUnsavedAppWorkspaceItems(appCloseDataRef.current),
          saving: false,
        }
      : current)
  }

  const saveAllAndCloseApp = async () => {
    if (appCloseDialog?.saving) return
    setAppCloseDialog((current) => current
      ? { ...current, error: '', saving: true }
      : current)

    try {
      const closeData = appCloseDataRef.current
      const unsavedABSessions = closeData.abSessions
        .filter((session) => isUnsavedSaveStatus(session.saveStatus))
      for (const session of unsavedABSessions) {
        const saved = session.id === editorWorkspace.activeId
          ? await saveAnnotations()
          : await saveEditorSessionSnapshot(session)
        if (!saved) {
          setAppCloseError(`Could not save ABEditor session: ${session.title || 'Untitled'}`)
          return
        }
      }

      const unsavedCWorkspaces = Object.entries(closeData.cWorkspaces)
        .filter(([, workspace]) => isUnsavedSaveStatus(workspace.cSaveStatus))
      for (const [workspaceId, workspace] of unsavedCWorkspaces) {
        const saved = workspace.cDocumentFilePath
          ? await saveCDocumentToPath(workspace.cDocumentFilePath, workspaceId)
          : await saveCDocumentAs(workspaceId)
        if (!saved) {
          const title = workspace.cDocument.title || getPathFileName(workspace.cDocumentFilePath) || 'Untitled'
          setAppCloseError(`Could not save CEditor session: ${title}`)
          return
        }
      }

      const result = await window.labApi?.confirmAppClose?.()
      if (!result?.ok) setAppCloseError('The application could not complete the close request.')
    } catch (error) {
      setAppCloseError(`Save failed: ${error?.message || String(error)}`)
    }
  }

  const exitAppWithoutSaving = async () => {
    const confirmed = window.confirm('Exit without saving all listed changes? This cannot be undone.')
    if (!confirmed) return
    const result = await window.labApi?.confirmAppClose?.()
    if (!result?.ok) setAppCloseError('The application could not complete the close request.')
  }

  const cancelAppClose = async () => {
    const result = await window.labApi?.cancelAppClose?.()
    if (!result?.ok) {
      setAppCloseError('The close request could not be canceled.')
      return
    }
    setAppCloseDialog(null)
  }

  const closeWorkspaceTab = (tabId) => {
    const tab = workspaceTabs.find((item) => item.id === tabId)
    if (!tab) return
    closeWorkspaceTabMenu()
    if (tab.type === 'ab') {
      requestCloseEditorSession(tabId)
      return
    }
    requestCloseCWorkspace(tabId)
  }

  const updateCDocumentField = (field, value) => {
    markCDocumentUnsaved({
      ...activeCWorkspace.cDocument,
      [field]: value,
    })
  }

  const mergeBIndexItems = (currentItems, incomingItems) => {
    const itemMap = new Map(currentItems.map((item) => [`${item.dataFilePath}:${item.entityId}`, item]))
    incomingItems.forEach((item) => {
      itemMap.set(`${item.dataFilePath}:${item.entityId}`, item)
    })
    return Array.from(itemMap.values())
  }

  const getBIndexItemKey = (item) => `${item.dataFilePath}:${item.entityId}`

  const scanBEntityIndex = async () => {
    const result = await window.labApi?.scanAnnotationFolder?.()
    if (!result?.ok) return
    updateActiveCWorkspace((workspace) => ({
      bIndexSources: [
        ...workspace.bIndexSources,
        ...(result.folderPaths || [result.folderPath]).filter(Boolean).map((folderPath) => ({
          id: `folder:${folderPath}`,
          type: 'folder',
          folderPath,
        })),
      ],
      bIndexItems: mergeBIndexItems(workspace.bIndexItems, Array.isArray(result.items) ? result.items : []),
    }))
    requestActivateWorkspaceTab(activeCWorkspaceId)
  }

  const scanBEntityAnnotationFiles = async () => {
    const result = await window.labApi?.scanAnnotationFiles?.()
    if (!result?.ok) return
    updateActiveCWorkspace((workspace) => ({
      bIndexSources: [
        ...workspace.bIndexSources,
        ...(result.annotationFiles || []).map((filePath) => ({
          id: `annotation-file:${filePath}`,
          type: 'annotation-file',
          filePath,
        })),
      ],
      bIndexItems: mergeBIndexItems(workspace.bIndexItems, Array.isArray(result.items) ? result.items : []),
    }))
    requestActivateWorkspaceTab(activeCWorkspaceId)
  }

  const selectBIndexItem = (indexItem) => {
    updateActiveCWorkspace({
      selectedBIndexItemKey: indexItem ? getBIndexItemKey(indexItem) : '',
      selectedCItemId: null,
    })
  }

  const updateBIndexFilter = (patch) => {
    updateActiveCWorkspace((workspace) => ({
      bIndexFilter: {
        ...workspace.bIndexFilter,
        ...patch,
      },
    }))
  }

  const addBIndexItemToCDocument = (indexItem) => {
    const nextItem = createBRefItem(indexItem)
    markCDocumentUnsaved({
      ...activeCWorkspace.cDocument,
      items: [...activeCWorkspace.cDocument.items, nextItem],
    })
    updateActiveCWorkspace({ selectedCItemId: nextItem.id })
  }

  const addTextItemToCDocument = () => {
    const nextItem = createTextItem('')
    markCDocumentUnsaved({
      ...activeCWorkspace.cDocument,
      items: [...activeCWorkspace.cDocument.items, nextItem],
    })
    updateActiveCWorkspace({ selectedCItemId: nextItem.id })
  }

  const addFileRefItemToCDocument = async (fileResult = null) => {
    const result = fileResult?.ok ? fileResult : await window.labApi?.openExternalRef?.()
    if (!result?.ok) return
    const nextItem = createFileRefItem(result)
    markCDocumentUnsaved({
      ...activeCWorkspace.cDocument,
      items: [...activeCWorkspace.cDocument.items, nextItem],
    })
    updateActiveCWorkspace({ selectedCItemId: nextItem.id })
  }

  const addCRefItemToCDocument = async (fileResult = null) => {
    const result = fileResult?.ok ? fileResult : await window.labApi?.openCRef?.()
    if (!result?.ok) return
    if (activeCWorkspace.cDocumentFilePath && result.filePath === activeCWorkspace.cDocumentFilePath) {
      window.alert('Cannot add current C document as its own C Ref.')
      return
    }
    const nextItem = createCRefItem(result, 'live')
    markCDocumentUnsaved({
      ...activeCWorkspace.cDocument,
      items: [...activeCWorkspace.cDocument.items, nextItem],
    })
    updateActiveCWorkspace({ selectedCItemId: nextItem.id })
  }

  const changeCItems = (items) => {
    markCDocumentUnsaved({
      ...activeCWorkspace.cDocument,
      items,
    })
  }

  const updateCItemText = (itemId, text) => {
    markCDocumentUnsaved({
      ...activeCWorkspace.cDocument,
      items: updateCItemInTree(activeCWorkspace.cDocument.items, itemId, (item) => ({
        ...item,
        text,
        updatedAt: new Date().toISOString(),
      })),
    })
  }

  const exportCompositeItems = async (mode = 'all') => {
    const selectedCItemId = activeCWorkspace.selectedCItemId
    if (mode === 'selected' && !selectedCItemId) return false
    if (activeCWorkspace.cDocument.items.length === 0) return false

    const outputFolder = await chooseExportFolder()
    if (!outputFolder) return false
    setMessage(mode === 'selected'
      ? 'Preparing selected Composite item for export...'
      : 'Preparing Composite export...')

    try {
      const prepared = await prepareCompositeExport({
        cDocument: activeCWorkspace.cDocument,
        cDocumentFilePath: activeCWorkspace.cDocumentFilePath,
        mode,
        selectedCItemId,
      })
      if (!prepared.ok || prepared.tasks.length === 0) {
        const reason = prepared.reason || 'no-exportable-item'
        setMessage(`Composite export failed: ${reason}`)
        showExportResult({
          title: mode === 'selected' ? 'Export Selected Composite Item' : 'Export Composite',
          outputFolder,
          requestedCount: mode === 'selected' ? 1 : activeCWorkspace.cDocument.items.length,
          reason,
        })
        return false
      }

      const entityItems = new Set(prepared.tasks
        .filter((task) => task.entityId)
        .map((task) => `${task.sourceCompositePath || ''}:${task.cItemId || task.entityId}`))
      const aObjectCount = prepared.tasks.filter((task) => task.annotationId).length
      const otherItemCount = prepared.tasks.filter((task) => (
        task.kind === 'text' || task.kind === 'file-copy'
      )).length

      const result = await window.labApi?.exportCompositeItems?.({
        outputFolder,
        cDocumentFilePath: activeCWorkspace.cDocumentFilePath,
        document: {
          id: activeCWorkspace.cDocument.id,
          title: activeCWorkspace.cDocument.title,
          subject: activeCWorkspace.cDocument.subject,
          kind: activeCWorkspace.cDocument.kind,
        },
        mode,
        selectedCItemId,
        tasks: prepared.tasks,
      })
      const okCount = result?.exported?.filter((item) => item.ok).length || 0
      const totalCount = result?.exported?.length || prepared.tasks.length
      const failedCount = totalCount - okCount
      if (result?.ok) {
        setMessage(`Exported ${okCount}/${totalCount} Composite item(s) to ${result.folderPath}${failedCount ? ' ; see _export_errors.txt' : ''}`)
      } else {
        setMessage(`Composite export failed: ${result?.reason || 'unknown error'}${result?.folderPath ? ` ; see ${result.folderPath}` : ''}`)
      }
      showExportResult({
        title: mode === 'selected' ? 'Export Selected Composite Item' : 'Export Composite',
        result,
        outputFolder,
        requestedCount: prepared.tasks.length,
        entityCount: entityItems.size,
        aObjectCount,
        otherItemCount,
      })
      return Boolean(result?.ok)
    } catch (error) {
      const reason = error?.message || String(error)
      setMessage(`Composite export failed: ${reason}`)
      showExportResult({
        title: mode === 'selected' ? 'Export Selected Composite Item' : 'Export Composite',
        outputFolder,
        requestedCount: mode === 'selected' ? 1 : activeCWorkspace.cDocument.items.length,
        reason,
      })
      return false
    }
  }

  const deleteCItem = (itemId) => {
    if (!window.confirm('Delete this C item?')) return
    const deletedItem = findCItemInTree(activeCWorkspace.cDocument.items, itemId)
    if (!deletedItem) return
    const nextDocument = {
      ...activeCWorkspace.cDocument,
      items: removeCItemFromTree(activeCWorkspace.cDocument.items, itemId),
      updatedAt: new Date().toISOString(),
    }
    const nextSelectedCItemId = (
      activeCWorkspace.selectedCItemId === itemId
      || cItemTreeContains(deletedItem.children || [], activeCWorkspace.selectedCItemId)
    ) ? null : activeCWorkspace.selectedCItemId
    pushDeleteUndo(activeCWorkspaceId, {
      editorType: 'c',
      label: `Delete Composite Item: ${deletedItem.title || deletedItem.text || deletedItem.label || deletedItem.type || itemId}`,
      before: {
        content: cloneUndoValue(getCurrentCUndoContent()),
        selection: {
          selectedBIndexItemKey: activeCWorkspace.selectedBIndexItemKey,
          selectedCItemId: activeCWorkspace.selectedCItemId,
        },
      },
      after: cloneUndoValue({ cDocument: nextDocument }),
    })
    updateActiveCWorkspace({
      cDocument: nextDocument,
      selectedCItemId: nextSelectedCItemId,
      cSaveStatus: 'Unsaved',
    })
  }

  const openBRefFromCItem = (item) => {
    if (item.type !== 'b-ref') return
    const input = item.ref?.dataFilePath
      ? createAnnotationEditorInput(item.ref.dataFilePath, {
          sourcePath: item.ref.sourceFilePath,
          entityId: item.ref.entityId,
        })
      : {
          kind: 'image',
          sourcePath: item.ref?.sourceFilePath || '',
          annotationPath: '',
          entityId: item.ref?.entityId || '',
        }
    if (!input.sourcePath && !input.annotationPath) return
    const sameSource = source?.filePath === input.sourcePath
    requestLoadABInput(input)
    setAbInspectorTab('b')
    setSelectedEntityId(item.ref.entityId)
    if (sameSource) setSelectedAnnotationIds([])
  }

  const openCRefFromCItem = async (item) => {
    if (item?.type !== 'c-ref' || !item.ref?.cFilePath) return
    const result = await window.labApi?.readCDocumentFile?.(item.ref.cFilePath)
    if (!result?.ok) return
    openCDocumentInNewWorkspace({
      ok: true,
      data: result.data,
      filePath: item.ref.cFilePath,
    })
  }

  const renderAObjectRow = (annotation, index) => {
    const relatedEntities = getEntitiesForAnnotation(annotation.id)
    const annotationFrame = getAnnotationFrame(annotation)
    const annotationTime = annotationFrame?.kind === 'video-frame'
      ? Number(annotationFrame.locator?.time)
      : null

    return (
      <details
        className={[
          'object-row',
          selectedAnnotationIds.includes(annotation.id) ? 'selected' : '',
        ].filter(Boolean).join(' ')}
        draggable
        key={annotation.id}
        open={expandedAObjectId === annotation.id}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          openAObjectMenu(annotation.id, event.clientX, event.clientY)
        }}
        onDragStart={(event) => {
          const ids = selectedAnnotationIds.includes(annotation.id)
            ? selectedAnnotationIds
            : [annotation.id]
          startAObjectDrag(event, ids)
        }}
        title={annotation.id}
      >
        <summary
          onClick={(event) => {
            event.preventDefault()
            selectAnnotationFromEvent(annotation.id, event)
            setExpandedAObjectId((current) => (current === annotation.id ? null : annotation.id))
          }}
        >
          <span>{index + 1}. {annotation.type}</span>
          <small>
            <span className="object-frame-label">{getAnnotationFrameLabel(annotation)}</span>
            {getAnnotationSummary(annotation)}
            {relatedEntities.length ? ` / B:${relatedEntities.length}` : ''}
          </small>
        </summary>
        <dl>
          <dt>time</dt>
          <dd>{Number.isFinite(annotationTime) ? formatTime(annotationTime) : '--'}</dd>
          <dt>text</dt>
          <dd>{annotation.text || '--'}</dd>
          <dt>B refs</dt>
          <dd>{relatedEntities.map((entity) => `${getSubjectLabel(entity.subject)}:${getKindLabel(entity.subject, entity.kind)}`).join(', ') || '--'}</dd>
        </dl>
      </details>
    )
  }

  const renderABInspectorContent = () => (
    <>
      <nav className="side-tabbar ab-inspector-tabbar" aria-label="AB Inspector tabs">
        {AB_INSPECTOR_TABS.map((tab) => (
          <button
            aria-label={tab.label}
            className={abInspectorTab === tab.id ? 'icon-tab active' : 'icon-tab'}
            data-tooltip={tab.label}
            key={tab.id}
            onClick={() => setAbInspectorTab(tab.id)}
            type="button"
          >
            <i className={tab.icon} />
          </button>
        ))}
      </nav>
      <div className={abInspectorTab === 'simpleNotes' ? 'ab-inspector-content simple-notes-active' : 'ab-inspector-content'}>
        {abInspectorTab === 'source' ? <section className="panel-section">
          <div className="section-title">Source</div>
          {source ? (
            <dl className="info-list">
              <dt>id</dt>
              <dd title={source.id}>{source.id}</dd>
              <dt>kind</dt>
              <dd>{source.kind}</dd>
              <dt>file</dt>
              <dd title={source.filePath}>{source.fileName}</dd>
              <dt>size</dt>
              <dd>{source.fingerprint?.size ?? '--'} bytes</dd>
              <dt>image</dt>
              <dd>{imageSize ? `${imageSize.width} x ${imageSize.height}` : '--'}</dd>
            </dl>
          ) : (
            <div className="empty-state">No source loaded.</div>
          )}
        </section> : null}

        {abInspectorTab === 'frame' ? <section className="panel-section">
          <div className="section-title">Frame List</div>
          <div className="inspector-status-row">
            <span>Frames: <strong>{frames.length}</strong></span>
            <span>Current: <strong title={frame?.id || ''}>{frame ? getFrameLabel(frame) : '--'}</strong></span>
            <span>Selected: <strong title={selectedFrameId || ''}>{selectedFrameForInspector ? getFrameLabel(selectedFrameForInspector) : '--'}</strong></span>
          </div>
          {frame ? (
            <dl className="info-list">
              <dt>id</dt>
              <dd title={frame.id}>{frame.id}</dd>
              <dt>source</dt>
              <dd title={frame.sourceId}>{frame.sourceId}</dd>
              <dt>kind</dt>
              <dd>{frame.kind}</dd>
              <dt>label</dt>
              <dd>{getFrameLabel(frame)}</dd>
            </dl>
          ) : (
            <div className="empty-state">No frame created.</div>
          )}
          {frames.length === 0 ? (
            <div className="empty-state">No frame list.</div>
          ) : (
            <div className="frame-list">
              {frames.map((item, index) => (
                <div
                  className={[
                    'frame-row',
                    item.id === selectedFrameId ? 'selected' : '',
                    item.id === frame?.id ? 'current' : '',
                  ].filter(Boolean).join(' ')}
                  key={item.id}
                  onClick={() => selectFrameFromInspector(item)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    openFrameMenu(item.id, event.clientX, event.clientY)
                  }}
                  title={item.id}
                >
                  <div className="frame-row-main">
                    <strong>{index + 1}. {getFrameLabel(item)}</strong>
                    <small>
                      {item.kind}
                      {' / '}
                      A:{annotations.filter((annotation) => annotation.frameId === item.id).length}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section> : null}

        {abInspectorTab === 'a' ? <section className="panel-section">
          <div className="section-title">A Objects</div>
          <div className="inspector-status-row">
            <span>Total: <strong>{annotations.length}</strong></span>
            <span>Selected A: <strong>{selectedAnnotationIds.length}</strong></span>
            <span>Preview A: <strong title={previewAnnotationId || ''}>{getCompactId(previewAnnotationId)}</strong></span>
          </div>
          {annotations.length === 0 ? (
            <div className="empty-state">No annotation objects.</div>
          ) : (
            <div
              className="object-list"
              onBlur={(event) => {
                if (event.currentTarget.contains(event.relatedTarget)) return
                window.setTimeout(() => {
                  setExpandedAObjectId(null)
                }, 0)
              }}
            >
              {annotations.map(renderAObjectRow)}
            </div>
          )}
        </section> : null}

        {abInspectorTab === 'b' ? <section
          className="panel-section"
          onContextMenu={(event) => {
            event.preventDefault()
            openEntityMenu(null, event.clientX, event.clientY)
          }}
        >
          <div className="section-title">B Entities</div>
          <div className="inspector-status-row">
            <span>Total: <strong>{entities.length}</strong></span>
            <span>
              Selected Entity:{' '}
              <strong title={selectedEntityForInspector?.id || ''}>
                {selectedEntityForInspector ? <EntitySourceKindIcon sourceKind={source?.kind} /> : null}
                {selectedEntityForInspector?.label || '--'}
              </strong>
            </span>
            <span>Selected A: <strong>{selectedAnnotationIds.length}</strong></span>
            <button disabled={entities.length === 0} onClick={expandAllInspectorEntities} type="button">Expand All</button>
            <button disabled={entities.length === 0} onClick={collapseAllInspectorEntities} type="button">Collapse All</button>
          </div>
          {entities.length === 0 ? (
            <div className="empty-state">No domain entities.</div>
          ) : (
            <div className="entity-list">
              {entities.map((entity, index) => (
                (() => {
                  const validation = validateDomainEntity(entity, subjectSchemas)
                  const entityTree = getEntityACardTree(entity)
                  const aObjectRefs = getEntityAObjectRefs(entity)
                  const expanded = expandedInspectorEntityIds.includes(entity.id)

                  return (
                    <div
                      className={[
                        'entity-row',
                        entity.id === selectedEntityId ? 'selected' : '',
                        expanded ? 'expanded' : '',
                        validation.ok ? '' : 'has-warning',
                      ].filter(Boolean).join(' ')}
                      key={entity.id}
                      onClick={() => {
                        setSelectedEntityId(entity.id)
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        openEntityMenu(entity.id, event.clientX, event.clientY)
                      }}
                      title={validation.ok ? '' : validation.issues.join('\n')}
                    >
                      <div className="entity-row-header">
                        <button
                          aria-label={expanded ? 'Collapse Entity' : 'Expand Entity'}
                          className="entity-expand-button"
                          data-tooltip={expanded ? 'Collapse' : 'Expand'}
                          onClick={(event) => {
                            event.stopPropagation()
                            toggleInspectorEntityExpanded(entity.id)
                          }}
                          type="button"
                        >
                          <i className={expanded ? 'fa-solid fa-caret-down' : 'fa-solid fa-caret-right'} />
                        </button>
                        <div className="entity-row-summary">
                          <span>
                            {index + 1}. <EntitySourceKindIcon sourceKind={source?.kind} />
                            {getSubjectLabel(entity.subject)} / {getKindLabel(entity.subject, entity.kind)} / {entity.label}
                          </span>
                          <small>{aObjectRefs.length} A / {validation.ok ? 'OK' : validation.issues.join('; ')}</small>
                        </div>
                      </div>
                      {!validation.ok ? (
                        <div className="entity-warning">
                          {validation.issues.join('; ')}
                        </div>
                      ) : null}
                      {expanded ? (
                        <div className="inspector-entity-tree-wrap">
                          {entityTree.length === 0 ? (
                            <div className="empty-state">No A object refs.</div>
                          ) : renderInspectorEntityTreeNodes(entityTree, entity)}
                        </div>
                      ) : null}
                    </div>
                  )
                })()
              ))}
            </div>
          )}
        </section> : null}

        {abInspectorTab === 'simpleNotes' ? <section className="panel-section simple-note-panel">
          <div className="section-title">SimpleNotes</div>
          <div className="inspector-status-row">
            <span>Total: <strong>{simpleNotes.length}</strong></span>
            <span>Visible: <strong>{visibleSimpleNotes.length}</strong></span>
            <span>At: <strong>{selectedSimpleNote ? simpleNotes.findIndex((note) => note.id === selectedSimpleNote.id) + 1 : '--'}</strong></span>
            <button disabled={source?.kind !== 'video'} onClick={() => runAction('video.simpleNote.import')} type="button">Import...</button>
            <label className="simple-note-reverse-toggle">
              <input
                checked={simpleNoteReverse}
                onChange={(event) => setSimpleNoteReverse(event.target.checked)}
                type="checkbox"
              />
              <span>Reverse</span>
            </label>
          </div>
          <label className="simple-note-filter">
            <span>Filter</span>
            <input
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setSimpleNoteFilter(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              placeholder="Content contains..."
              type="text"
              value={simpleNoteFilter}
            />
          </label>
          {simpleNotes.length === 0 ? (
            <div className="empty-state">No SimpleNotes.</div>
          ) : visibleSimpleNotes.length === 0 ? (
            <div className="empty-state">No SimpleNote matches.</div>
          ) : (
            <ul
              aria-label="SimpleNotes"
              className="simple-note-list"
              onKeyDown={handleSimpleNoteListKeyDown}
              ref={simpleNoteListRef}
              tabIndex={0}
            >
              {visibleSimpleNotes.map(({ note, index }) => (
                <li
                  className={[
                    'simple-note-row',
                    note.id === selectedSimpleNoteId ? 'selected' : '',
                  ].filter(Boolean).join(' ')}
                  data-simple-note-id={note.id}
                  key={note.id}
                  onClick={() => {
                    selectSimpleNote(note.id)
                    simpleNoteListRef.current?.focus()
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    selectSimpleNote(note.id)
                    simpleNoteListRef.current?.focus()
                    setFrameMenu(null)
                    setAObjectMenu(null)
                    setEntityMenu(null)
                    setSimpleNoteMenu({
                      noteId: note.id,
                      x: event.clientX,
                      y: event.clientY,
                    })
                  }}
                  title={note.id}
                >
                  <div className="simple-note-row-head">
                    <strong>{index + 1}. {note.start || '--'} {getSimpleNoteDurationLabel(note)}</strong>
                    {note.importFile ? <em title={[note.importFile, note.importTime].filter(Boolean).join('\n')}>Import</em> : null}
                  </div>
                  <small className="simple-note-row-content">{note.content || 'Empty content'}</small>
                </li>
              ))}
            </ul>
          )}
        </section> : null}
      </div>
    </>
  )

  return (
    <main
      className={[
        'app-shell',
        leftPanelCollapsed ? 'left-panel-collapsed' : '',
      ].filter(Boolean).join(' ')}
      style={{
        '--left-panel-width': leftPanelCollapsed ? '0px' : `${leftPanelWidth}px`,
      }}
    >
      <aside className={leftPanelCollapsed ? 'left-panel side-panel collapsed' : 'left-panel side-panel'}>
        <nav className="side-tabbar" aria-label="Left panel tabs">
          {LEFT_TABS.map((tab) => (
            <button
              aria-label={tab.label}
              className={leftTab === tab.id ? 'icon-tab active' : 'icon-tab'}
              data-tooltip={tab.label}
              key={tab.id}
              onClick={() => setLeftTab(tab.id)}
              type="button"
            >
              <i className={tab.icon} />
            </button>
          ))}
        </nav>
        <div className="side-panel-content">
        {leftTab === 'entityFiles' ? (
          <>
            <button className="primary-button" onClick={() => runAction('picture.openImage')} type="button">
              Open Image
            </button>
            <button className="primary-button" onClick={() => runAction('video.openVideo')} type="button">
              Open Video
            </button>
            <button className="primary-button" onClick={() => runAction('pdf.openPdf')} type="button">
              Open PDF
            </button>
            <button disabled={activeWorkspaceTab.type !== 'ab' || source?.kind !== 'video'} onClick={() => runAction('video.playPause')} type="button">
              Play / Pause
            </button>
            <button onClick={() => runAction(source?.kind === 'video' ? 'video.openAnnotation' : 'picture.openAnnotation')} type="button">
              Open JSON
            </button>
            <button disabled={!source || saveStatus !== 'Unsaved'} onClick={() => runAction(source?.kind === 'video' ? 'video.saveJson' : 'picture.saveJson')} type="button">
              Save JSON
            </button>

            <section className="panel-section">
              <div className="section-title">A Layer</div>
              <button className={toolMode === 'select' ? 'active-tool' : ''} onClick={() => runAction('picture.tool.select')} type="button">Select</button>
              <button className={toolMode === 'rect' ? 'active-tool' : ''} onClick={() => runAction('picture.tool.rect')} type="button">Rect</button>
              <button className={toolMode === 'arrow' ? 'active-tool' : ''} onClick={() => runAction('picture.tool.arrow')} type="button">Arrow</button>
              <button className={toolMode === 'polygon' ? 'active-tool' : ''} onClick={() => runAction('picture.tool.polygon')} type="button">Polygon</button>
              <button className={toolMode === 'text' ? 'active-tool' : ''} onClick={() => runAction('picture.tool.text')} type="button">Text</button>
              <button disabled={selectedAnnotationIds.length === 0} onClick={() => runAction('picture.deleteSelected')} type="button">Delete</button>
              <button disabled={!canUndoDelete} onClick={() => runAction('global.undoDelete')} title="Undo Delete" type="button">Undo</button>
            </section>

            <section className="panel-section">
              <div className="section-title">View</div>
              <button onClick={() => runAction('picture.zoom.fit')} type="button">Fit</button>
              <button onClick={() => runAction('picture.zoom.actual')} type="button">100%</button>
              <button onClick={() => runAction('picture.zoom.out')} type="button">Zoom Out</button>
              <button onClick={() => runAction('picture.zoom.in')} type="button">Zoom In</button>
            </section>

            <section className="panel-section">
              <div className="section-title">B Layer</div>
              <button type="button">Math</button>
              <button type="button">English</button>
            </section>
          </>
        ) : leftTab === 'compositeFiles' ? (
          <section className="panel-section c-panel">
            <div className="section-title">CompositeFiles</div>
            <div className="c-toolbar">
              <button onClick={newCDocument} type="button">New</button>
              <button onClick={openCDocument} type="button">Open</button>
              <button disabled={!activeCWorkspaceId || !activeCWorkspace.cDocumentFilePath} onClick={reloadCDocument} type="button">Reload</button>
              <button disabled={!activeCWorkspaceId} onClick={saveCDocument} type="button">Save</button>
              <button disabled={!activeCWorkspaceId} onClick={saveCDocumentAs} type="button">Save As</button>
              <button disabled={!activeCWorkspaceId} onClick={closeCDocument} type="button">Close</button>
              <button
                disabled={!activeCWorkspaceId}
                onClick={() => {
                  setCompositeRepairRequestId((current) => current + 1)
                  requestActivateWorkspaceTab(activeCWorkspaceId)
                }}
                type="button"
              >
                Repair References...
              </button>
            </div>
            <dl className="c-doc-info">
              <dt>Title</dt>
              <dd title={visibleCWorkspace.cDocument.title}>{visibleCWorkspace.cDocument.title}</dd>
              <dt>Type</dt>
              <dd>{visibleCWorkspace.cDocument.subject} / {visibleCWorkspace.cDocument.kind}</dd>
              <dt>File</dt>
              <dd title={visibleCWorkspace.cDocumentFilePath}>{visibleCWorkspace.cDocumentFilePath || '--'}</dd>
              <dt>Status</dt>
              <dd className={visibleCWorkspace.cSaveStatus === 'Unsaved' ? 'status-unsaved' : ''}>{visibleCWorkspace.cSaveStatus}</dd>
              <dt>Items</dt>
              <dd>{visibleCWorkspace.cDocument.items.length}</dd>
              <dt>B Sources</dt>
              <dd>{visibleCWorkspace.bIndexSources.length}</dd>
              <dt>B Pool</dt>
              <dd>{visibleCWorkspace.bIndexItems.length}</dd>
            </dl>
          </section>
        ) : leftTab === 'folder' ? (
          <section className="panel-section recent-panel">
            <div className="section-title">Folder Images</div>
            <div className="folder-path" title={imageFolderPath}>{imageFolderPath || 'No folder loaded.'}</div>
            {imageFolderItems.length === 0 ? (
              <div className="empty-state">No image file.</div>
            ) : (
              <div className="recent-list">
                {imageFolderItems.map((item) => (
                  <button
                    className={source?.filePath === item.filePath ? 'selected-file' : ''}
                    key={item.filePath}
                    onDoubleClick={() => openImageByPath(item.filePath)}
                    title={item.filePath}
                    type="button"
                  >
                    {item.fileName}
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : (
          <section className="panel-section recent-panel">
            <div className="section-title">Recent Files</div>
            {recentFiles.length === 0 ? (
              <div className="empty-state">No recent file.</div>
            ) : (
              <div className="recent-list">
                {recentFiles.map((item) => (
                  <button
                    key={item.filePath}
                    onDoubleClick={() => openRecentFile(item)}
                    title={item.filePath}
                    type="button"
                  >
                    <span>{item.fileName}</span>
                    <small>{item.kind || 'image'}</small>
                  </button>
                ))}
              </div>
            )}
          </section>
          )}
        </div>
      </aside>

      <div
        aria-label="Resize left panel"
        className={leftPanelCollapsed ? 'panel-splitter left collapsed' : 'panel-splitter left'}
        onDoubleClick={toggleLeftPanelCollapsed}
        onMouseDown={(event) => startPanelResize('left', event)}
        role="separator"
        title={leftPanelCollapsed ? 'Show left panel' : 'Resize left panel / double click to hide'}
      />

      <section className="editor-host">
        <div className="workspace-tabs">
          {workspaceTabs.map((tab) => (
            <div
              className={[
                'workspace-tab',
                tab.type,
                tab.id === activeWorkspaceTab.id ? 'active' : '',
              ].filter(Boolean).join(' ')}
              key={tab.id}
              onContextMenu={(event) => openWorkspaceTabMenu(event, tab)}
              title={tab.title}
            >
              <button
                className="workspace-tab-main"
                onClick={() => requestActivateWorkspaceTab(tab.id)}
                type="button"
              >
                <span>{tab.type === 'ab' ? 'A/B' : 'C'}</span>
                <strong>{tab.title}</strong>
                {tab.dirty ? <em aria-label="Unsaved" title="Unsaved">*</em> : null}
              </button>
            </div>
          ))}
        </div>
        {workspaceTabMenu ? (
          <div
            className="workspace-tab-context-menu"
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
            style={{
              left: workspaceTabMenu.x,
              top: workspaceTabMenu.y,
            }}
          >
            <button onClick={() => saveWorkspaceTab(workspaceTabMenu.tabId)} type="button">Save</button>
            <button onClick={() => closeWorkspaceTab(workspaceTabMenu.tabId)} type="button">Close</button>
          </div>
        ) : null}
        {activeWorkspaceTab.type === 'c' ? (
          <CompositeEditor
            bIndexItems={activeCWorkspace.bIndexItems}
            bIndexSources={activeCWorkspace.bIndexSources}
            bIndexFilter={activeCWorkspace.bIndexFilter}
            cDocument={activeCWorkspace.cDocument}
            cDocumentFilePath={activeCWorkspace.cDocumentFilePath}
            cSaveStatus={activeCWorkspace.cSaveStatus}
            previewResources={cPreviewResources}
            canUndoDelete={canUndoDelete}
            layoutState={activeCWorkspace.layoutState}
            onAddBIndexItem={addBIndexItemToCDocument}
            onAddCRefItem={addCRefItemToCDocument}
            onAddFileRefItem={addFileRefItemToCDocument}
            onAddTextItem={addTextItemToCDocument}
            onChangeItems={changeCItems}
            onDeleteItem={deleteCItem}
            onExport={() => exportCompositeItems('all')}
            onExportSelected={() => exportCompositeItems('selected')}
            onOpenBRef={openBRefFromCItem}
            onOpenCRef={openCRefFromCItem}
            onScanAnnotationFiles={scanBEntityAnnotationFiles}
            onScanFolders={scanBEntityIndex}
            onLayoutStateChange={updateActiveCLayoutState}
            onSelectBIndexItem={selectBIndexItem}
            onSelectItem={(itemId) => updateActiveCWorkspace({ selectedBIndexItemKey: '', selectedCItemId: itemId })}
            onUpdateBIndexFilter={updateBIndexFilter}
            onUpdateDocumentField={updateCDocumentField}
            onUpdateItemText={updateCItemText}
            onUndoDelete={undoLastDelete}
            repairRequestId={compositeRepairRequestId}
            selectedBIndexItemKey={activeCWorkspace.selectedBIndexItemKey}
            selectedCItemId={activeCWorkspace.selectedCItemId}
            subjectSchemas={subjectSchemas}
            workspaceId={activeCWorkspaceId}
          />
        ) : (
          <div className="ab-workspace">
            <ABEditor
              annotationFilePath={annotationFilePath}
              annotations={annotations}
              bindFrameRequest={bindFrameRequest}
              cancelTextEdit={cancelTextEdit}
              commitTextEdit={commitTextEdit}
              displayInput={currentABInput}
              displayMessage={message}
              entities={entities}
              editingTextAnnotation={editingTextAnnotation}
              formatEntityLabel={(entity) => (
                <>
                  <EntitySourceKindIcon sourceKind={source?.kind} />
                  {getKindLabel(entity.subject, entity.kind)}: {entity.label}
                </>
              )}
              frame={frame}
              frames={frames}
              framePreviewUrl={framePreviewUrl}
              ensureAnnotationPreview={ensureAnnotationPreview}
              getAnnotationPreview={getAnnotationPreview}
              inspectorContent={renderABInspectorContent()}
              imageSize={imageSize}
              initialInput={pendingABInput}
              isDirty={saveStatus === 'Unsaved'}
              layoutState={editorWorkspace.sessions.find((session) => session.id === editorWorkspace.activeId)?.layoutState}
              curEnd={curEnd}
              curStart={curStart}
              mediaBottomTab={abMediaBottomTab}
              onAddAnnotation={addAnnotation}
              onAddTextAnnotation={addTextAnnotation}
              onBindCurrentVideoFrame={openBindFrameConfirmDialog}
              onUseVideoFrame={useVideoFrame}
              onClearSelection={clearSelection}
              onCreateEntity={createBWorkflowEntity}
              onDeleteSelectedAnnotations={deleteSelectedAnnotation}
              onDeleteSimpleNote={deleteSimpleNote}
              onEditTextAnnotation={startEditTextAnnotation}
              onExportSelectedAnnotationCrop={exportSingleAnnotationCrop}
              onExportSelectedEntity={exportEntityCrops}
              onExportSelectedEntityItems={exportSelectedEntityItems}
              onAppendSimpleNote={() => appendSimpleNoteMark()}
              onAppendQuickSimpleNote={() => appendSimpleNoteMark({ quick: true })}
              onQuickUpdateSimpleNoteRange={quickUpdateSimpleNoteRange}
              onSetSimpleNoteEnd={setSimpleNoteEndFromPlayback}
              onSetSimpleNoteStart={setSimpleNoteStartFromPlayback}
              onUpdateSimpleNoteContent={updateSimpleNoteContent}
              onVideoPlaybackInfo={setVideoPlaybackInfo}
              onVideoSeekBy={seekCurrentVideoBy}
              onWriteCurrentRangeToSimpleNote={writeCurrentRangeToSimpleNote}
              canGoToAnnotation={(annotation) => Boolean(
                annotation && (getAnnotationVideoTarget(annotation) || getAnnotationPdfTarget(annotation))
              )}
              onGoToAnnotation={goToAnnotation}
              onImageSizeChange={setImageSize}
              onPdfDocumentInfo={updatePdfDocumentInfo}
              onPdfPageChange={changePdfPage}
              onPdfPageInfo={updatePdfPageInfo}
              onPdfPageSnapshot={usePdfPageSnapshot}
              onPdfViewModeChange={setPdfViewMode}
              onFitZoom={setFitZoom}
              onActualSizeZoom={setActualSizeZoom}
              onZoomChange={setManualZoom}
              onLayoutStateChange={updateActiveEditorLayoutState}
              onOpenAddToEntityDialog={openAddToEntityDialog}
              onOpenEntityDialog={openEntityDialog}
              onRequestPlayPauseVideo={requestPlayPauseVideo}
              onMediaBottomTabChange={setAbMediaBottomTab}
              onSelectAnnotation={selectAnnotationFromEvent}
              onSelectAnnotations={selectAnnotationsFromChild}
              onSessionLoadError={handleABSessionLoadError}
              onSessionLoaded={applyImageEditorSession}
              onSessionLoadStart={handleABSessionLoadStart}
              onSaveAnnotations={saveAnnotations}
              onUpdateAnnotation={updateAnnotation}
              onUpdateEntity={updateBWorkflowEntity}
              onToolModeChange={changeActiveToolMode}
              playPauseRequestId={playPauseRequestId}
              pdfPage={pdfPage}
              pdfNavigationRequest={pdfNavigationRequest}
              pdfViewMode={pdfViewMode}
              showBindFrameOverlay={Boolean(pendingBindFrame)}
              saveStatus={saveStatus}
              selectedAnnotationIds={selectedAnnotationIds}
              selectedSimpleNote={selectedSimpleNote}
              simpleNoteDraft={simpleNoteDraft}
              simpleNotes={simpleNotes}
              previewAnnotationId={previewAnnotationId}
              selectedEntity={selectedEntityForInspector}
              source={source}
              subjectSchemas={subjectSchemas}
              textDraft={textDraft}
              toolMode={toolMode}
              updateSimpleNoteDraft={setSimpleNoteDraft}
              updateTextDraft={setTextDraft}
              videoPlaybackInfo={videoPlaybackInfo}
              videoSeekRequest={videoSeekRequest}
              zoom={zoom}
              zoomMode={zoomMode}
            />
          </div>
        )}
      </section>

      {aObjectMenu ? (
        (() => {
          const annotation = getAnnotationById(aObjectMenu.annotationId)
          const canGoTo = Boolean(annotation && (
            getAnnotationVideoTarget(annotation) || getAnnotationPdfTarget(annotation)
          ))
          const canBindToCurrentFrame = Boolean(source?.kind === 'video' && selectedAnnotationIds.length > 0)
          return (
            <div
              className="context-menu"
              onContextMenu={(event) => event.preventDefault()}
              style={{
                left: aObjectMenu.x,
                top: aObjectMenu.y,
              }}
            >
              <button disabled={!canGoTo} onClick={() => runAction('ab.aObject.goTo')} type="button">Go To</button>
              <button disabled={!canBindToCurrentFrame} onClick={() => {
                requestBindSelectedAnnotationsToCurrentPlaybackFrame()
                closeAObjectMenu()
              }} type="button">Bind To Current Frame</button>
              <div className="context-menu-separator" />
              <button onClick={() => {
                deleteSelectedAnnotation()
                closeAObjectMenu()
              }} type="button">Delete</button>
              <div className="context-menu-separator" />
              <button onClick={closeAObjectMenu} type="button">Cancel</button>
            </div>
          )
        })()
      ) : null}

      {frameMenu ? (
        <div
          className="context-menu"
          onContextMenu={(event) => event.preventDefault()}
          style={{
            left: frameMenu.x,
            top: frameMenu.y,
          }}
        >
          <button onClick={() => runAction('ab.frame.goTo')} type="button">Go To Frame</button>
          <div className="context-menu-separator" />
          <button onClick={closeFrameMenu} type="button">Cancel</button>
        </div>
      ) : null}

      {simpleNoteMenu ? (
        (() => {
          const note = simpleNotes.find((item) => item.id === simpleNoteMenu.noteId)
          const canGoTo = Boolean(source?.kind === 'video' && note?.start)
          return (
            <div
              className="context-menu"
              onContextMenu={(event) => event.preventDefault()}
              style={{
                left: simpleNoteMenu.x,
                top: simpleNoteMenu.y,
              }}
            >
              <button disabled={!canGoTo} onClick={() => {
                runAction('video.simpleNote.goTo')
                setSimpleNoteMenu(null)
              }} type="button">GO TO</button>
              <button onClick={() => {
                runAction('video.simpleNote.delete')
                setSimpleNoteMenu(null)
              }} type="button">Delete</button>
              <div className="context-menu-separator" />
              <button onClick={() => setSimpleNoteMenu(null)} type="button">Cancel</button>
            </div>
          )
        })()
      ) : null}

      {entityMenu ? (
        (() => {
          const entity = entities.find((item) => item.id === entityMenu.entityId)
          const firstAnnotation = entity ? getFirstEntityAnnotation(entity) : null
          const canGoToEntity = Boolean(firstAnnotation && (
            getAnnotationVideoTarget(firstAnnotation) || getEntityDefaultFrame(entity)
          ))
          return (
            <div
              className="context-menu"
              onContextMenu={(event) => event.preventDefault()}
              style={{
                left: entityMenu.x,
                top: entityMenu.y,
              }}
            >
              <button onClick={() => openEntityDialog()} type="button">New Entity...</button>
              {entityMenu.entityId ? (
                <>
                  <button disabled={!canGoToEntity} onClick={() => runAction('ab.entity.goTo')} type="button">Go To</button>
                  <button onClick={() => editEntityInWorkflow(entityMenu.entityId)} type="button">Edit In Workflow</button>
                  <button onClick={() => openEntityDialog({ entityId: entityMenu.entityId })} type="button">Edit Entity...</button>
                  <button onClick={() => duplicateBEntity(entityMenu.entityId)} type="button">Duplicate Entity</button>
                  <button onClick={() => deleteBEntity(entityMenu.entityId)} type="button">Delete Entity</button>
                </>
              ) : null}
              <div className="context-menu-separator" />
              <button onClick={closeEntityMenu} type="button">Cancel</button>
            </div>
          )
        })()
      ) : null}

      {addToEntityDialog ? (
        (() => {
          const entity = entities.find((item) => item.id === addToEntityDialog.entityId)
          const schema = getDomainSchema(entity?.subject, subjectSchemas)
          const roleOptions = getDomainRolesForKind(schema, entity?.kind)
          const roleMissing = addToEntityDialog.role && !roleOptions.some((option) => option.value === addToEntityDialog.role)

          return (
            <div className="dialog-layer">
              <div className="entity-dialog">
                <div className="dialog-title">Add To Entity</div>
                <dl className="dialog-info">
                  <dt>Entity</dt>
                  <dd>
                    {entity ? (
                      <>
                        <EntitySourceKindIcon sourceKind={source?.kind} />
                        {getKindLabel(entity.subject, entity.kind)}: {entity.label}
                      </>
                    ) : '--'}
                  </dd>
                  <dt>A Objects</dt>
                  <dd>{addToEntityDialog.annotationIds.length}</dd>
                </dl>
                <label>
                  Role
                  <select
                    autoFocus
                    onChange={(event) => setAddToEntityDialog((current) => ({ ...current, role: event.target.value }))}
                    value={addToEntityDialog.role}
                  >
                    {roleMissing ? (
                      <option value={addToEntityDialog.role}>{addToEntityDialog.role} (invalid)</option>
                    ) : null}
                    {roleOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <div className="dialog-actions">
                  <button onClick={addAObjectToEntity} type="button">OK</button>
                  <button onClick={closeAddToEntityDialog} type="button">Cancel</button>
                </div>
              </div>
            </div>
          )
        })()
      ) : null}

      {pendingEditorCloseSessionId ? (
        (() => {
          const session = getEditorSessionSnapshot(pendingEditorCloseSessionId)
          return (
            <div className="dialog-layer">
              <div className="entity-dialog">
                <div className="dialog-title">Close Editor</div>
                <dl className="dialog-info">
                  <dt>Target</dt>
                  <dd>{session?.title || '--'}</dd>
                  <dt>Status</dt>
                  <dd>{session?.saveStatus || '--'}</dd>
                </dl>
                <div className="dialog-message">
                  This editor has unsaved annotation changes.
                </div>
                <div className="dialog-actions">
                  <button onClick={() => confirmEditorClose('save')} type="button">Save</button>
                  <button onClick={() => confirmEditorClose('discard')} type="button">Discard</button>
                  <button onClick={() => confirmEditorClose('cancel')} type="button">Cancel</button>
                </div>
              </div>
            </div>
          )
        })()
      ) : null}

      {pendingAnnotationDelete ? (
        <div className="dialog-layer">
          <div className="entity-dialog">
            <div className="dialog-title">Delete A Object</div>
            <dl className="dialog-info">
              <dt>A Objects</dt>
              <dd>{pendingAnnotationDelete.objectCount}</dd>
              <dt>Types</dt>
              <dd>{pendingAnnotationDelete.typeSummary || '--'}</dd>
              <dt>Used by</dt>
              <dd>
                {pendingAnnotationDelete.referencedEntityCount}{' '}
                {pendingAnnotationDelete.referencedEntityCount === 1 ? 'Entity' : 'Entities'}
              </dd>
            </dl>
            <div className="dialog-message">
              {pendingAnnotationDelete.referencedEntityCount > 0
                ? `${pendingAnnotationDelete.referencedEntityCount} ${pendingAnnotationDelete.referencedEntityCount === 1 ? 'Entity uses' : 'Entities use'} the selected A Object(s). Their references to these objects will also be removed.`
                : 'No Entity uses the selected A Object(s).'}
            </div>
            <div className="dialog-actions">
              <button autoFocus onClick={confirmDeleteSelectedAnnotations} type="button">Delete</button>
              <button onClick={() => setPendingAnnotationDelete(null)} type="button">Cancel</button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingImageSwitch ? (
        <div className="dialog-layer">
          <div className="entity-dialog">
            <div className="dialog-title">Unsaved Annotation</div>
            <dl className="dialog-info">
              <dt>Current</dt>
              <dd>{source?.fileName || '--'}</dd>
              <dt>Target</dt>
              <dd>{getInputTitle(pendingImageSwitch)}</dd>
            </dl>
            <div className="dialog-message">
              Current annotation has unsaved changes.
            </div>
            <div className="dialog-actions">
              <button onClick={() => confirmPendingImageSwitch('save')} type="button">Save</button>
              <button onClick={() => confirmPendingImageSwitch('discard')} type="button">Discard</button>
              <button onClick={() => confirmPendingImageSwitch('cancel')} type="button">Cancel</button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingBindFrame ? (
        (() => {
          const dialogPosition = getBindFrameDialogPosition()
          return (
            <div
              className="entity-dialog bind-frame-dialog bind-frame-floating-dialog"
              style={{
                left: dialogPosition.x,
                top: dialogPosition.y,
              }}
            >
            <div
              className="dialog-title bind-frame-drag-handle"
              onMouseDown={(event) => {
                event.preventDefault()
                startBindFrameDialogDrag(event)
              }}
            >
              Bind To Current Frame
            </div>
            <div className="bind-frame-time">
              {formatTime(pendingBindFrame.time)}
            </div>
            <dl className="dialog-info">
              <dt>A Objects</dt>
              <dd>{pendingBindFrame.annotationIds.length}</dd>
              <dt>Video</dt>
              <dd title={source?.filePath || ''}>{source?.fileName || '--'}</dd>
              <dt>Size</dt>
              <dd>
                {pendingBindFrame.videoSize?.width && pendingBindFrame.videoSize?.height
                  ? `${pendingBindFrame.videoSize.width} x ${pendingBindFrame.videoSize.height}`
                  : '--'}
              </dd>
            </dl>
            <div className="dialog-message">
              Confirm binding selected A object(s) to this playback timestamp.
            </div>
            <div className="dialog-actions bind-frame-actions">
              <button onClick={() => adjustPendingBindFrameTime(-0.5)} type="button">-0.5s</button>
              <button onClick={() => adjustPendingBindFrameTime(0.5)} type="button">+0.5s</button>
              <button onClick={confirmBindFrame} type="button">Confirm</button>
              <button onClick={cancelBindFrame} type="button">Cancel</button>
            </div>
            </div>
          )
        })()
      ) : null}

      {settingsDialog ? (
        (() => {
          const mainTab = settingsDialog.mainTab || 'general'
          const shortcutTab = settingsDialog.shortcutTab || 'video'
          const shortcutConflicts = getShortcutConflicts(settingsDialog.draft.shortcuts)
          const visibleShortcutActions = registeredActions
            .filter((action) => action.scope === shortcutTab)
            .map((action) => ({
              ...action,
              shortcut: settingsDialog.draft.shortcuts?.[shortcutTab]?.[action.id] || '',
            }))
          const shortcutGroups = shortcutTab === 'global'
            ? [
                {
                  title: 'Normal Shortcuts',
                  rows: visibleShortcutActions.filter((action) => !String(action.shortcut || '').includes(' ')),
                },
                {
                  title: 'Chord Shortcuts',
                  rows: visibleShortcutActions.filter((action) => String(action.shortcut || '').includes(' ')),
                },
              ]
            : [{ title: '', rows: visibleShortcutActions }]
          const renderShortcutRow = (action) => (
            <label
              className={shortcutConflicts[shortcutTab]?.has(action.id)
                ? 'settings-shortcut-row conflict'
                : 'settings-shortcut-row'}
              key={action.id}
            >
              <span>
                <strong>{action.label}</strong>
                <small>{action.description || action.id}</small>
              </span>
              <div className="settings-shortcut-input-wrap">
                <input
                  onChange={() => {}}
                  onKeyDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    if (event.key === 'Backspace' || event.key === 'Delete') {
                      setShortcutDraftValue(shortcutTab, action.id, '')
                      return
                    }
                    if (event.key === 'Escape') {
                      cancelShortcutCapture()
                      return
                    }
                    const shortcut = formatShortcutEvent(event)
                    if (shortcut) captureShortcutDraftValue(shortcutTab, action.id, shortcut)
                  }}
                  placeholder={pendingShortcutCapture?.scope === shortcutTab && pendingShortcutCapture?.actionId === action.id
                    ? 'Press second key...'
                    : 'Click and press keys'}
                  value={action.shortcut || ''}
                />
                <button onClick={() => setShortcutDraftValue(shortcutTab, action.id, '')} type="button">Clear</button>
              </div>
            </label>
          )
          return (
            <div className="dialog-layer settings-dialog-layer">
              <section className="settings-dialog" aria-label="Global settings">
                <div className="settings-main">
                  <div className="settings-main-tabs" role="tablist" aria-label="Settings tabs">
                    {SETTINGS_MAIN_TABS.map((tab) => (
                      <button
                        className={mainTab === tab.id ? 'settings-tab active' : 'settings-tab'}
                        key={tab.id}
                        onClick={() => setSettingsDialog((current) => ({ ...current, mainTab: tab.id }))}
                        type="button"
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="settings-tab-page">
                    {mainTab === 'general' ? (
                      <div className="settings-general-sections">
                        <section className="settings-section">
                          <div className="settings-section-title">Common</div>
                          <div className="settings-form-grid">
                            <label htmlFor="settings-frame-tolerance">Frame timestamp tolerance</label>
                            <div className="settings-unit-row">
                              <input
                                autoFocus
                                id="settings-frame-tolerance"
                                min="0"
                                onChange={(event) => {
                                  const value = Number(event.target.value)
                                  patchSettingsDraft({
                                    frameTimestampToleranceSeconds: Number.isFinite(value) ? value : '',
                                  })
                                }}
                                step="0.01"
                                type="number"
                                value={settingsDialog.draft.frameTimestampToleranceSeconds}
                              />
                              <span>seconds</span>
                            </div>
                            <label htmlFor="settings-video-preview-cache-mb">Media preview cache</label>
                            <div className="settings-unit-row">
                              <input
                                id="settings-video-preview-cache-mb"
                                max="2048"
                                min="32"
                                onChange={(event) => patchSettingsDraft({
                                  videoPreviewCacheMaxMB: event.target.value,
                                })}
                                step="1"
                                type="number"
                                value={settingsDialog.draft.videoPreviewCacheMaxMB}
                              />
                              <span>MB</span>
                            </div>
                            <label htmlFor="settings-video-preview-cache-frames">Media preview item limit</label>
                            <div className="settings-unit-row">
                              <input
                                id="settings-video-preview-cache-frames"
                                max="512"
                                min="8"
                                onChange={(event) => patchSettingsDraft({
                                  videoPreviewCacheMaxFrames: event.target.value,
                                })}
                                step="1"
                                type="number"
                                value={settingsDialog.draft.videoPreviewCacheMaxFrames}
                              />
                              <span>frames</span>
                            </div>
                            <label htmlFor="settings-video-preview-concurrency">Concurrent media snapshots</label>
                            <div className="settings-unit-row">
                              <input
                                id="settings-video-preview-concurrency"
                                max="8"
                                min="1"
                                onChange={(event) => patchSettingsDraft({
                                  videoPreviewMaxConcurrentCaptures: event.target.value,
                                })}
                                step="1"
                                type="number"
                                value={settingsDialog.draft.videoPreviewMaxConcurrentCaptures}
                              />
                              <span>tasks</span>
                            </div>
                          </div>
                          <small>
                            Frame tolerance controls timestamp matching. Media preview limits cover video frames and PDF pages, are shared by all CEditor sessions, and apply without restarting.
                          </small>
                        </section>

                        <section className="settings-section">
                          <div className="settings-section-title">Video</div>
                          <div className="settings-empty compact">No video-only settings yet.</div>
                        </section>

                        <section className="settings-section">
                          <div className="settings-section-title">Picture</div>
                          <div className="settings-empty compact">No picture-only settings yet.</div>
                        </section>

                        <section className="settings-section">
                          <div className="settings-section-title">PDF</div>
                          <div className="settings-empty compact">No PDF-only settings yet.</div>
                        </section>
                      </div>
                    ) : null}

                    {mainTab === 'shortcuts' ? (
                      <div className="settings-shortcuts">
                        <div className="settings-shortcut-tabs" role="tablist" aria-label="Shortcut scopes">
                          {SETTINGS_SHORTCUT_TABS.map((tab) => (
                            <button
                              className={shortcutTab === tab.id ? 'settings-tab active' : 'settings-tab'}
                              key={tab.id}
                              onClick={() => setSettingsDialog((current) => ({ ...current, shortcutTab: tab.id }))}
                              type="button"
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                        <div className="settings-shortcut-page">
                          {visibleShortcutActions.length === 0 ? (
                            <div className="settings-empty">No actions registered for this scope yet.</div>
                          ) : shortcutGroups.map((group) => (
                            <section className="settings-shortcut-group" key={group.title || 'default'}>
                              {group.title ? (
                                <div className="settings-shortcut-group-title">
                                  <span>{group.title}</span>
                                </div>
                              ) : null}
                              {group.rows.length === 0 ? (
                                <div className="settings-empty compact">No shortcut items.</div>
                              ) : group.rows.map(renderShortcutRow)}
                            </section>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="settings-actions">
                  <span className={settingsDialog.error ? 'settings-message error' : 'settings-message'}>
                    {settingsDialog.error || ''}
                  </span>
                  <button onClick={() => saveSettingsDialog()} type="button">Save</button>
                  <button className="primary" onClick={() => saveSettingsDialog({ close: true })} type="button">Save&amp;Exit</button>
                  <button onClick={() => { cancelShortcutCapture(); setSettingsDialog(null) }} type="button">Cancel</button>
                </div>
              </section>
            </div>
          )
        })()
      ) : null}

      {entityDialog ? (
        <div className="dialog-layer">
          <div className="entity-dialog">
            <div className="dialog-title">
              <EntitySourceKindIcon sourceKind={source?.kind} />
              {entityDialog.sourceAObjectIds?.length ? 'New Entity From A Objects' : 'New Entity'}
            </div>
            <label>
              Subject
              <select
                onChange={(event) => updateEntityDialogSubject(event.target.value)}
                value={entityDialog.subject}
              >
                {subjectSchemas.map((schema) => (
                  <option key={schema.id} value={schema.id}>{schema.label}</option>
                ))}
              </select>
            </label>
            <label>
              Kind
              <select
                onChange={(event) => updateEntityDialogKind(event.target.value)}
                value={entityDialog.kind}
              >
                {(() => {
                  const schema = getDomainSchema(entityDialog.subject, subjectSchemas)
                  return entityDialog.kind && !schema.kinds.some((option) => option.value === entityDialog.kind)
                    ? <option value={entityDialog.kind}>{entityDialog.kind} (invalid)</option>
                    : null
                })()}
                {(getDomainSchema(entityDialog.subject, subjectSchemas)?.kinds || []).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              SubKind
              <select
                onChange={(event) => setEntityDialog((current) => ({ ...current, subKind: event.target.value }))}
                value={entityDialog.subKind || ''}
              >
                <option value="">--</option>
                {(() => {
                  const schema = getDomainSchema(entityDialog.subject, subjectSchemas)
                  const subKinds = getDomainKind(schema, entityDialog.kind)?.subKinds || []
                  return entityDialog.subKind && !subKinds.some((option) => option.value === entityDialog.subKind)
                    ? <option value={entityDialog.subKind}>{entityDialog.subKind} (invalid)</option>
                    : null
                })()}
                {(
                  getDomainKind(getDomainSchema(entityDialog.subject, subjectSchemas), entityDialog.kind)?.subKinds || []
                ).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              Label
              <input
                autoFocus
                onChange={(event) => setEntityDialog((current) => ({ ...current, label: event.target.value }))}
                value={entityDialog.label}
              />
            </label>
            <div className="dialog-actions">
              <button onClick={saveEntityDialog} type="button">OK</button>
              <button onClick={closeEntityDialog} type="button">Cancel</button>
            </div>
          </div>
        </div>
      ) : null}

      {exportResultDialog ? (
        <div className="dialog-layer">
          <div className="entity-dialog export-result-dialog">
            <div className="dialog-title">{exportResultDialog.title}</div>
            <div className={`export-result-status ${exportResultDialog.status}`}>
              {exportResultDialog.status === 'success'
                ? 'Export succeeded'
                : exportResultDialog.status === 'partial'
                  ? 'Export partially succeeded'
                  : 'Export failed'}
            </div>
            <dl className="dialog-info export-result-summary">
              <dt>Location</dt>
              <dd className="export-result-path" title={exportResultDialog.folderPath || ''}>
                {exportResultDialog.folderPath || '--'}
              </dd>
              <dt>Requested</dt>
              <dd>{exportResultDialog.requestedCount}</dd>
              <dt>Succeeded</dt>
              <dd>{exportResultDialog.successCount}</dd>
              <dt>Failed</dt>
              <dd>{exportResultDialog.failedCount}</dd>
              <dt>Entities</dt>
              <dd>{exportResultDialog.entityCount}</dd>
              <dt>A Objects</dt>
              <dd>{exportResultDialog.aObjectCount}</dd>
              <dt>Text / Image files</dt>
              <dd>{exportResultDialog.otherItemCount}</dd>
            </dl>
            {exportResultDialog.reasons.length ? (
              <div className="export-result-errors">
                <strong>Error summary</strong>
                <ul>
                  {exportResultDialog.reasons.slice(0, 5).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                {exportResultDialog.reasons.length > 5 ? (
                  <small>More errors are recorded in _export_errors.txt.</small>
                ) : null}
              </div>
            ) : null}
            <div className="dialog-actions">
              <button autoFocus onClick={() => setExportResultDialog(null)} type="button">Close</button>
            </div>
          </div>
        </div>
      ) : null}

      {appCloseDialog ? (
        <div className="dialog-layer app-close-dialog-layer">
          <div className="entity-dialog app-close-dialog">
            <div className="dialog-title">Unsaved Changes</div>
            <div className="dialog-message">
              The application has editor sessions with unsaved changes.
            </div>
            <dl className="dialog-info">
              <dt>ABEditor</dt>
              <dd>{appCloseDialog.items.filter((item) => item.type === 'ab').length} Session(s)</dd>
              <dt>CEditor</dt>
              <dd>{appCloseDialog.items.filter((item) => item.type === 'c').length} Session(s)</dd>
            </dl>
            <ul className="app-close-session-list">
              {appCloseDialog.items.map((item) => (
                <li key={`${item.type}:${item.id}`}>
                  <span>{item.editorLabel}</span>
                  <strong title={item.title}>{item.title}</strong>
                </li>
              ))}
            </ul>
            {appCloseDialog.error ? (
              <div aria-live="polite" className="dialog-message error">{appCloseDialog.error}</div>
            ) : null}
            <div className="dialog-actions app-close-actions">
              <button disabled={appCloseDialog.saving} onClick={saveAllAndCloseApp} type="button">
                {appCloseDialog.saving ? 'Saving...' : 'Save All and Exit'}
              </button>
              <button disabled={appCloseDialog.saving} onClick={exitAppWithoutSaving} type="button">
                Exit Without Saving
              </button>
              <button autoFocus disabled={appCloseDialog.saving} onClick={cancelAppClose} type="button">
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <AppTooltip />
    </main>
  )
}

export default App
