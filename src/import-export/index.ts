// Import/Export layer — ArchiMate XML import, SVG/PNG export, TTL file I/O
export {
  parseArchiMateExchange,
  applyExchangeModel,
  exchangeTypeIri,
  exchangeRelationshipTypeIri,
  getChildText,
  getXsiType,
  getChildElements,
  ARCHIMATE_NS,
  ARCHIMATE3_METAMODEL,
  type ExchangeModel,
  type ExchangeConcept,
  type ExchangeRelationship,
  type ExchangeView,
  type ExchangeNode,
  type ExchangeConnection,
  type ImportReport,
  type ApplyExchangeDeps,
} from './archimate-importer.js';

export {
  exportSvg,
  exportPng,
  downloadBlob,
  downloadSvg,
} from './svg-png-exporter.js';

export {
  TtlFileIO,
  type SaveResult,
  type LoadResult,
  type ExportResult,
} from './ttl-file-io.js';

export {
  ModelIO,
  MODEL_FORMATS,
  formatInfo,
  partitionModel,
  partitionGraphs,
  parseModelText,
  type ModelFormat,
  type ModelFormatInfo,
  type SerializationProfile,
  type SerializeOptions,
  type ModelPartition,
  type ModelLoadResult,
} from '@linked-archi/kernel/import-export/model-io.js';
