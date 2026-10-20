import { getDomainRolesForKind } from '../domain/domainSchemas.js'
import { normalizeAObjectProperties } from '../../shared/aObjectProperties.js'
import './AObjectProperties.css'

export default function AObjectProperties({
  annotation,
  card = null,
  entity = null,
  onChange,
  onResetDefaults,
  selectedCount = 0,
  subjectSchemas = [],
}) {
  if (selectedCount !== 1 || !annotation) {
    return <div className="a-object-properties-empty">
      {selectedCount > 1 ? '请选择单个 A Object 编辑属性。' : '请选择一个 A Object。'}
    </div>
  }

  const inEntity = Boolean(entity)
  const defaults = normalizeAObjectProperties(annotation)
  const context = inEntity ? { subject: entity.subject, kind: entity.kind, role: card?.role || '' }
    : defaults.defaultRole || { subject: '', kind: '', role: '' }
  const schema = subjectSchemas.find((item) => item.id === context.subject)
  const kinds = schema?.kinds || []
  const roles = schema && context.kind ? getDomainRolesForKind(schema, context.kind) : []
  const roleMissing = context.role && !roles.some((item) => item.value === context.role)
  const defaultIncompatible = inEntity && defaults.defaultRole?.role && (
    defaults.defaultRole.subject !== entity.subject || defaults.defaultRole.kind !== entity.kind
    || !roles.some((item) => item.value === defaults.defaultRole.role)
  )
  const comment = inEntity ? card?.comment || '' : defaults.comment
  const updateDefault = (patch) => onChange({ defaultRole: { ...context, ...patch } })

  return (
    <div className="a-object-properties-editor">
      <div className="a-object-properties-heading">
        <strong>{inEntity ? 'Entity 内 A Object 属性' : 'A Object 默认属性'}</strong>
        <small title={annotation.id}>{annotation.type} · {annotation.id}</small>
      </div>
      <p className="a-object-properties-hint">
        {inEntity ? '只修改当前 Entity 中的引用，不影响原始 A 对象。'
          : '加入 Entity 时复制这些默认值；修改不会影响已有引用。'}
      </p>
      <label>Subject
        <select
          disabled={inEntity}
          onChange={(event) => updateDefault({ subject: event.target.value, kind: '', role: '' })}
          value={context.subject}
        >
          <option value="">--</option>
          {context.subject && !schema ? <option value={context.subject}>{context.subject} (invalid)</option> : null}
          {subjectSchemas.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <label>Kind
        <select
          disabled={inEntity || !schema}
          onChange={(event) => updateDefault({ kind: event.target.value, role: '' })}
          value={context.kind}
        >
          <option value="">--</option>
          {context.kind && !kinds.some((item) => item.value === context.kind)
            ? <option value={context.kind}>{context.kind} (invalid)</option> : null}
          {kinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <label>Role
        <select
          disabled={!schema || !context.kind}
          onChange={(event) => inEntity ? onChange({ role: event.target.value }) : updateDefault({ role: event.target.value })}
          value={context.role}
        >
          <option value="">--</option>
          {roleMissing ? <option value={context.role}>{context.role} (invalid)</option> : null}
          {roles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      {roleMissing ? <div className="a-object-properties-warning">当前 Role 不适用于此 Subject / Kind，请重新选择。</div> : null}
      {defaultIncompatible ? <div className="a-object-properties-warning">
        原始默认角色不适用于当前 Entity；重新复制时将使用本 Kind 的默认角色。
      </div> : null}
      <label>Comment
        <textarea
          onChange={(event) => onChange({ comment: event.target.value })}
          rows={4}
          value={comment}
        />
      </label>
      {inEntity ? (
        <>
          <small className="a-object-properties-hint">
            原始默认角色：{defaults.defaultRole?.role
              ? `${defaults.defaultRole.subject} / ${defaults.defaultRole.kind} / ${defaults.defaultRole.role}` : '--'}
          </small>
          <button onClick={onResetDefaults} type="button">从原 A 对象重新复制属性</button>
        </>
      ) : (
        <button onClick={() => onChange({ defaultRole: null })} type="button">清除默认角色</button>
      )}
    </div>
  )
}
