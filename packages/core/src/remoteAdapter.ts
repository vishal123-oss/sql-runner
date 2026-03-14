import type { DatabaseAdapter, QueryResult, SchemaDefinition, AccessControlHints, AccessControlConfig } from './types'
import { createAccessControlledAdapter } from './executor'

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
  /** Path for access control hints (default: /api/access-hints) */
  accessHintsPath?: string
  /** Optional: Access control hints from backend (for UX only, not security) */
  accessHints?: AccessControlHints
  /** Optional: Full access control config (backend only - DO NOT send to client) */
  accessConfig?: AccessControlConfig
}

/**
 * Create a DatabaseAdapter that calls your backend API.
 * Use this in your parent app and pass the result as executor to useSqlEditor / createSqlEditor.
 *
 * SECURITY: Access control is configured on backend. Client receives only "hints" for UX.
 * The backend MUST validate every query against its own AccessControlConfig.
 *
 * @example
 * // In your parent app (e.g. Next.js, CRA):
 * const adapter = createRemoteAdapter({
 *   apiUrl: process.env.NEXT_PUBLIC_SQL_API_URL ?? 'http://localhost:3001',
 *   apiKey: process.env.NEXT_PUBLIC_SQL_API_KEY,
 *   // Backend sends hints via /api/access-hints (optional)
 * })
 * useSqlEditor({ executor: adapter, dialect: 'postgresql', ... })
 *
 * @example
 * // Backend: Fetch hints and pass to client
 * const hints = await fetchAccessHints() // from your backend's config
 * const adapter = createRemoteAdapter({
 *   apiUrl: 'https://api.example.com',
 *   accessHints: hints, // for UX only
 * })
 */
export function createRemoteAdapter(config: RemoteExecutorConfig): DatabaseAdapter {
  const {
    apiUrl,
    apiKey,
    headers: customHeaders = {},
    queryPath = '/api/query',
    schemaPath = '/api/schema',
    accessHintsPath = '/api/access-hints',
    accessHints: providedHints,
    accessConfig: providedConfig,
  } = config

  const baseHeaders: Record<string, string> = { ...customHeaders }
  if (apiKey) baseHeaders['Authorization'] = `Bearer ${apiKey}`
  baseHeaders['Content-Type'] = 'application/json'

  let cachedHints: AccessControlHints | null = providedHints ?? null

  // Base adapter that talks to backend
  const baseAdapter: DatabaseAdapter = {
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

    async getAccessHints(): Promise<AccessControlHints | null> {
      if (cachedHints) return cachedHints
      try {
        const url = `${apiUrl.replace(/\/$/, '')}${accessHintsPath}`
        const res = await fetch(url, { headers: baseHeaders })
        if (res.ok) {
          cachedHints = await res.json()
          return cachedHints
        }
      } catch {
        // Silently fail - hints are optional
      }
      return null
    },
  }

  // If access control is configured (config or hints), wrap with access control
  if (providedConfig || providedHints) {
    return createAccessControlledAdapter(baseAdapter, {
      config: providedConfig,
      hints: providedHints,
    })
  }

  return baseAdapter
}
