// Model Manager layer — element, relationship, and view CRUD operations
export type { ElementManager, RelationshipManager, ViewManager, Bounds, ViewInfo } from './interfaces.js';
export { OxigraphElementManager, resetElementCounter } from './element-manager.js';
export { OxigraphRelationshipManager, resetQrCounter } from './relationship-manager.js';
export { OxigraphViewManager, resetViewCounter } from './view-manager.js';
export { ModelOperations, resetModelCounter } from './model-operations.js';
export type { LoadModelResult } from './model-operations.js';
