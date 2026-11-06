// Model Manager layer — model session, element, relationship and view CRUD
export type {
  ElementManager,
  RelationshipManager,
  ViewManager,
  Bounds,
  Point,
  ViewInfo,
  ViewKind,
  NodeInfo,
  LinkInfo,
  RelationshipInfo,
  CreateElementOptions,
  CreateRelationshipRequest,
} from './interfaces.js';
export { OxigraphElementManager, resetElementCounter } from './element-manager.js';
export { OxigraphRelationshipManager, resetQrCounter } from './relationship-manager.js';
export { OxigraphViewManager, addRelationshipsToView, endsFirst } from './view-manager.js';
export { ModelOperations, resetModelCounter } from './model-operations.js';
export type { LoadModelResult } from './model-operations.js';
export { ModelSession, DEFAULT_VIEW_LABEL, type SessionEvents, type AdoptResult } from './model-session.js';
export {
  readModelContents,
  modelQuads,
  typeClosure,
  classify,
  labelOf,
  findModelIri,
  type ModelContents,
  type ConceptSummary,
  type RelationshipSummary,
  type ConceptKind,
  type TypeClosure,
} from './model-queries.js';
export { migrateLegacyModel, type MigrationReport } from './legacy-migration.js';
export { collectElementQuads, collectRelationshipQuads } from './cascade.js';
