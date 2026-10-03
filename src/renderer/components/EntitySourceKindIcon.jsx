import { getEntitySourceKindMeta } from '../domain/entitySourceKind'
import './EntitySourceKindIcon.css'

export default function EntitySourceKindIcon({
  className = '',
  dataFilePath = '',
  sourceFilePath = '',
  sourceKind = '',
}) {
  const meta = getEntitySourceKindMeta(sourceKind, sourceFilePath, dataFilePath)

  return (
    <span
      aria-label={meta.label}
      className={['entity-source-kind-icon', meta.kind, className].filter(Boolean).join(' ')}
      data-tooltip={meta.label}
      role="img"
      title={meta.label}
    >
      <i aria-hidden="true" className={meta.icon} />
    </span>
  )
}
