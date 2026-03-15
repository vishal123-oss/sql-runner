import type { DatabaseAdapter, QueryResult, SchemaDefinition, AccessControlHints } from '@vsql/core'
import { API_BASE_URL, API_KEY } from './config'

let cachedAccessHints: AccessControlHints | null = null

/**
 * Adapter that sends SQL to your backend. Your backend holds
 * the real database credentials and returns query results.
 * 
 * Includes access control guardrails from backend.
 */
export const remoteDbAdapter: DatabaseAdapter = {
  async execute(sql: string): Promise<QueryResult> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`

    // Get current user from localStorage or default
    const user = typeof window !== 'undefined' ? localStorage.getItem('vsql_user') || 'anonymous' : 'anonymous'

    const res = await fetch(`${API_BASE_URL}/api/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sql, user }),
    })

    if (!res.ok) {
      const text = await res.text()
      try {
        const json = JSON.parse(text)
        throw new Error(json.error || text || `HTTP ${res.status}`)
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== 'SyntaxError') throw e
        throw new Error(text || `HTTP ${res.status}`)
      }
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
    const headers: Record<string, string> = {}
    if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`

    const res = await fetch(`${API_BASE_URL}/api/schema`, { headers })
    if (!res.ok) return {}
    return res.json()
  },

  async getAccessHints(): Promise<AccessControlHints | null> {
    // Return cached if available
    if (cachedAccessHints) return cachedAccessHints

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`

      const res = await fetch(`${API_BASE_URL}/api/access-hints`, { headers })
      if (!res.ok) return null

      cachedAccessHints = await res.json()
      return cachedAccessHints
    } catch {
      return null
    }
  },
}
