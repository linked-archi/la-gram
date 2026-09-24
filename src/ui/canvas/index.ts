// Canvas modules — diagram-js wrapper and custom RDF providers
export {
  DiagramCanvas,
  type DiagramCanvasOptions,
  type CanvasElement,
  type CanvasRelationship,
} from './diagram-canvas.js';
export {
  CANVAS_TOOLS,
  toolFromManagerName,
  type CanvasTool,
  type CanvasToolInfo,
} from './canvas-tools.js';
export {
  RdfRenderer,
  rdfRendererModule,
  RENDER_CLASSES,
  type RdfBusinessObject,
  type RenderableElement,
} from './rdf-renderer.js';
export {
  RdfRuleProvider,
  RdfRules,
  rdfRulesModule,
  type RdfConnectionAttrs,
} from './rdf-rule-provider.js';
export {
  RdfModeling,
  RdfRelationshipBehavior,
  RdfElementBehavior,
  CreateRelationshipHandler,
  RetypeRelationshipHandler,
  CreateElementHandler,
  rdfModelingModule,
  RDF_RELATIONSHIP_HINT,
  CREATE_RELATIONSHIP_COMMAND,
  RETYPE_RELATIONSHIP_COMMAND,
  CREATE_ELEMENT_COMMAND,
  type RdfConnectAttrs,
  type RdfRelationship,
  type RdfRelationshipRequest,
  type RdfRelationshipWriter,
  type RetypeRelationshipContext,
  type RdfElementBounds,
  type RdfElementRequest,
  type RdfElementResult,
  type RdfElementWriter,
} from './rdf-modeling.js';
export {
  RdfContextPadProvider,
  toContextPadElement,
  type ContextPadEntry,
  type ContextPadElement,
  type ContextPadAction,
  type StartConnectRequest,
  type PadMenuSupport,
  type RelationshipReplaceSupport,
} from './rdf-context-pad-provider.js';
export {
  RdfAppendMenuProvider,
  appendEntryId,
  APPEND_TARGET_MENU_ID,
  APPEND_ENTRY_CLASS,
  APPEND_DEFAULT_GROUP,
  type AppendMenuContext,
  type AppendMenuContextResolver,
  type AppendTargetResolver,
  type AppendSupport,
  type AppendMenuEntry,
  type AppendMenuEntries,
} from './rdf-append-menu-provider.js';
export {
  RdfReplaceMenuProvider,
  relationshipEntryId,
  RELATIONSHIP_REPLACE_MENU_ID,
  ENTRY_CLASS as RELATIONSHIP_ENTRY_CLASS,
  ENTRY_CLASS_CURRENT as RELATIONSHIP_ENTRY_CLASS_CURRENT,
  ENTRY_GROUP as RELATIONSHIP_ENTRY_GROUP,
  type RelationshipReplaceContext,
  type RelationshipReplaceContextResolver,
  type RelationshipRetypeRequest,
  type RdfPopupMenuEntry,
  type RdfPopupMenuEntries,
} from './rdf-replace-menu-provider.js';
export {
  appendableTargetTypes,
  buildClassClosure,
  hasOutgoingRelationshipTypes,
  identityClosure,
  relationshipKey,
  type AppendTarget,
  type ClassClosure,
  type ClosureSource,
  type ValidRelationshipLookup,
} from './relationship-resolution.js';
export {
  CroppingLayouter,
  CroppingConnectionDocking,
  type ConnectionDocking,
  type DockingPoint,
} from './connection-docking.js';
export { NotationStyleRegistry, emptyPaletteDefinition } from './notation-styles.js';
export {
  NOTATION_DEFAULTS,
  SHAPE_TYPES,
  ICON_PLACEMENTS,
  DECORATIONS,
  badgeBox,
  iconHref,
  labelLayout,
  markerDefinition,
  markerId,
  shapeGeometry,
  shapePath,
  strokeDashArray,
  svgEl,
  wrapLabel,
  type BadgeBox,
  type DecorationEnd,
  type LabelLayout,
  type MarkerDefinition,
  type ShapeGeometry,
} from './notation-shapes.js';
