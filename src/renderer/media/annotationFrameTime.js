const VIDEO_FILE_PATTERN = /\.(mp4|webm|mov|m4v|mkv)$/i
const PDF_FILE_PATTERN = /\.pdf$/i

function toFiniteTime(value) {
  if (value === null || value === undefined || value === '') return null
  const time = Number(value)
  return Number.isFinite(time) ? time : null
}

export function getAnnotationSourceKind(annotationData, sourceFilePath = '') {
  const declaredKind = annotationData?.sources?.[0]?.kind
  if (declaredKind === 'video' || VIDEO_FILE_PATTERN.test(sourceFilePath)) return 'video'
  if (declaredKind === 'pdf' || PDF_FILE_PATTERN.test(sourceFilePath)) return 'pdf'
  return 'image'
}

export function resolveAnnotationFrameTime(annotation, frames = []) {
  if (!annotation) return { frame: null, source: '', time: null }

  const frame = frames.find((item) => item.id === annotation.frameId) || null
  const candidates = [
    ['frame.locator.time', frame?.locator?.time],
    ['frame.timeStamp', frame?.timeStamp],
    ['annotation.timeStamp', annotation.timeStamp],
  ]

  for (const [source, value] of candidates) {
    const time = toFiniteTime(value)
    if (time !== null) return { frame, source, time }
  }

  return { frame, source: '', time: null }
}
