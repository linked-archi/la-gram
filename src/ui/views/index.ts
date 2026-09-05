// Views — catalog, matrix
export {
  CatalogView,
  type CatalogRow,
  type CatalogEditDetail,
  type CatalogSelectDetail,
  type CatalogColumn,
  iriLabel as catalogIriLabel,
  discoverColumns,
  buildCatalogRows,
} from './catalog-view.js';

export {
  MatrixView,
  type MatrixHeader,
  type MatrixCell,
  type MatrixCellClickDetail,
  type MatrixData,
  iriLabel as matrixIriLabel,
  collectHeaders,
  buildMatrixData,
  cellKey,
} from './matrix-view.js';
