import type { DatabaseAdapter, QueryResult, SchemaDefinition } from '@vsql/core'
import { API_BASE_URL, API_KEY } from './config'

/**
 * Session info returned from the server
 */
export interface SessionInfo {
  sessionId: string
  user: string
  createdAt: string
}

/**
 * Session manager for per-user/per-session database connections.
 * Each session gets its own isolated database connection.
 */
class SessionManager {
  private sessionId: string | null = null
  private sessionUser: string | null = null
  private sessionCreatedAt: Date | null = null

  /**
   * Create a new session with its own database connection
   */
  async createSession(user: string = 'anonymous'): Promise<SessionInfo> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`

    const res = await fetch(`${API_BASE_URL}/api/session`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ user }),
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
    
    this.sessionId = data.session.sessionId
    this.sessionUser = data.session.user
    this.sessionCreatedAt = new Date(data.session.createdAt)
    
    console.log(`[Session] Created: ${this.sessionId} for user: ${this.sessionUser}`)
    
    return {
      sessionId: this.sessionId,
      user: this.sessionUser,
      createdAt: data.session.createdAt,
    }
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    return this.sessionId
  }

  /**
   * Get session info
   */
  getSessionInfo(): { sessionId: string; user: string; createdAt: Date } | null {
    if (!this.sessionId) return null
    return {
      sessionId: this.sessionId,
      user: this.sessionUser!,
      createdAt: this.sessionCreatedAt!,
    }
  }

  /**
   * Close the current session and release the connection
   */
  async closeSession(): Promise<boolean> {
    if (!this.sessionId) return false

    const headers: Record<string, string> = {}
    if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`

    try {
      const res = await fetch(`${API_BASE_URL}/api/session/${this.sessionId}`, {
        method: 'DELETE',
        headers,
      })

      if (res.ok) {
        console.log(`[Session] Closed: ${this.sessionId}`)
        this.sessionId = null
        this.sessionUser = null
        this.sessionCreatedAt = null
        return true
      }
    } catch (e) {
      console.error('[Session] Error closing session:', e)
    }

    return false
  }

  /**
   * Ensure we have an active session, create one if needed
   */
  async ensureSession(user: string = 'anonymous'): Promise<string> {
    if (this.sessionId) {
      return this.sessionId
    }
    const session = await this.createSession(user)
    return session.sessionId
  }
}

// Global session manager instance
export const sessionManager = new SessionManager()

/**
 * Adapter that sends SQL to your backend. Your backend holds
 * the real database credentials and returns query results.
 * 
 * Supports per-session database connections for isolation.
 */
export const remoteDbAdapter: DatabaseAdapter = {
  async execute(sql: string): Promise<QueryResult> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`

    // Include sessionId if we have one
    const sessionId = sessionManager.getSessionId()
    const body: Record<string, unknown> = { sql }
    if (sessionId) {
      body.sessionId = sessionId
    }

    const res = await fetch(`${API_BASE_URL}/api/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text()
      try {
        const json = JSON.parse(text)
        
        // If session expired, clear it and retry without session
        if (json.needsNewSession) {
          console.log('[Session] Session expired, creating new one...')
          await sessionManager.createSession()
          // Retry with new session
          return this.execute(sql)
        }
        
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
}
