// @vsql/react — React bindings for @vsql/core

export { SqlEditor } from './SqlEditor'
export type { SqlEditorProps, SqlEditorRef } from './SqlEditor'

export { SqlResults } from './SqlResults'
export type { SqlResultsProps } from './SqlResults'

export { SqlChart } from './SqlChart'
export type { SqlChartProps } from './SqlChart'

export { useSqlEditor } from './useSqlEditor'
export type { UseSqlEditorOptions, UseSqlEditorReturn } from './useSqlEditor'

// Re-export remote adapter so parent app can pass API config as "credentials"
export { createRemoteAdapter } from '@vsql/core'
export type { RemoteExecutorConfig } from '@vsql/core'

// Re-export export utilities
export { exportToCSV, exportToJSON, exportToExcel, exportData, convertToCSV, convertToJSON, convertToExcel } from '@vsql/core'

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
  ExportOptions,
  ExportResult,
  ExportFormat,
  ChartType,
  ChartColumnConfig,
  ChartColors,
  ChartOptions,
} from '@vsql/core'
