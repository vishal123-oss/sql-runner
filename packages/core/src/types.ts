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
// Database adapter (for remote / custom backends)
// ---------------------------------------------------------------------------

export interface DatabaseAdapter {
  /** Execute a SQL statement and return the result. */
  execute(sql: string): Promise<QueryResult>
  /** Optional: return the schema for autocomplete. */
  getSchema?(): Promise<SchemaDefinition>
  /** Optional: cleanup. */
  destroy?(): void
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
