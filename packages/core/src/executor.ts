import type { DatabaseAdapter, QueryResult, QueryResultColumn } from './types'

// ---------------------------------------------------------------------------
// Local executor (sql.js — SQLite compiled to WebAssembly)
// ---------------------------------------------------------------------------

const DEFAULT_WASM_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.12.0/sql-wasm.wasm'

let sqlJsPromise: Promise<any> | null = null
let configuredWasmUrl: string = DEFAULT_WASM_CDN

/**
 * Configure the URL from which the sql.js WASM binary is loaded.
 * Call before creating any editor with `executor: 'local'`.
 */
export function configureSqlJsWasm(url: string) {
  configuredWasmUrl = url
  sqlJsPromise = null
}

function resolveInitFn(mod: any): Function {
  if (typeof mod === 'function') return mod
  if (typeof mod?.default === 'function') return mod.default
  if (typeof mod?.default?.default === 'function') return mod.default.default
  throw new Error(
    '@vsql/core: Failed to load sql.js — unexpected module shape. '
    + 'Ensure sql.js is installed. Received type: ' + typeof mod,
  )
}

function loadSqlJs(): Promise<any> {
  if (sqlJsPromise) return sqlJsPromise
  sqlJsPromise = import('sql.js').then((mod: any) => {
    const initFn = resolveInitFn(mod)
    return initFn({
      locateFile: () => configuredWasmUrl,
    })
  })
  return sqlJsPromise
}

/**
 * Error thrown when a query is cancelled
 */
export class QueryCancelledError extends Error {
  constructor(message: string = 'Query was cancelled') {
    super(message)
    this.name = 'QueryCancelledError'
  }
}

export class LocalExecutor implements DatabaseAdapter {
  private db: any = null
  private initPromise: Promise<void> | null = null
  private currentAbortController: AbortController | null = null

  constructor(wasmUrl?: string) {
    if (wasmUrl) configureSqlJsWasm(wasmUrl)
  }

  async init(): Promise<void> {
    if (this.db) return
    if (this.initPromise) return this.initPromise

    this.initPromise = loadSqlJs().then((SQL) => {
      this.db = new SQL.Database()
    })
    return this.initPromise
  }

  /**
   * Cancel the currently running query
   */
  cancel(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }
  }

  async execute(sql: string, signal?: AbortSignal): Promise<QueryResult> {
    await this.init()
    const start = performance.now()

    // Check if already cancelled
    if (signal?.aborted) {
      throw new QueryCancelledError()
    }

    try {
      const trimmed = sql.trim()
      const isSelect = /^\s*(SELECT|PRAGMA|EXPLAIN|WITH)\b/i.test(trimmed)

      // For local SQLite, we simulate cancellation by checking periodically
      // Note: sql.js doesn't support true async cancellation, so we check at key points
      if (isSelect) {
        const stmt = this.db.prepare(trimmed)
        const colNames: string[] = stmt.getColumnNames()
        const rawRows: any[][] = []
        
        while (stmt.step()) {
          // Check for cancellation every 100 rows
          if (rawRows.length % 100 === 0 && signal?.aborted) {
            stmt.free()
            throw new QueryCancelledError()
          }
          rawRows.push(stmt.get())
        }
        stmt.free()

        // Final cancellation check
        if (signal?.aborted) {
          throw new QueryCancelledError()
        }

        const elapsed = Math.round(performance.now() - start)
        const columns: QueryResultColumn[] = colNames.map((name) => ({ name }))
        const rows = rawRows.map((row) => {
          const obj: Record<string, unknown> = {}
          colNames.forEach((col, i) => { obj[col] = row[i] })
          return obj
        })

        return { columns, rows, rowCount: rows.length, elapsed, sql }
      }

      // For non-SELECT queries
      if (signal?.aborted) {
        throw new QueryCancelledError()
      }

      this.db.exec(trimmed)
      const elapsed = Math.round(performance.now() - start)

      return {
        columns: [],
        rows: [],
        rowCount: 0,
        elapsed,
        sql,
      }
    } catch (e: any) {
      if (e instanceof QueryCancelledError) {
        throw e
      }
      throw new Error(e.message || String(e))
    }
  }

  async loadData(
    tableName: string,
    columns: string[],
    rows: unknown[][],
  ): Promise<void> {
    await this.init()

    const colDefs = columns.map((c) => `"${c}" TEXT`).join(', ')
    this.db.run(`CREATE TABLE IF NOT EXISTS "${tableName}" (${colDefs})`)

    if (rows.length === 0) return

    const placeholders = columns.map(() => '?').join(', ')
    const stmt = this.db.prepare(
      `INSERT INTO "${tableName}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
    )

    for (const row of rows) {
      stmt.run(row)
    }
    stmt.free()
  }

  async getSchema() {
    await this.init()
    const tables = await this.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )
    if (!tables.rows.length) return {}

    const schema: Record<string, string[]> = {}
    for (const row of tables.rows) {
      const tableName = row.name as string
      const info = await this.execute(`PRAGMA table_info("${tableName}")`)
      schema[tableName] = info.rows.map((c: any) => c.name as string)
    }
    return schema
  }

  destroy(): void {
    this.cancel()
    if (this.db) {
      this.db.close()
      this.db = null
    }
    this.initPromise = null
  }
}

// ---------------------------------------------------------------------------
// Adapter executor wrapper (for custom backends)
// ---------------------------------------------------------------------------

export class AdapterExecutor {
  private currentAbortController: AbortController | null = null

  constructor(private adapter: DatabaseAdapter) {}

  /**
   * Cancel the currently running query
   */
  cancel(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }
    // Also call adapter's cancel if available
    this.adapter.cancel?.()
  }

  async execute(sql: string, signal?: AbortSignal): Promise<QueryResult> {
    const start = performance.now()
    
    // Check if already cancelled
    if (signal?.aborted) {
      throw new QueryCancelledError()
    }

    const result = await this.adapter.execute(sql, signal)
    
    // Check if cancelled during execution
    if (signal?.aborted) {
      throw new QueryCancelledError()
    }
    
    result.elapsed = result.elapsed ?? Math.round(performance.now() - start)
    result.sql = sql
    return result
  }

  async getSchema() {
    return this.adapter.getSchema?.() ?? {}
  }

  destroy(): void {
    this.cancel()
    this.adapter.destroy?.()
  }
}
