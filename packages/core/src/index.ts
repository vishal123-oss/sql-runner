// @vsql/core — Framework-agnostic SQL editor, validator, and runner

export { createSqlEditor } from './editor'
export { validateSql } from './validator'
export { LocalExecutor, configureSqlJsWasm, createAccessControlledAdapter, AccessControlledExecutor } from './executor'
export { createRemoteAdapter } from './remoteAdapter'
export { buildTheme } from './theme'
export { toCodeMirrorSchema, getTableNames, getAllColumns, getColumnsForTable } from './schema'

// Access control exports
export {
  validateAccessControl,
  classifySqlOperation,
  isReadOperation,
  isWriteOperation,
  generateAccessHints,
  createAccessConfig,
  AccessPresets,
} from './accessControl'

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
  // Access control types
  SqlOperationCategory,
  AccessMode,
  AccessControlConfig,
  AccessControlHints,
  AccessControlResult,
} from './types'
export type { RemoteExecutorConfig } from './remoteAdapter'
