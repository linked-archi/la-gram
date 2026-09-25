// Panels — palette, property, explorer, validation, SPARQL editor
export { PalettePanel, type PaletteDragDetail } from './palette-panel.js';
export {
  PropertyPanel,
  type PropertyEntry,
  type PropertyEditDetail,
  type ShaclPropertyShape,
  extractShaclShapes,
  buildPropertyEntries,
} from './property-panel.js';
export {
  ModelExplorer,
  type TreeNode,
  type TreeNodeKind,
  type ExplorerSelectDetail,
  type ExplorerActivateDetail,
  type ExplorerAction,
  type ExplorerActionDetail,
  type ExplorerDragDetail,
  buildModelTree,
  filterTree,
  actionsFor,
  iriFragment,
} from './model-explorer.js';
export {
  SparqlEditor,
  type ConstructViewRequestDetail,
  type QueryExecuteDetail,
  sparqlStreamParser,
  sparqlLanguage,
  buildPrefixCompletions,
  extractColumns,
  termValue,
} from './sparql-editor.js';
export {
  ValidationPanel,
  type ValidationNavigateDetail,
  type ValidationHighlightDetail,
  type GroupedResults,
  iriLabel,
  groupBySeverity,
  buildSummary,
  extractViolatedIris,
} from './validation-panel.js';
