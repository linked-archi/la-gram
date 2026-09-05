// UI layer — app shell, event bus, panels, views, canvas
export { AppShell } from './app-shell.js';
export {
  mountUi,
  DEFAULT_MODEL_IRI,
  type MountedUi,
  type CanvasViewKind,
} from './mount-ui.js';
export {
  EventBus,
  type ModelEventType,
  type ModelEvent,
  type ModelEventHandler,
} from './event-bus.js';
export {
  DiagramCanvas,
  RdfPaletteProvider,
  RdfRenderer,
  RdfRuleProvider,
  RdfContextPadProvider,
} from './canvas/index.js';
export { PalettePanel, type PaletteDragDetail } from './panels/index.js';
export {
  PropertyPanel,
  type PropertyEntry,
  type PropertyEditDetail,
  type ShaclPropertyShape,
  extractShaclShapes,
  buildPropertyEntries,
} from './panels/index.js';
export {
  ModelExplorer,
  type TreeNode,
  type ExplorerSelectDetail,
  buildTree,
  filterTree,
  iriFragment,
} from './panels/index.js';
export {
  CatalogView,
  type CatalogRow,
  type CatalogEditDetail,
  type CatalogSelectDetail,
  type CatalogColumn,
  catalogIriLabel,
  discoverColumns,
  buildCatalogRows,
} from './views/index.js';
export {
  MatrixView,
  type MatrixHeader,
  type MatrixCell,
  type MatrixCellClickDetail,
  type MatrixData,
  matrixIriLabel,
  collectHeaders,
  buildMatrixData,
  cellKey,
} from './views/index.js';
export {
  SparqlEditor,
  type ConstructViewRequestDetail,
  type QueryExecuteDetail,
  sparqlStreamParser,
  sparqlLanguage,
  buildPrefixCompletions,
  extractColumns,
  termValue,
} from './panels/index.js';
export {
  ValidationPanel,
  type ValidationNavigateDetail,
  type ValidationHighlightDetail,
  type GroupedResults,
  iriLabel,
  groupBySeverity,
  buildSummary,
  extractViolatedIris,
} from './panels/index.js';
