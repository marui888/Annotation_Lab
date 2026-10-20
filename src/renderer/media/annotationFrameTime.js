const VIDEO_FILE_PATTERN = /\.(mp4|webm|mov|m4v|mkv)$/i
const PDF_FILE_PATTERN = /\.pdf$/i

export function getAnnotationSourceKind(annotationData, sourceFilePath = '') {
  const declaredKind = annotationData?.sources?.[0]?.kind
  if (declaredKind === 'video' || VIDEO_FILE_PATTERN.test(sourceFilePath)) return 'video'
  if (declaredKind === 'pdf' || PDF_FILE_PATTERN.test(sourceFilePath)) return 'pdf'
  return 'image'
}
