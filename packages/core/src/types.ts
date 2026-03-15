import type { Extension } from '@codemirror/state'
import type { KeyBinding } from '@codemirror/view'

// ---------------------------------------------------------------------------
// Dialect
// ---------------------------------------------------------------------------

export type SqlDialect =
  | 'mysql'
  | 'postgresql'
  | 'sqlite'
  | 'mssql'
  | 'mariadb'
  | 'standard'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** Column definition — can be a simple name or a rich descriptor. */
export interface ColumnDefinition {
  name: string
  type?: string
  comment?: string
}

export type ColumnSpec = string | ColumnDefinition

/**
 * Schema shape accepted by the public API.
 * Supports both flat (table → columns) and nested (schema → table → columns).
 */
export type SchemaDefinition = Record<string, ColumnSpec[] | Record<string, ColumnSpec[]>>

// ---------------------------------------------------------------------------
// Query results
// ---------------------------------------------------------------------------

export interface QueryResultColumn {
  name: string
  type?: string
}

export interface QueryResult {
  columns: QueryResultColumn[]
  rows: Record<string, unknown>[]
  rowCount: number
  /** Total number of rows available (for pagination) */
  totalCount?: number
  /** Current page (0-based) */
  page?: number
  /** Rows per page */
  pageSize?: number
  /** Elapsed time in milliseconds */
  elapsed?: number
  /** The SQL statement that produced this result */
  sql?: string
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationError {
  message: string
  /** 0-based line number */
  line: number
  /** 0-based column offset */
  column: number
  /** Absolute character offset in the document */
  offset: number
  severity: 'error' | 'warning' | 'info'
}

// ---------------------------------------------------------------------------
// Access Control Types (for guardrails from backend)
// ---------------------------------------------------------------------------

/**
 * SQL operation categories for access control classification.
 * Each category maps to one or more SQL statements.
 */
export type SqlOperationCategory =
  | 'select'        // SELECT, WITH (CTEs that select), PRAGMA (sqlite), SHOW
  | 'insert'        // INSERT, COPY (import), LOAD DATA
  | 'update'        // UPDATE
  | 'delete'        // DELETE, TRUNCATE
  | 'ddl_read'      // DESCRIBE, EXPLAIN, SHOW TABLES
  | 'ddl_write'     // CREATE, ALTER, DROP (tables, views, indexes)
  | 'dcl'           // GRANT, REVOKE, LOCK, UNLOCK
  | 'transaction'   // BEGIN, COMMIT, ROLLBACK, SAVEPOINT
  | 'admin'         // SET, USE, ANALYZE, VACUUM, REINDEX
  | 'unknown'       // Cannot classify

/**
 * Access control mode - predefined permission sets.
 */
export type AccessMode =
  | 'no-access'   // Block ALL operations
  | 'read-only'   // SELECT, WITH, PRAGMA, SHOW, DESCRIBE, EXPLAIN only
  | 'write'       // Above + INSERT, CREATE TABLE, COPY
  | 'update'      // Above + UPDATE
  | 'delete'      // Above + DELETE, TRUNCATE, DROP
  | 'full'        // All operations allowed

/**
 * Access control configuration (backend-owned, client gets hints only).
 */
export interface AccessControlConfig {
  mode?: AccessMode
  allowedOperations?: SqlOperationCategory[]
  blockedOperations?: SqlOperationCategory[]
  blockedPatterns?: string[]
  maxRowsLimit?: number
  allowMultiStatement?: boolean
  allowTransactions?: boolean
  /** Require WHERE clause for UPDATE/DELETE (prevent full table scan) */
  requireWhereForModify?: boolean
  /** Maximum query execution time in ms */
  maxExecutionTimeMs?: number
  /** Block SELECT * queries */
  blockSelectStar?: boolean
  /** Allow full table scans */
  allowFullTableScan?: boolean
}

/**
 * Hints sent to client for UX only (NOT for security).
 * Full config stays on backend.
 */
export interface AccessControlHints {
  mode?: AccessMode
  disabledOperations?: SqlOperationCategory[]
  description?: string
  isReadOnly?: boolean
  /** Max rows returned per query */
  maxRowsLimit?: number
  /** Require WHERE for modifications */
  requireWhereForModify?: boolean
  /** Block SELECT * */
  blockSelectStar?: boolean
  /** Allow full table scans */
  allowFullTableScan?: boolean
}

/**
 * Result of access control validation.
 */
export interface AccessControlResult {
  allowed: boolean
  reason?: string
  category: SqlOperationCategory
  appliedMode: AccessMode
}

// ---------------------------------------------------------------------------
// Database adapter (for remote / custom backends)
// ---------------------------------------------------------------------------

export interface DatabaseAdapter {
  /** Execute a SQL statement and return the result. */
  execute(sql: string, signal?: AbortSignal): Promise<QueryResult>
  /** Optional: cancel the currently running query. */
  cancel?(): void
  /** Optional: return the schema for autocomplete. */
  getSchema?(): Promise<SchemaDefinition>
  /** Optional: cleanup. */
  destroy?(): void
  /** Optional: access control hints for UI (not for security - backend enforces). */
  getAccessHints?(): Promise<AccessControlHints | null>
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export type ThemePreset = 'light' | 'dark'

export interface ThemeTokenColors {
  keyword?: string
  string?: string
  number?: string
  comment?: string
  operator?: string
  function?: string
  type?: string
}

export interface ThemeConfig {
  background?: string
  foreground?: string
  caret?: string
  selection?: string
  lineHighlight?: string
  gutterBackground?: string
  gutterForeground?: string
  gutterBorder?: string
  accent?: string
  errorForeground?: string
  tokens?: ThemeTokenColors
}

// ---------------------------------------------------------------------------
// Editor configuration (public API)
// ---------------------------------------------------------------------------

export interface SqlEditorConfig {
  /** DOM element to mount the editor into */
  container: HTMLElement

  /** SQL dialect for parsing, validation, and autocomplete */
  dialect?: SqlDialect

  /** Database schema for autocomplete (tables → columns) */
  schema?: SchemaDefinition

  /** Theme preset name or custom theme config */
  theme?: ThemePreset | ThemeConfig

  /** Placeholder text shown when editor is empty */
  placeholder?: string

  /** Initial SQL value */
  value?: string

  /** Make the editor read-only */
  readOnly?: boolean

  /** Minimum editor height in pixels */
  minHeight?: number

  /** Maximum editor height in pixels */
  maxHeight?: number

  /**
   * Execution strategy:
   * - `'local'` — use built-in sql.js (SQLite in WASM)
   * - A `DatabaseAdapter` object for custom backends
   * - `'none'` — disable execution (validation-only mode)
   */
  executor?: 'local' | 'none' | DatabaseAdapter

  /** Debounce interval in ms for real-time validation (default: 300) */
  validateDelay?: number

  /** Additional CodeMirror extensions */
  extensions?: Extension[]

  /** Additional key bindings */
  keyBindings?: KeyBinding[]

  // --- Callbacks ---

  /** Called whenever validation runs with the current errors */
  onValidate?: (errors: ValidationError[]) => void

  /** Called when the user executes a query (Ctrl/Cmd+Enter) */
  onExecute?: (sql: string, result: QueryResult) => void

  /** Called on execution error */
  onError?: (error: Error, sql: string) => void

  /** Called whenever the editor content changes */
  onChange?: (value: string) => void
}

// ---------------------------------------------------------------------------
// Editor instance (returned by createSqlEditor)
// ---------------------------------------------------------------------------

export interface SqlEditorInstance {
  /** Execute the current editor content */
  run(): Promise<QueryResult | undefined>

  /** Cancel the currently running query */
  cancel(): void

  /** Force validation and return errors */
  validate(): ValidationError[]

  /** Get the current SQL string */
  getValue(): string

  /** Set the editor content */
  setValue(sql: string): void

  /** Update the schema for autocomplete */
  setSchema(schema: SchemaDefinition): void

  /** Switch the SQL dialect */
  setDialect(dialect: SqlDialect): void

  /** Switch theme */
  setTheme(theme: ThemePreset | ThemeConfig): void

  /** Load data into the local executor (sql.js). Expects an array of INSERT-ready rows. */
  loadData(tableName: string, columns: string[], rows: unknown[][]): Promise<void>

  /** Execute raw SQL on the local executor without going through the editor. */
  execRaw(sql: string): Promise<QueryResult>

  /** Focus the editor */
  focus(): void

  /** Destroy the editor and free resources */
  destroy(): void
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** Supported export formats */
export type ExportFormat = 'csv' | 'json' | 'xlsx'

export interface ExportOptions {
  /** Filename for the downloaded file (without extension) */
  filename?: string
  /** Export format (default: 'csv') */
  format?: ExportFormat
  /** Include column headers (default: true) */
  includeHeaders?: boolean
  /** Delimiter character for CSV (default: ',') */
  delimiter?: string
  /** Quote character for CSV (default: '"') */
  quoteChar?: string
  /** Line ending for CSV (default: '\n') */
  lineEnding?: string
  /** JSON formatting options */
  json?: {
    /** Pretty print JSON (default: true) */
    pretty?: boolean
    /** Include metadata (columns, rowCount) in output (default: false) */
    includeMetadata?: boolean
  }
}

export interface ExportResult {
  /** Whether the export was successful */
  success: boolean
  /** Number of rows exported */
  rowCount: number
  /** Filename that was used */
  filename: string
  /** Format that was used */
  format: ExportFormat
  /** Error message if export failed */
  error?: string
}

// ---------------------------------------------------------------------------
// Chart / Visualization
// ---------------------------------------------------------------------------

/** Supported chart types */
export type ChartType = 'bar' | 'horizontal-bar' | 'grouped-bar' | 'stacked-bar' | 'pie' | 'donut'

/** Chart column configuration */
export interface ChartColumnConfig {
  /** Column name to use for labels (x-axis or pie segments) */
  labelColumn: string
  /** Column name(s) to use for values (y-axis) */
  valueColumns: string[]
  /** Optional: Column to use for grouping (for grouped/stacked bars) */
  groupColumn?: string
}

/** Chart color configuration */
export interface ChartColors {
  /** Primary colors for bars/pie slices (array for multiple series) */
  bars?: string[]
  /** Background color */
  background?: string
  /** Text color */
  text?: string
  /** Grid line color */
  grid?: string
  /** Axis color */
  axis?: string
}

/** Chart display options */
export interface ChartOptions {
  /** Chart title */
  title?: string
  /** Show legend (for multi-series charts) */
  showLegend?: boolean
  /** Show grid lines */
  showGrid?: boolean
  /** Show values on bars/slices */
  showValues?: boolean
  /** Custom colors */
  colors?: ChartColors
  /** Chart height in pixels */
  height?: number
  /** Bar width (as fraction, 0-1) */
  barWidth?: number
  /** Animation duration in ms (0 for no animation) */
  animationDuration?: number
  /** X-axis label */
  xAxisLabel?: string
  /** Y-axis label */
  yAxisLabel?: string
  /** Format function for values */
  valueFormatter?: (value: number) => string
  /** Format function for labels */
  labelFormatter?: (label: string) => string
  /** Show percentage on pie/donut charts */
  showPercentage?: boolean
  /** Donut hole size (0-1, only for donut chart) */
  donutHole?: number
}
