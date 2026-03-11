// @vsql/core — Framework-agnostic SQL editor, validator, and runner

export { createSqlEditor } from './editor'
export { validateSql } from './validator'
export { LocalExecutor, configureSqlJsWasm } from './executor'
export { createRemoteAdapter } from './remoteAdapter'
export { buildTheme } from './theme'
export { toCodeMirrorSchema, getTableNames, getAllColumns, getColumnsForTable } from './schema'
export { exportToCSV, exportToJSON, exportToExcel, exportData, convertToCSV, convertToJSON, convertToExcel } from './export'

export type {
  SqlDialect,
  SchemaDefinition,
  ColumnDefinition,
  ColumnSpec,
  QueryResult,
  QueryResultColumn,
  ValidationError,
  DatabaseAdapter,
  ThemePreset,
  ThemeConfig,
  ThemeTokenColors,
  SqlEditorConfig,
  SqlEditorInstance,
  ExportOptions,
  ExportResult,
  ExportFormat,
  ChartType,
  ChartColumnConfig,
  ChartColors,
  ChartOptions,
} from './types'
export type { RemoteExecutorConfig } from './remoteAdapter'
