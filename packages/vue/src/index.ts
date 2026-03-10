// @vsql/vue — Vue bindings for @vsql/core

export { SqlEditor } from './SqlEditor'
export { SqlResults } from './SqlResults'
export { useSqlEditor } from './useSqlEditor'
export type { UseSqlEditorOptions, UseSqlEditorReturn } from './useSqlEditor'

// Re-export commonly used types from core
export type {
  SqlDialect,
  SchemaDefinition,
  QueryResult,
  ValidationError,
  DatabaseAdapter,
  ThemePreset,
  ThemeConfig,
  SqlEditorConfig,
  SqlEditorInstance,
} from '@vsql/core'
