import type { DatabaseAdapter, QueryResult, SchemaDefinition } from './types'

/**
 * Config for the remote executor adapter.
 * Pass this from your parent app — your backend holds the real DB credentials.
 */
export interface RemoteExecutorConfig {
  /** Base URL of your API that runs SQL (e.g. https://api.myapp.com or http://localhost:3001) */
  apiUrl: string
  /** Optional: Bearer token or API key if your backend requires auth */
  apiKey?: string
  /** Optional: custom headers sent with every request */
  headers?: Record<string, string>
  /** Path for execute (default: /api/query) */
  queryPath?: string
  /** Path for schema (default: /api/schema) */
  schemaPath?: string
}

/**
 * Create a DatabaseAdapter that calls your backend API.
 * Use this in your parent app and pass the result as executor to useSqlEditor / createSqlEditor.
 *
 * @example
 * // In your parent app (e.g. Next.js, CRA):
 * const adapter = createRemoteAdapter({
 *   apiUrl: process.env.NEXT_PUBLIC_SQL_API_URL ?? 'http://localhost:3001',
 *   apiKey: process.env.NEXT_PUBLIC_SQL_API_KEY,
 * })
 * useSqlEditor({ executor: adapter, dialect: 'postgresql', ... })
 */
export function createRemoteAdapter(config: RemoteExecutorConfig): DatabaseAdapter {
  const {
    apiUrl,
    apiKey,
    headers: customHeaders = {},
    queryPath = '/api/query',
    schemaPath = '/api/schema',
  } = config

  const baseHeaders: Record<string, string> = { ...customHeaders }
  if (apiKey) baseHeaders['Authorization'] = `Bearer ${apiKey}`
  baseHeaders['Content-Type'] = 'application/json'

  const adapter: DatabaseAdapter = {
    async execute(sql: string): Promise<QueryResult> {
      const url = `${apiUrl.replace(/\/$/, '')}${queryPath}`
      const res = await fetch(url, {
        method: 'POST',
        headers: baseHeaders,
        body: JSON.stringify({ sql }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
      const data = await res.json()
      return {
        columns: (data.columns ?? []).map((name: string) => ({ name })),
        rows: data.rows ?? [],
        rowCount: (data.rows ?? []).length,
        elapsed: data.elapsed,
        sql,
      }
    },

    async getSchema(): Promise<SchemaDefinition> {
      const url = `${apiUrl.replace(/\/$/, '')}${schemaPath}`
      const res = await fetch(url, { headers: baseHeaders })
      if (!res.ok) return {}
      return res.json()
    },
  }

  return adapter
}
