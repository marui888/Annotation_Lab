import { useCallback, useEffect, useRef, useState } from 'react'
import ABEditor from './renderer/ab-editor/ABEditor'
import AppTooltip from './renderer/components/AppTooltip'
import CompositeEditor from './renderer/c-editor/CompositeEditor'
import {
  createAnnotationEditorInput,
  createImageEditorInput,
  createVideoEditorInput,
  openAnnotationFile,
  openImageFile,
  openVideoFile,
  saveAnnotationDocument,
} from './renderer/ab-editor/abEditorLoader'
import { createAnnotationExportTask } from './renderer/ab-editor/exportCropRect'
import { createId } from './renderer/core/id'
import { createVideoFrame } from './renderer/media/videoAdapter'
import {
  appendRefsToACardTree,
  createACardPatch,
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
import {
  DOMAIN_SCHEMAS,
  getDomainEntityRoleRule,
  getDomainKind,
  getDomainSchema,
  getEntityAObjectIds,
  getEntityAObjectRefs,
  validateDomainEntity,
} from './renderer/domain/domainSchemas'
import { captureVideoFrameSnapshot } from './renderer/media/videoFrameSnapshot'
import './App.css'

const RECENT_IMAGES_KEY = 'annotationLab.recentImages'
const MAX_RECENT_IMAGES = 20
const A_OBJECT_DRAG_TYPE = 'application/x-annotation-lab-a-object'
const LEFT_PANEL_DEFAULT_WIDTH = 180
const LEFT_PANEL_MIN_WIDTH = 132
const PANEL_MAX_WIDTH = 560

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
]

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const getPathFileName = (filePath = '') => {
  const parts = String(filePath).split(/[\\/]/)
  return parts[parts.length - 1] || filePath || 'Empty'
}

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
  toolMode: 'select',
  annotations: [],
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
  bIndexFilter: {
    subject: 'all',
    kind: 'all',
    source: 'all',
    query: '',
  },
  selectedBIndexItemKey: '',
  selectedCItemId: null,
  layoutState: {
    columnWidths: {
      source: 300,
      builder: 390,
      preview: 460,
    },
    builderControlHeight: 142,
  },
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

function App() {
  const pendingPreviewFrameIdsRef = useRef(new Set())
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
  const [toolMode, setToolMode] = useState('select')
  const [annotations, setAnnotations] = useState([])
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState([])
  const [lastPreviewAnnotationId, setLastPreviewAnnotationId] = useState(null)
  const [annotationFilePath, setAnnotationFilePath] = useState('')
  const [saveStatus, setSaveStatus] = useState('Not saved')
  const [editingTextId, setEditingTextId] = useState(null)
  const [textDraft, setTextDraft] = useState('')
  const [leftTab, setLeftTab] = useState('entityFiles')
  const [abInspectorTab, setAbInspectorTab] = useState('source')
  const [recentImages, setRecentImages] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(RECENT_IMAGES_KEY) || '[]')
      return Array.isArray(saved) ? saved : []
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
  const [entityDialog, setEntityDialog] = useState(null)
  const [addToEntityDialog, setAddToEntityDialog] = useState(null)
  const [selectedEntityId, setSelectedEntityId] = useState(null)
  const [cWorkspaces, setCWorkspaces] = useState({})
  const [pendingImageSwitch, setPendingImageSwitch] = useState(null)
  const [pendingEditorOpenInput, setPendingEditorOpenInput] = useState(null)
  const [pendingEditorCloseSessionId, setPendingEditorCloseSessionId] = useState(null)
  const [pendingCompositeOpenResult, setPendingCompositeOpenResult] = useState(null)
  const [currentABInput, setCurrentABInput] = useState(null)
  const [pendingABInput, setPendingABInput] = useState(null)
  const [editorWorkspace, setEditorWorkspace] = useState(() => INITIAL_EDITOR_WORKSPACE)
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = useState(() => INITIAL_EDITOR_WORKSPACE.activeId)
  const [compositeRepairRequestId, setCompositeRepairRequestId] = useState(0)
  const [playPauseRequestId, setPlayPauseRequestId] = useState(0)
  const [bindFrameRequest, setBindFrameRequest] = useState(null)
  const [pendingBindFrame, setPendingBindFrame] = useState(null)
  const [bindFrameDialogPosition, setBindFrameDialogPosition] = useState(null)
  const [bindFrameDialogDrag, setBindFrameDialogDrag] = useState(null)
  const [videoSeekRequest, setVideoSeekRequest] = useState(null)
  const [leftPanelWidth, setLeftPanelWidth] = useState(LEFT_PANEL_DEFAULT_WIDTH)
  const [lastLeftPanelWidth, setLastLeftPanelWidth] = useState(LEFT_PANEL_DEFAULT_WIDTH)
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)
  const [resizingPanel, setResizingPanel] = useState(null)

  const formatGeometryValue = (value) => (
    Number.isFinite(value) ? value.toFixed(6) : '--'
  )

  const getSubjectLabel = (subjectId) => getDomainSchema(subjectId)?.label || subjectId

  const getKindLabel = (subjectId, kindValue) => {
    const schema = getDomainSchema(subjectId)
    return getDomainKind(schema, kindValue)?.label || kindValue
  }

  const getEntityDefaultRole = (entity) => {
    const schema = getDomainSchema(entity.subject)
    return getDomainKind(schema, entity.kind)?.value || entity.kind
  }

  const getEntityRuleText = (entity) => {
    const rule = getDomainEntityRoleRule(entity)
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
          ? saveStatus === 'Unsaved'
          : session.saveStatus === 'Unsaved',
      }
    }),
    ...cWorkspaceEntries.map(([workspaceId, workspace]) => ({
      id: workspaceId,
      type: 'c',
      title: workspace.cDocument.title || getPathFileName(workspace.cDocumentFilePath) || 'CompositeEditor',
      dirty: workspace.cSaveStatus === 'Unsaved',
    })),
  ]

  const activeWorkspaceTab = workspaceTabs.find((tab) => tab.id === activeWorkspaceTabId)
    || workspaceTabs.find((tab) => tab.id === editorWorkspace.activeId)
    || workspaceTabs[0]

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

  const saveRecentImages = (items) => {
    setRecentImages(items)
    localStorage.setItem(RECENT_IMAGES_KEY, JSON.stringify(items))
  }

  const rememberRecentImage = (imageResult) => {
    if (!imageResult?.filePath) return
    const nextItem = {
      filePath: imageResult.filePath,
      fileName: imageResult.fileName,
      openedAt: new Date().toISOString(),
    }
    const nextItems = [
      nextItem,
      ...recentImages.filter((item) => item.filePath !== imageResult.filePath),
    ].slice(0, MAX_RECENT_IMAGES)
    saveRecentImages(nextItems)
  }

  const buildCurrentEditorSessionSnapshot = (overrides = {}) => ({
    id: editorWorkspace.activeId,
    title: source?.fileName || getInputTitle(currentABInput),
    input: currentABInput,
    source,
    frame,
    frames,
    framePreviewUrl,
    framePreviewCache,
    selectedFrameId,
    message,
    imageSize,
    zoomMode,
    zoom,
    toolMode,
    annotations,
    selectedAnnotationIds,
    annotationFilePath,
    saveStatus,
    editingTextId,
    textDraft,
    imageFolderPath,
    imageFolderItems,
    entities,
    selectedEntityId,
    layoutState: editorWorkspace.sessions.find((session) => session.id === editorWorkspace.activeId)?.layoutState,
    ...overrides,
  })

  const applyEditorSessionSnapshot = (session) => {
    setMessage(session.message || '')
    setSource(session.source || null)
    setFrame(session.frame || null)
    setFrames(session.frames || [])
    setFramePreviewUrl(session.framePreviewUrl || '')
    setFramePreviewCache(session.framePreviewCache || {})
    setSelectedFrameId(session.selectedFrameId || session.frame?.id || null)
    setImageFolderPath(session.imageFolderPath || '')
    setImageFolderItems(session.imageFolderItems || [])
    setImageSize(session.imageSize || null)
    setZoomMode(session.zoomMode || 'fit')
    setZoom(session.zoom || 1)
    setToolMode(session.toolMode || 'select')
    setAnnotations(session.annotations || [])
    setSelectedAnnotationIds(session.selectedAnnotationIds || [])
    setAnnotationFilePath(session.annotationFilePath || '')
    setSaveStatus(session.saveStatus || 'Not saved')
    setEditingTextId(session.editingTextId || null)
    setTextDraft(session.textDraft || '')
    setEntities(session.entities || [])
    setSelectedEntityId(session.selectedEntityId || null)
    setCurrentABInput(session.input || null)
    setPendingABInput(null)
    setPendingImageSwitch(null)
    setPendingEditorOpenInput(null)
    setPendingEditorCloseSessionId(null)
    setEntityMenu(null)
    setAObjectMenu(null)
    setFrameMenu(null)
    setEntityDialog(null)
    setAddToEntityDialog(null)
  }

  const getEditorSessionSnapshot = (sessionId) => (
    sessionId === editorWorkspace.activeId
      ? buildCurrentEditorSessionSnapshot()
      : editorWorkspace.sessions.find((session) => session.id === sessionId)
  )

  const buildAnnotationDocumentFromSession = (session) => {
    const sessionAnnotations = session.editingTextId
      ? (session.annotations || []).map((annotation) => (
          annotation.id === session.editingTextId
            ? { ...annotation, text: session.textDraft, updatedAt: new Date().toISOString() }
            : annotation
        ))
      : (session.annotations || [])

    return {
      schemaVersion: 1,
      sources: session.source ? [session.source] : [],
      frames: session.frames || (session.frame ? [session.frame] : []),
      annotations: sessionAnnotations,
      entities: (session.entities || []).map((entity) => ({
        ...entity,
        ...createACardPatch(getEntityACardTree(entity)),
      })),
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
    const targetEntity = session.entities.find((entity) => entity.id === session.input?.entityId)
      || session.entities[0]
      || null
    setMessage('')
    setSource(session.source)
    setFrame(session.frame)
    setFrames(session.frames || (session.frame ? [session.frame] : []))
    setFramePreviewUrl(session.source?.kind === 'image' ? session.source.fileUrl : '')
    setFramePreviewCache({})
    setImageFolderPath(session.folderPath)
    setImageFolderItems(session.folderImages)
    setImageSize(null)
    setZoomMode('fit')
    setZoom(1)
    setToolMode('select')
    setSelectedFrameId(session.frame?.id || null)
    setSelectedAnnotationIds([])
    setEditingTextId(null)
    setEntityMenu(null)
    setAObjectMenu(null)
    setFrameMenu(null)
    setEntityDialog(null)
    setAddToEntityDialog(null)
    setSelectedEntityId(targetEntity?.id || null)
    setAnnotationFilePath(session.annotationFilePath)
    setAnnotations(session.annotations)
    setEntities(session.entities)
    setSaveStatus(session.saveStatus)
    setCurrentABInput(session.input)
    setPendingABInput(null)
    if (session.input?.fileInfo) rememberRecentImage(session.input.fileInfo)
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
      setPendingEditorOpenInput(input)
      return false
    }
    startLoadInCurrentEditor(input)
    return true
  }

  const confirmEditorOpenChoice = (mode) => {
    const target = pendingEditorOpenInput
    if (!target) return
    setPendingEditorOpenInput(null)
    if (mode === 'cancel') return
    if (mode === 'new') {
      openInputInNewEditor(target)
      return
    }
    if (source && saveStatus === 'Unsaved') {
      setPendingImageSwitch(target)
      return
    }
    startLoadInCurrentEditor(target)
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

  const requestPlayPauseVideo = () => {
    if (source?.kind !== 'video') return
    setPlayPauseRequestId((current) => current + 1)
  }

  const useVideoFrame = (nextFrame, videoSize = {}, previewUrl = '', options = {}) => {
    if (!nextFrame) return
    const width = videoSize.width || nextFrame.meta?.width || imageSize?.width || null
    const height = videoSize.height || nextFrame.meta?.height || imageSize?.height || null
    setFrame(nextFrame)
    setSelectedFrameId(nextFrame.id)
    setFrames((current) => {
      const nextFrames = current.some((item) => item.id === nextFrame.id)
        ? current.map((item) => (item.id === nextFrame.id ? nextFrame : item))
        : [...current, nextFrame]
      return nextFrames
    })
    setFramePreviewUrl(previewUrl)
    if (previewUrl && width && height) {
      setFramePreviewCache((current) => ({
        ...current,
        [nextFrame.id]: {
          frameId: nextFrame.id,
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
          duration: nextFrame.meta?.duration ?? current.meta?.duration ?? null,
        },
        updatedAt: new Date().toISOString(),
      }
    })
    setToolMode('select')
    if (!options.previewOnly) {
      setSaveStatus('Unsaved')
      setMessage(`Using video frame at ${Number(nextFrame.locator?.time || 0).toFixed(2)}s.`)
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

  const openRecentImage = (filePath) => openImageByPath(filePath)

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

  useEffect(() => {
    const handleKeyDown = (event) => {
      const targetTag = event.target?.tagName?.toLowerCase()
      if (targetTag === 'textarea' || targetTag === 'input') return
      if (event.key !== 'Delete') return
      if (selectedAnnotationIds.length === 0) return
      setAnnotations((current) => current.filter((annotation) => !selectedAnnotationIds.includes(annotation.id)))
      setEntities((current) => current.map((entity) => ({
        ...entity,
        ...createACardPatch(removeACardsByAObjectIds(getEntityACardTree(entity), selectedAnnotationIds)),
      })))
      setLastPreviewAnnotationId((current) => (
        selectedAnnotationIds.includes(current) ? null : current
      ))
      setSelectedAnnotationIds([])
      setSaveStatus('Unsaved')
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedAnnotationIds])

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

  const normalizeNewAnnotation = (annotation) => {
    if (
      source?.kind === 'video'
      && frame?.kind === 'video-frame'
      && !annotation.frameId
    ) {
      return {
        ...annotation,
        frameId: frame.id,
      }
    }
    return annotation
  }

  const addAnnotation = (annotation) => {
    const nextAnnotation = normalizeNewAnnotation(annotation)
    setAnnotations((current) => [...current, nextAnnotation])
    setLastPreviewAnnotationId(nextAnnotation.id)
    setSelectedAnnotationIds([nextAnnotation.id])
    setToolMode('select')
    setSaveStatus('Unsaved')
  }

  const addTextAnnotation = (annotation) => {
    const nextAnnotation = normalizeNewAnnotation(annotation)
    setAnnotations((current) => [...current, nextAnnotation])
    setLastPreviewAnnotationId(nextAnnotation.id)
    setSelectedAnnotationIds([nextAnnotation.id])
    setToolMode('select')
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

  const deleteSelectedAnnotation = () => {
    if (selectedAnnotationIds.length === 0) return
    setAnnotations((current) => current.filter((annotation) => !selectedAnnotationIds.includes(annotation.id)))
    setEntities((current) => current.map((entity) => ({
      ...entity,
      ...createACardPatch(removeACardsByAObjectIds(getEntityACardTree(entity), selectedAnnotationIds)),
    })))
    setLastPreviewAnnotationId((current) => (
      selectedAnnotationIds.includes(current) ? null : current
    ))
    setSelectedAnnotationIds([])
    setSaveStatus('Unsaved')
  }

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
    const existingFrame = frames.find((item) => (
      item.kind === 'video-frame'
      && Math.abs(Number(item.locator?.time ?? Number.NaN) - time) < 0.05
    ))
    const nextFrame = existingFrame || createVideoFrame(source, {
      time,
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
            updatedAt: now,
          }
        : annotation
    )))
    setFrames((current) => (
      current.some((item) => item.id === nextFrame.id)
        ? current
        : [...current, nextFrame]
    ))
    setFrame(nextFrame)
    setSelectedFrameId(nextFrame.id)
    if (previewUrl && width && height) {
      setFramePreviewUrl(previewUrl)
      setFramePreviewCache((current) => ({
        ...current,
        [nextFrame.id]: {
          frameId: nextFrame.id,
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

  const buildAnnotationDocument = () => ({
    schemaVersion: 1,
    sources: source ? [source] : [],
    frames,
    annotations: editingTextId
      ? annotations.map((annotation) => (
          annotation.id === editingTextId
            ? { ...annotation, text: textDraft, updatedAt: new Date().toISOString() }
            : annotation
        ))
      : annotations,
    entities: entities.map((entity) => ({
      ...entity,
      ...createACardPatch(getEntityACardTree(entity)),
    })),
    collections: [],
  })

  const saveAnnotations = async () => {
    if (!source) return false
    setSaveStatus('Saving...')
    const result = await saveAnnotationDocument(source.filePath, buildAnnotationDocument(), annotationFilePath)

    if (result?.ok) {
      setAnnotationFilePath(result.annotationFilePath || annotationFilePath)
      setSaveStatus('Saved')
      return true
    }

    setSaveStatus(`Save failed: ${result?.reason || 'unknown error'}`)
    return false
  }

  const chooseExportFolder = async () => {
    const result = await window.labApi?.chooseExportFolder?.()
    if (!result?.ok) {
      if (!result?.canceled) setMessage(`Choose export folder failed: ${result?.reason || 'unknown error'}`)
      return ''
    }
    return result.folderPath || ''
  }

  const exportTasks = async ({ outputFolder, tasks, entity = null }) => {
    if (!source?.filePath || !outputFolder || tasks.length === 0) return false
    const result = await window.labApi?.exportAnnotationCrops?.({
      sourceFilePath: source.filePath,
      outputFolder,
      entity,
      tasks,
    })
    if (result?.ok) {
      const okCount = result.exported?.filter((item) => item.ok).length || 0
      const totalCount = result.exported?.length || tasks.length
      const failedCount = totalCount - okCount
      setMessage(`Exported ${okCount}/${totalCount} item(s) to ${result.folderPath}${failedCount ? ' ; see _export_errors.txt' : ''}`)
      return true
    }
    setMessage(`Export failed: ${result?.reason || 'unknown error'}`)
    return false
  }

  const exportSingleAnnotationCrop = async (annotationIds = selectedAnnotationIds) => {
    if (!source || !imageSize || annotationIds.length !== 1) return false
    const annotation = annotations.find((item) => item.id === annotationIds[0])
    const task = createAnnotationExportTask(annotation, imageSize)
    if (!task) {
      setMessage('Export failed: invalid A object.')
      return false
    }
    const outputFolder = await chooseExportFolder()
    if (!outputFolder) return false
    return exportTasks({ outputFolder, tasks: [task] })
  }

  const exportEntityCrops = async (entity = entities.find((item) => item.id === selectedEntityId) || null) => {
    if (!source || !imageSize || !entity) return false
    const refs = getEntityAObjectRefs(entity)
    const tasks = refs
      .map((ref, index) => {
        const annotation = annotations.find((item) => item.id === ref.aObjectId)
        return createAnnotationExportTask(annotation, imageSize, {
          index,
          role: ref.role,
        })
      })
      .filter(Boolean)
    if (tasks.length === 0) {
      setMessage('Export failed: current Entity has no exportable A object.')
      return false
    }
    const outputFolder = await chooseExportFolder()
    if (!outputFolder) return false
    return exportTasks({
      outputFolder,
      tasks,
      entity: {
        id: entity.id,
        label: entity.label,
      },
    })
  }

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
    return annotation.id
  }

  const getAnnotationFrame = useCallback((annotation) => {
    if (!annotation) return null
    const matchedFrame = frames.find((item) => item.id === annotation.frameId)
    if (matchedFrame) return matchedFrame
    if (frame?.id === annotation.frameId) return frame

    return null
  }, [frame, frames])

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

  const getAnnotationPreview = (annotation) => {
    if (!annotation) return null
    if (source?.kind === 'image') {
      return {
        imageUrl: source.fileUrl,
        imageSize,
      }
    }
    const videoTarget = getAnnotationVideoTarget(annotation)
    if (!videoTarget) return null
    const cachedPreview = framePreviewCache[videoTarget.frame.id]
    if (cachedPreview?.imageUrl && cachedPreview?.imageSize) return cachedPreview
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
    if (source?.kind !== 'video' || !annotation || !source.fileUrl) return
    const videoTarget = getAnnotationVideoTarget(annotation)
    if (!videoTarget) return
    if (framePreviewCache[videoTarget.frame.id]?.imageUrl) return
    if (pendingPreviewFrameIdsRef.current.has(videoTarget.frame.id)) return

    pendingPreviewFrameIdsRef.current.add(videoTarget.frame.id)
    captureVideoFrameSnapshot({
      src: source.fileUrl,
      time: videoTarget.time,
    }).then((result) => {
      if (!result?.ok) return
      setFramePreviewCache((current) => ({
        ...current,
        [videoTarget.frame.id]: {
          frameId: videoTarget.frame.id,
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
  }, [framePreviewCache, getAnnotationVideoTarget, source])

  const previewAnnotationId = selectedAnnotationIds.length === 1
    ? selectedAnnotationIds[0]
    : selectedAnnotationIds.length === 0
      ? lastPreviewAnnotationId
      : null
  const selectedFrameForInspector = frames.find((item) => item.id === selectedFrameId) || null
  const selectedEntityForInspector = entities.find((entity) => entity.id === selectedEntityId) || null
  const getCompactId = (id) => (
    id ? `${String(id).slice(0, 8)}...` : '--'
  )

  useEffect(() => {
    if (source?.kind !== 'video' || !previewAnnotationId) return
    const annotation = annotations.find((item) => item.id === previewAnnotationId)
    ensureAnnotationPreview(annotation)
  }, [annotations, ensureAnnotationPreview, previewAnnotationId, source?.kind])

  const getAnnotationFrameLabel = (annotation) => {
    const annotationFrame = getAnnotationFrame(annotation)
    if (!annotationFrame) return annotation.frameId ? 'missing frame' : '--'
    if (annotationFrame.kind === 'video-frame') {
      return formatTime(annotationFrame.locator?.time)
    }
    return 'image'
  }

  const getFrameLabel = (targetFrame) => {
    if (!targetFrame) return '--'
    if (targetFrame.kind === 'video-frame') {
      return formatTime(Number(targetFrame.locator?.time))
    }
    return 'image'
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

  const openEntityDialog = ({ sourceAObjectIds = [], entityId = null } = {}) => {
    const entity = entityId ? entities.find((item) => item.id === entityId) : null
    const schema = getDomainSchema(entity?.subject || DOMAIN_SCHEMAS[0].id)
    setEntityDialog({
      mode: entity ? 'edit' : 'create',
      entityId: entity?.id || null,
      sourceAObjectIds,
      subject: schema.id,
      kind: entity?.kind || schema.defaultKind,
      label: entity?.label || (sourceAObjectIds.length ? schema.defaultLabel : 'New Entity'),
    })
    setEntityMenu(null)
  }

  const closeEntityDialog = () => {
    setEntityDialog(null)
  }

  const updateEntityDialogSubject = (subject) => {
    const schema = getDomainSchema(subject)
    setEntityDialog((current) => ({
      ...current,
      subject: schema.id,
      kind: schema.defaultKind,
      label: current.label === getDomainSchema(current.subject)?.defaultLabel
        ? schema.defaultLabel
        : current.label,
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
      label: entityDialog.label.trim() || 'Entity',
      ...createACardPatch(refsToACardTree((entityDialog.sourceAObjectIds || []).map((aObjectId) => ({
        aObjectId,
        role: entityDialog.kind,
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
    setEntityMenu({ entityId, x, y })
  }

  const closeEntityMenu = () => {
    setEntityMenu(null)
  }

  const openAObjectMenu = (annotationId, x, y) => {
    setAbInspectorTab('a')
    selectAnnotationsFromChild([annotationId])
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
    seekVideoToAnnotation(annotation)
    closeAObjectMenu()
  }

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
    setEntities((current) => current.filter((entity) => entity.id !== entityId))
    if (selectedEntityId === entityId) setSelectedEntityId(null)
    setSaveStatus('Unsaved')
    closeEntityMenu()
  }

  const duplicateBEntity = (entityId) => {
    const entity = entities.find((item) => item.id === entityId)
    if (!entity) return
    const now = new Date().toISOString()
    const nextEntity = {
      ...entity,
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

  const updateBWorkflowEntity = (entityId, patch) => {
    const hasACardPatch = (
      patch.aCards !== undefined ||
      patch.aObjectRefs !== undefined ||
      patch.aObjectIds !== undefined
    )
    setEntities((current) => current.map((entity) => (
      entity.id === entityId
        ? {
            ...entity,
            ...patch,
            label: patch.label !== undefined ? patch.label?.trim() || 'Entity' : entity.label,
            ...(hasACardPatch ? createACardPatch(getEntityACardTree(patch)) : {}),
            updatedAt: new Date().toISOString(),
          }
        : entity
    )))
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
    setPendingCompositeOpenResult(result)
  }

  const confirmCompositeOpenChoice = (mode) => {
    const result = pendingCompositeOpenResult
    if (!result) return
    setPendingCompositeOpenResult(null)
    if (mode === 'cancel') return
    if (mode === 'new' || !activeCWorkspaceId) {
      openCDocumentInNewWorkspace(result)
      return
    }
    if (!confirmDiscardCWorkspaceChanges(activeCWorkspace)) return
    openCDocumentInWorkspace(activeCWorkspaceId, result)
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
    setLeftTab('compositeFiles')
  }

  const closeCDocument = () => {
    if (!activeCWorkspaceId) return
    if (!confirmDiscardCWorkspaceChanges(activeCWorkspace)) return
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

  const saveCDocumentToPath = async (filePath) => {
    if (!filePath) return false
    const workspaceId = activeCWorkspaceId
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
    return true
  }

  const saveCDocument = async () => {
    if (activeCWorkspace.cDocumentFilePath) {
      await saveCDocumentToPath(activeCWorkspace.cDocumentFilePath)
      return
    }
    await saveCDocumentAs()
  }

  const saveCDocumentAs = async () => {
    const result = await window.labApi?.chooseCDocumentPath?.(activeCWorkspace.cDocument.title)
    if (!result?.ok) return
    await saveCDocumentToPath(result.filePath)
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

  const deleteCItem = (itemId) => {
    if (!window.confirm('Delete this C item?')) return
    const deletedItem = activeCWorkspace.cDocument.items.find((item) => item.id === itemId)
      || activeCWorkspace.cDocument.items.find((item) => cItemTreeContains(item.children || [], itemId))
    markCDocumentUnsaved({
      ...activeCWorkspace.cDocument,
      items: removeCItemFromTree(activeCWorkspace.cDocument.items, itemId),
    })
    if (
      activeCWorkspace.selectedCItemId === itemId
      || (deletedItem && cItemTreeContains(deletedItem.children || [], activeCWorkspace.selectedCItemId))
    ) {
      updateActiveCWorkspace({ selectedCItemId: null })
    }
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
        onContextMenu={(event) => {
          event.preventDefault()
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
            selectAnnotationFromEvent(annotation.id, event)
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
          <dt>id</dt>
          <dd>{annotation.id}</dd>
          <dt>frameId</dt>
          <dd>{annotation.frameId}</dd>
          <dt>frame</dt>
          <dd>{getAnnotationFrameLabel(annotation)}</dd>
          <dt>frame found</dt>
          <dd>{annotationFrame ? 'yes' : 'no'}</dd>
          <dt>time</dt>
          <dd>{Number.isFinite(annotationTime) ? formatTime(annotationTime) : '--'}</dd>
          <dt>status</dt>
          <dd>{annotation.status}</dd>
          <dt>x</dt>
          <dd>{formatGeometryValue(annotation.geometry.x)}</dd>
          <dt>y</dt>
          <dd>{formatGeometryValue(annotation.geometry.y)}</dd>
          <dt>x1</dt>
          <dd>{formatGeometryValue(annotation.geometry.x1)}</dd>
          <dt>y1</dt>
          <dd>{formatGeometryValue(annotation.geometry.y1)}</dd>
          <dt>x2</dt>
          <dd>{formatGeometryValue(annotation.geometry.x2)}</dd>
          <dt>y2</dt>
          <dd>{formatGeometryValue(annotation.geometry.y2)}</dd>
          <dt>width</dt>
          <dd>{formatGeometryValue(annotation.geometry.width)}</dd>
          <dt>height</dt>
          <dd>{formatGeometryValue(annotation.geometry.height)}</dd>
          <dt>text</dt>
          <dd>{annotation.text || '--'}</dd>
          <dt>stroke</dt>
          <dd>{annotation.style?.stroke || '--'}</dd>
          <dt>fill</dt>
          <dd>{annotation.style?.fill || '--'}</dd>
          <dt>strokeWidth</dt>
          <dd>{annotation.style?.strokeWidth ?? '--'}</dd>
          <dt>radius</dt>
          <dd>{annotation.style?.radius ?? '--'}</dd>
          <dt>fontSize</dt>
          <dd>{annotation.style?.fontSize ?? '--'}</dd>
          <dt>createdAt</dt>
          <dd>{annotation.createdAt || '--'}</dd>
          <dt>updatedAt</dt>
          <dd>{annotation.updatedAt || '--'}</dd>
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
      <div className="ab-inspector-content">
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
            <div className="object-list">
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
            <span>Selected Entity: <strong title={selectedEntityForInspector?.id || ''}>{selectedEntityForInspector?.label || '--'}</strong></span>
            <span>Selected A: <strong>{selectedAnnotationIds.length}</strong></span>
          </div>
          {entities.length === 0 ? (
            <div className="empty-state">No domain entities.</div>
          ) : (
            <div className="entity-list">
              {entities.map((entity, index) => (
                (() => {
                  const validation = validateDomainEntity(entity)
                  const ruleText = getEntityRuleText(entity)
                  const aObjectRefs = getEntityAObjectRefs(entity)
                  const aObjectIds = aObjectRefs.map((ref) => ref.aObjectId)

                  return (
                    <details
                      className={[
                        'entity-row',
                        entity.id === selectedEntityId ? 'selected' : '',
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
                      <summary>
                        <span>{index + 1}. {getSubjectLabel(entity.subject)} / {getKindLabel(entity.subject, entity.kind)} / {entity.label}</span>
                        <small>{aObjectRefs.length} A / {validation.ok ? 'OK' : validation.issues.join('; ')}</small>
                      </summary>
                      {!validation.ok ? (
                        <div className="entity-warning">
                          {validation.issues.join('; ')}
                        </div>
                      ) : null}
                      <dl>
                        <dt>id</dt>
                        <dd>{entity.id}</dd>
                        <dt>subject</dt>
                        <dd>{getSubjectLabel(entity.subject)} ({entity.subject})</dd>
                        <dt>kind</dt>
                        <dd>{getKindLabel(entity.subject, entity.kind)} ({entity.kind})</dd>
                        <dt>label</dt>
                        <dd>{entity.label}</dd>
                        <dt>A ids</dt>
                        <dd>{aObjectIds.join(', ') || '--'}</dd>
                        <dt>A roles</dt>
                        <dd>{aObjectRefs.map((ref) => `${ref.role}:${ref.aObjectId}`).join(', ') || '--'}</dd>
                        <dt>status</dt>
                        <dd>{entity.status}</dd>
                        <dt>createdAt</dt>
                        <dd>{entity.createdAt || '--'}</dd>
                        <dt>updatedAt</dt>
                        <dd>{entity.updatedAt || '--'}</dd>
                      </dl>
                      <div className="entity-rule">
                        <div className="section-title">Rule</div>
                        <dl>
                          <dt>Required</dt>
                          <dd>{ruleText.required}</dd>
                          <dt>Optional</dt>
                          <dd>{ruleText.optional}</dd>
                        </dl>
                      </div>
                      <div className="relation-list">
                        <div className="section-title">A Object Refs</div>
                        {aObjectRefs.length === 0 ? (
                          <div className="empty-state">No A object refs.</div>
                        ) : (
                          <div className="relation-table">
                            <div className="relation-row relation-header">
                              <span>Role</span>
                              <span>A Object</span>
                              <span>Action</span>
                            </div>
                            {aObjectRefs.map((ref) => {
                              const annotation = getAnnotationById(ref.aObjectId)
                              const roleOptions = getDomainSchema(entity.subject)?.kinds || []
                              return (
                                <div className="relation-row" key={ref.aObjectId}>
                                  <select
                                    aria-label="A object role"
                                    onChange={(event) => updateEntityAObjectRole(entity.id, ref.aObjectId, event.target.value)}
                                    value={ref.role}
                                  >
                                    {roleOptions.map((option) => (
                                      <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                  </select>
                                  <button
                                    onClick={() => {
                                      selectAnnotationsFromChild([ref.aObjectId])
                                      setAbInspectorTab('a')
                                    }}
                                    title={ref.aObjectId}
                                    type="button"
                                  >
                                    {annotation ? `${annotation.type}: ${getAnnotationSummary(annotation)}` : ref.aObjectId}
                                  </button>
                                  <button onClick={() => removeAObjectFromEntity(entity.id, ref.aObjectId)} type="button">Remove</button>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </details>
                  )
                })()
              ))}
            </div>
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
            <button className="primary-button" onClick={openImage} type="button">
              Open Image
            </button>
            <button className="primary-button" onClick={openVideo} type="button">
              Open Video
            </button>
            <button disabled={activeWorkspaceTab.type !== 'ab' || source?.kind !== 'video'} onClick={requestPlayPauseVideo} type="button">
              Play / Pause
            </button>
            <button onClick={openAnnotation} type="button">
              Open JSON
            </button>
            <button disabled={!source || saveStatus !== 'Unsaved'} onClick={saveAnnotations} type="button">
              Save JSON
            </button>

            <section className="panel-section">
              <div className="section-title">A Layer</div>
              <button className={toolMode === 'select' ? 'active-tool' : ''} onClick={() => setToolMode('select')} type="button">Select</button>
              <button className={toolMode === 'rect' ? 'active-tool' : ''} onClick={() => setToolMode('rect')} type="button">Rect</button>
              <button className={toolMode === 'arrow' ? 'active-tool' : ''} onClick={() => setToolMode('arrow')} type="button">Arrow</button>
              <button className={toolMode === 'text' ? 'active-tool' : ''} onClick={() => setToolMode('text')} type="button">Text</button>
              <button disabled={selectedAnnotationIds.length === 0} onClick={deleteSelectedAnnotation} type="button">Delete</button>
            </section>

            <section className="panel-section">
              <div className="section-title">View</div>
              <button onClick={setFitZoom} type="button">Fit</button>
              <button onClick={setActualSizeZoom} type="button">100%</button>
              <button onClick={() => changeZoom(-0.1)} type="button">Zoom Out</button>
              <button onClick={() => changeZoom(0.1)} type="button">Zoom In</button>
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
            <div className="section-title">Recent Images</div>
            {recentImages.length === 0 ? (
              <div className="empty-state">No recent image.</div>
            ) : (
              <div className="recent-list">
                {recentImages.map((item) => (
                  <button
                    key={item.filePath}
                    onDoubleClick={() => openRecentImage(item.filePath)}
                    title={item.filePath}
                    type="button"
                  >
                    {item.fileName}
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
              title={tab.title}
            >
              <button
                className="workspace-tab-main"
                onClick={() => requestActivateWorkspaceTab(tab.id)}
                type="button"
              >
                <span>{tab.type === 'ab' ? 'A/B' : 'C'}</span>
                <strong>{tab.title}</strong>
                {tab.dirty ? <em>Unsaved</em> : null}
              </button>
              {tab.type === 'ab' ? (
                <button
                  className="workspace-tab-close"
                  onClick={(event) => requestCloseEditorSession(tab.id, event)}
                  title="Close ABEditor"
                  type="button"
                >
                  x
                </button>
              ) : null}
              {tab.type === 'c' ? (
                <button
                  className="workspace-tab-close"
                  onClick={(event) => requestCloseCWorkspace(tab.id, event)}
                  title="Close CompositeEditor"
                  type="button"
                >
                  x
                </button>
              ) : null}
            </div>
          ))}
        </div>
        {activeWorkspaceTab.type === 'c' ? (
          <CompositeEditor
            bIndexItems={activeCWorkspace.bIndexItems}
            bIndexSources={activeCWorkspace.bIndexSources}
            bIndexFilter={activeCWorkspace.bIndexFilter}
            cDocument={activeCWorkspace.cDocument}
            cDocumentFilePath={activeCWorkspace.cDocumentFilePath}
            cSaveStatus={activeCWorkspace.cSaveStatus}
            layoutState={activeCWorkspace.layoutState}
            onAddBIndexItem={addBIndexItemToCDocument}
            onAddCRefItem={addCRefItemToCDocument}
            onAddFileRefItem={addFileRefItemToCDocument}
            onAddTextItem={addTextItemToCDocument}
            onChangeItems={changeCItems}
            onDeleteItem={deleteCItem}
            onOpenBRef={openBRefFromCItem}
            onScanAnnotationFiles={scanBEntityAnnotationFiles}
            onScanFolders={scanBEntityIndex}
            onLayoutStateChange={updateActiveCLayoutState}
            onSelectBIndexItem={selectBIndexItem}
            onSelectItem={(itemId) => updateActiveCWorkspace({ selectedBIndexItemKey: '', selectedCItemId: itemId })}
            onUpdateBIndexFilter={updateBIndexFilter}
            onUpdateDocumentField={updateCDocumentField}
            onUpdateItemText={updateCItemText}
            repairRequestId={compositeRepairRequestId}
            selectedBIndexItemKey={activeCWorkspace.selectedBIndexItemKey}
            selectedCItemId={activeCWorkspace.selectedCItemId}
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
              formatEntityLabel={(entity) => `${getKindLabel(entity.subject, entity.kind)}: ${entity.label}`}
              frame={frame}
              framePreviewUrl={framePreviewUrl}
              ensureAnnotationPreview={ensureAnnotationPreview}
              getAnnotationPreview={getAnnotationPreview}
              inspectorContent={renderABInspectorContent()}
              imageSize={imageSize}
              initialInput={pendingABInput}
              isDirty={saveStatus === 'Unsaved'}
              layoutState={editorWorkspace.sessions.find((session) => session.id === editorWorkspace.activeId)?.layoutState}
              onAddAnnotation={addAnnotation}
              onAddTextAnnotation={addTextAnnotation}
              onBindCurrentVideoFrame={openBindFrameConfirmDialog}
              onUseVideoFrame={useVideoFrame}
              onClearSelection={clearSelection}
              onCreateEntity={createBWorkflowEntity}
              onDeleteSelectedAnnotations={deleteSelectedAnnotation}
              onEditTextAnnotation={startEditTextAnnotation}
              onExportSelectedAnnotationCrop={exportSingleAnnotationCrop}
              onExportSelectedEntity={exportEntityCrops}
              onImageSizeChange={setImageSize}
              onLayoutStateChange={updateActiveEditorLayoutState}
              onOpenAddToEntityDialog={openAddToEntityDialog}
              onOpenEntityDialog={openEntityDialog}
              onSelectAnnotation={selectAnnotationFromEvent}
              onSelectAnnotations={selectAnnotationsFromChild}
              onSessionLoadError={handleABSessionLoadError}
              onSessionLoaded={applyImageEditorSession}
              onSessionLoadStart={handleABSessionLoadStart}
              onSaveAnnotations={saveAnnotations}
              onUpdateAnnotation={updateAnnotation}
              onUpdateEntity={updateBWorkflowEntity}
              onToolModeChange={setToolMode}
              playPauseRequestId={playPauseRequestId}
              showBindFrameOverlay={Boolean(pendingBindFrame)}
              saveStatus={saveStatus}
              selectedAnnotationIds={selectedAnnotationIds}
              previewAnnotationId={previewAnnotationId}
              selectedEntity={selectedEntityForInspector}
              source={source}
              textDraft={textDraft}
              toolMode={toolMode}
              updateTextDraft={setTextDraft}
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
          const canGoTo = Boolean(annotation && getAnnotationVideoTarget(annotation))
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
              <button disabled={!canGoTo} onClick={goToAObjectFromMenu} type="button">Go To</button>
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
          <button onClick={goToFrameFromMenu} type="button">Go To Frame</button>
          <div className="context-menu-separator" />
          <button onClick={closeFrameMenu} type="button">Cancel</button>
        </div>
      ) : null}

      {entityMenu ? (
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
              <button onClick={() => editEntityInWorkflow(entityMenu.entityId)} type="button">Edit In Workflow</button>
              <button onClick={() => openEntityDialog({ entityId: entityMenu.entityId })} type="button">Edit Entity...</button>
              <button onClick={() => duplicateBEntity(entityMenu.entityId)} type="button">Duplicate Entity</button>
              <button onClick={() => deleteBEntity(entityMenu.entityId)} type="button">Delete Entity</button>
            </>
          ) : null}
          <div className="context-menu-separator" />
          <button onClick={closeEntityMenu} type="button">Cancel</button>
        </div>
      ) : null}

      {addToEntityDialog ? (
        (() => {
          const entity = entities.find((item) => item.id === addToEntityDialog.entityId)
          const schema = getDomainSchema(entity?.subject)

          return (
            <div className="dialog-layer">
              <div className="entity-dialog">
                <div className="dialog-title">Add To Entity</div>
                <dl className="dialog-info">
                  <dt>Entity</dt>
                  <dd>{entity ? `${getKindLabel(entity.subject, entity.kind)}: ${entity.label}` : '--'}</dd>
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
                    {(schema?.kinds || []).map((option) => (
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

      {pendingEditorOpenInput ? (
        <div className="dialog-layer">
          <div className="entity-dialog">
            <div className="dialog-title">Open Target</div>
            <dl className="dialog-info">
              <dt>Current</dt>
              <dd>{source?.fileName || '--'}</dd>
              <dt>Target</dt>
              <dd>{getInputTitle(pendingEditorOpenInput)}</dd>
            </dl>
            <div className="dialog-message">
              Choose where to open this source.
            </div>
            <div className="dialog-actions">
              <button onClick={() => confirmEditorOpenChoice('here')} type="button">Open Here</button>
              <button onClick={() => confirmEditorOpenChoice('new')} type="button">Open New</button>
              <button onClick={() => confirmEditorOpenChoice('cancel')} type="button">Cancel</button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingCompositeOpenResult ? (
        <div className="dialog-layer">
          <div className="entity-dialog">
            <div className="dialog-title">Open Composite</div>
            <dl className="dialog-info">
              <dt>Current</dt>
              <dd>{activeCWorkspace.cDocument?.title || '--'}</dd>
              <dt>Target</dt>
              <dd>{getPathFileName(pendingCompositeOpenResult.filePath)}</dd>
            </dl>
            <div className="dialog-message">
              Choose where to open this Composite document.
            </div>
            <div className="dialog-actions">
              <button onClick={() => confirmCompositeOpenChoice('here')} type="button">Open Here</button>
              <button onClick={() => confirmCompositeOpenChoice('new')} type="button">Open New</button>
              <button onClick={() => confirmCompositeOpenChoice('cancel')} type="button">Cancel</button>
            </div>
          </div>
        </div>
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

      {entityDialog ? (
        <div className="dialog-layer">
          <div className="entity-dialog">
            <div className="dialog-title">
              {entityDialog.sourceAObjectIds?.length ? 'New Entity From A Objects' : 'New Entity'}
            </div>
            <label>
              Subject
              <select
                onChange={(event) => updateEntityDialogSubject(event.target.value)}
                value={entityDialog.subject}
              >
                {DOMAIN_SCHEMAS.map((schema) => (
                  <option key={schema.id} value={schema.id}>{schema.label}</option>
                ))}
              </select>
            </label>
            <label>
              Kind
              <select
                onChange={(event) => setEntityDialog((current) => ({ ...current, kind: event.target.value }))}
                value={entityDialog.kind}
              >
                {(getDomainSchema(entityDialog.subject)?.kinds || []).map((option) => (
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

      <AppTooltip />
    </main>
  )
}

export default App
