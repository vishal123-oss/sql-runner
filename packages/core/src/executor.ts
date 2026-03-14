import type { DatabaseAdapter, QueryResult, QueryResultColumn, AccessControlConfig, AccessControlHints } from './types'
import { validateAccessControl, generateAccessHints } from './accessControl'

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

export class LocalExecutor implements DatabaseAdapter {
  private db: any = null
  private initPromise: Promise<void> | null = null

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

  async execute(sql: string, options?: { page?: number; pageSize?: number }): Promise<QueryResult> {
    await this.init()
    const start = performance.now()

    try {
      const trimmed = sql.trim()
      const isSelect = /^\s*(SELECT|PRAGMA|EXPLAIN|WITH)\b/i.test(trimmed)

      if (isSelect) {
        let finalSql = trimmed
        const { page, pageSize } = options || {}

        if (pageSize != null && page != null) {
          // Add LIMIT and OFFSET for pagination (SQLite style)
          finalSql = `${trimmed} LIMIT ${pageSize} OFFSET ${page * pageSize}`
        }

        const stmt = this.db.prepare(finalSql)
        const colNames: string[] = stmt.getColumnNames()
        const rawRows: any[][] = []
        while (stmt.step()) {
          rawRows.push(stmt.get())
        }
        stmt.free()

        // Get total count if paginated
        let totalCount = rawRows.length
        if (pageSize != null && page != null) {
          try {
            // Very simple way to get count, might not work for all queries but good for demo
            const countSql = `SELECT COUNT(*) FROM (${trimmed})`
            const countRes = this.db.exec(countSql)
            if (countRes.length > 0 && countRes[0].values.length > 0) {
              totalCount = countRes[0].values[0][0]
            }
          } catch (e) {
            console.warn('Failed to get total count for pagination', e)
          }
        }

        const elapsed = Math.round(performance.now() - start)
        const columns: QueryResultColumn[] = colNames.map((name) => ({ name }))
        const rows = rawRows.map((row) => {
          const obj: Record<string, unknown> = {}
          colNames.forEach((col, i) => { obj[col] = row[i] })
          return obj
        })

        return {
          columns,
          rows,
          rowCount: rows.length,
          totalCount,
          page,
          pageSize,
          elapsed,
          sql: finalSql
        }
      }

      this.db.exec(trimmed)
      const elapsed = Math.round(performance.now() - start)

      return {
        columns: [],
        rows: [],
        rowCount: 0,
        elapsed,
        sql: trimmed,
      }
    } catch (e: any) {
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
  constructor(private adapter: DatabaseAdapter) {}

  async execute(sql: string, options?: { page?: number; pageSize?: number }): Promise<QueryResult> {
    const start = performance.now()
    const result = await this.adapter.execute(sql, options)
    result.elapsed = result.elapsed ?? Math.round(performance.now() - start)
    result.sql = result.sql ?? sql
    return result
  }

  async getSchema() {
    return this.adapter.getSchema?.() ?? {}
  }

  destroy(): void {
    this.adapter.destroy?.()
  }
}

// ---------------------------------------------------------------------------
// Access Controlled Executor (wraps any adapter with guardrails)
// ---------------------------------------------------------------------------

/**
 * Wraps a DatabaseAdapter with access control validation.
 *
 * SECURITY NOTE:
 * - For remote adapters: Client-side validation is for UX only.
 *   Backend MUST enforce access control on /api/query endpoint.
 * - For local adapters: This IS the enforcement (no backend).
 *
 * @example
 * // Remote adapter with hints from backend
 * const adapter = createAccessControlledAdapter(remoteAdapter, {
 *   hints: { mode: 'read-only', isReadOnly: true },
 *   // config is NOT sent to client - backend has it
 * })
 */
export class AccessControlledExecutor {
  private config: AccessControlConfig

  constructor(
    private adapter: DatabaseAdapter,
    options: {
      /** Full config (for local enforcement). Backend should NOT send this to client. */
      config?: AccessControlConfig
      /** Hints only (for UI). Safe to send from backend. */
      hints?: AccessControlHints
    } = {},
  ) {
    // If hints provided, derive a minimal config for client-side validation
    // Full config should come from options.config (backend only)
    this.config = options.config ?? {
      mode: options.hints?.mode ?? 'full',
      // Derive blocked ops from hints (advisory only)
      blockedOperations: options.hints?.disabledOperations,
    }
  }

  /**
   * Get current access control hints for UI display.
   */
  async getAccessHints(): Promise<AccessControlHints | null> {
    // Prefer adapter's own hints if available, else generate from config
    const adapterHints = await this.adapter.getAccessHints?.()
    if (adapterHints) return adapterHints
    return generateAccessHints(this.config)
  }

  async execute(sql: string, options?: { page?: number; pageSize?: number }): Promise<QueryResult> {
    // Validate against config (enforcement for local, advisory for remote)
    const validation = validateAccessControl(sql, this.config)
    if (!validation.allowed) {
      throw new Error(
        `Access denied: ${validation.reason ?? 'Operation not permitted'} ` +
        `[category: ${validation.category}, mode: ${validation.appliedMode}]`,
      )
    }

    const start = performance.now()
    const result = await this.adapter.execute(sql, options)
    result.elapsed = result.elapsed ?? Math.round(performance.now() - start)
    result.sql = result.sql ?? sql
    return result
  }

  async getSchema() {
    return this.adapter.getSchema?.() ?? {}
  }

  destroy(): void {
    this.adapter.destroy?.()
  }
}

/**
 * Create an access-controlled adapter wrapper.
 *
 * @param adapter - The underlying adapter (local or remote)
 * @param options - Config (for enforcement) or hints (for UX)
 * @returns A DatabaseAdapter with access control
 */
export function createAccessControlledAdapter(
  adapter: DatabaseAdapter,
  options: {
    /** Full access control config (backend only - do NOT send to client) */
    config?: AccessControlConfig
    /** Hints for UI (safe to send from backend to client) */
    hints?: AccessControlHints
  } = {},
): DatabaseAdapter {
  const controlled = new AccessControlledExecutor(adapter, options)
  return {
    execute: (sql, opts) => controlled.execute(sql, opts),
    getSchema: () => controlled.getSchema(),
    destroy: () => controlled.destroy(),
    getAccessHints: () => controlled.getAccessHints(),
  }
}
