import { initialCardProperties } from '../../shared/aObjectProperties.js'
import { createACardNode } from './aCardTree.js'
import { getDomainRolesForKind, getDomainSchema } from './domainSchemas.js'

export function getInitialCardProperties(annotation, entity, schemas, explicitRole = '') {
  const schema = getDomainSchema(entity.subject, schemas)
  return initialCardProperties(annotation, entity, getDomainRolesForKind(schema, entity.kind), explicitRole)
}

export function createCardsFromAnnotations(annotations, entity, schemas, explicitRole = '') {
  return annotations.map((annotation) => createACardNode({
    aObjectId: annotation.id,
    ...getInitialCardProperties(annotation, entity, schemas, explicitRole),
  }))
}
