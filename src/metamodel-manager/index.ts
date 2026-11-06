// Metamodel Manager layer — metamodel loading, palette generation, viewpoint management
export type {
  MetamodelLoader,
  PaletteGenerator,
  ViewpointManager,
  MetamodelInfo,
  LoadedMetamodel,
  MetamodelAssetStatus,
  MetamodelAssetOutcome,
  PaletteDefinition,
  PaletteOptions,
  PaletteAxis,
  ElementGroup,
  ElementTypeInfo,
  RelationshipTypeInfo,
  ResolvedUri,
  ViewpointInfo,
} from './interfaces.js';
export { N3MetamodelLoader } from './metamodel-loader.js';
export { SparqlPaletteGenerator } from './palette-generator.js';
export { SparqlViewpointManager } from './viewpoint-manager.js';
export type { BundledAsset, BundledAssetRole } from './bundled-assets.js';
export {
  ASSET_ROOT,
  PUBLISHED_BASE_URI,
  BUNDLED_ICON_PREFIXES,
  BUNDLED_ASSETS,
  getAssetsByRole,
  getAssetByIri,
  resolveIconUri,
  resolveIconUriOrPassThrough,
  configureAssetRoot,
  assetUrl,
  fetchAssetText,
  fetchAllAssetTexts,
} from './bundled-assets.js';
export type {
  TaxonomyAxis,
  SemanticClass,
} from './taxonomy.js';
export { buildClassificationAxes, buildClasses, matchesClass } from './taxonomy.js';
export type {
  VisualStyle,
  RelationshipVisualStyle,
  VisualNotation,
  NotationSet,
  ShapeType,
  IconPlacement,
  RenderingMode,
  LineStyle,
  Decoration,
} from './notation.js';
export {
  buildVisualNotations,
  resolveNotationSetForContext,
  listNotationSets,
  effectiveRenderingMode,
} from './notation.js';
export type { NotationSource, ResolvedNotation, NotationIndexEntry } from './notation-resolver.js';
export {
  NotationResolver,
  orderedFallbackSets,
  storeDefaultNotationSetIris,
} from './notation-resolver.js';
