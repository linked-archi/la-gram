// Import/Export layer — ArchiMate XML import, SVG/PNG export, TTL file I/O
export {
  importArchiMateXml,
  mapTypeToIri,
  elementToQuads,
  relationshipToQuads,
  getChildText,
  getXsiType,
  getChildElements,
  ARCHIMATE_NS,
  KNOWN_ELEMENT_TYPES,
  KNOWN_RELATIONSHIP_TYPES,
  type ImportResult,
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
