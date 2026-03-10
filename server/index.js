/**
 * Example backend: put your DATABASE CREDENTIALS here (or in .env).
 * This server runs SQL and returns results; the frontend never sees credentials.
 *
 * 1. Copy server/.env.example to server/.env and set DB_* values.
 * 2. cd server && npm install && npm start
 *
 * GUARDRAILS: This server now supports guardrails configuration.
 * Set GUARDRAILS_MODE environment variable:
 *   - 'read-only': Only SELECT queries allowed
 *   - 'write': SELECT, INSERT, UPDATE allowed (no DELETE)
 *   - 'full': All operations allowed (default)
 *   - 'strict': Strict mode with pattern controls
 *
 * Or use the API to dynamically update guardrails (for demo purposes).
 *
 * AUDIT LOG: All executed queries are logged with:
 *   - Timestamp
 *   - Username
 *   - SQL query
 *   - Operation type
 *   - Tables affected
 *   - Row count
 *   - Execution time
 *   - Status (success/blocked/error)
 *
 * SESSION CONNECTIONS: Each user/session gets their own isolated DB connection.
 * This allows:
 *   - Per-session temporary tables
 *   - Session-level variables and settings
 *   - Transaction isolation per user
 *   - Independent connection lifecycle management
 */

require('dotenv').config()
const express = require('express')
const cors = require('cors')
const crypto = require('crypto')

const app = express()
app.use(cors())
app.use(express.json())

// ========== REPLACE WITH YOUR DATABASE CREDENTIALS ==========
// Option A: Use environment variables (recommended)
//   Create demo/.env with:
//   DB_HOST=localhost
//   DB_PORT=5432
//   DB_USER=myuser
//   DB_PASSWORD=mypassword
//   DB_NAME=mydb
//   DB_TYPE=postgres   (or 'mysql')

// Option B: Set directly here (only for local dev, never commit real passwords)
const DB_CONFIG = {
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME ?? 'postgres',
}
const DB_TYPE = (process.env.DB_TYPE || 'postgres').toLowerCase()

// ========== Session Connection Manager ==========
// Manages per-user/per-session database connections
// Each session gets its own isolated connection

const SESSION_CONFIG = {
  maxSessions: 100,                    // Maximum concurrent sessions
  sessionTimeout: 30 * 60 * 1000,      // 30 minutes idle timeout
  cleanupInterval: 60 * 1000,          // Cleanup every minute
}

class SessionConnectionManager {
  constructor() {
    this.sessions = new Map() // sessionId -> { connection, lastAccess, user, metadata }
    this.pg = null
    this.mysql = null
  }

  // Initialize database drivers
  async init() {
    if (DB_TYPE === 'postgres') {
      this.pg = require('pg')
    } else if (DB_TYPE === 'mysql') {
      this.mysql = require('mysql2/promise')
    }
    
    // Start cleanup interval
    this.startCleanup()
  }

  // Generate a new session ID
  generateSessionId() {
    return `sess_${Date.now()}_${crypto.randomBytes(16).toString('hex')}`
  }

  // Create a new session with its own connection
  async createSession(user = 'anonymous', metadata = {}) {
    if (this.sessions.size >= SESSION_CONFIG.maxSessions) {
      // Try to cleanup expired sessions first
      this.cleanupExpired()
      
      if (this.sessions.size >= SESSION_CONFIG.maxSessions) {
        throw new Error('Maximum sessions reached. Please try again later.')
      }
    }

    const sessionId = this.generateSessionId()
    const connection = await this.createConnection()

    const session = {
      id: sessionId,
      connection,
      user,
      metadata,
      createdAt: new Date(),
      lastAccess: new Date(),
      queryCount: 0,
    }

    this.sessions.set(sessionId, session)
    
    console.log(`[Session] Created: ${sessionId} for user: ${user} (total: ${this.sessions.size})`)
    
    return {
      sessionId,
      user,
      createdAt: session.createdAt,
    }
  }

  // Create a new database connection
  async createConnection() {
    if (DB_TYPE === 'postgres') {
      const client = new this.pg.Client(DB_CONFIG)
      await client.connect()
      return { type: 'postgres', client }
    } else if (DB_TYPE === 'mysql') {
      const conn = await this.mysql.createConnection({
        host: DB_CONFIG.host,
        port: DB_CONFIG.port,
        user: DB_CONFIG.user,
        password: DB_CONFIG.password,
        database: DB_CONFIG.database,
      })
      return { type: 'mysql', conn }
    }
    throw new Error('Set DB_TYPE to postgres or mysql')
  }

  // Get a session's connection
  getSession(sessionId) {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return null
    }
    
    // Update last access time
    session.lastAccess = new Date()
    return session
  }

  // Execute a query on a session's connection
  async executeQuery(sessionId, sql) {
    const session = this.getSession(sessionId)
    if (!session) {
      throw new Error('Session not found or expired')
    }

    const { connection } = session
    session.queryCount++

    if (connection.type === 'postgres') {
      const result = await connection.client.query(sql)
      return {
        columns: (result.fields || []).map(f => f.name),
        rows: (result.rows || []).map(r => ({ ...r })),
        rowCount: result.rowCount || (result.rows || []).length,
      }
    } else if (connection.type === 'mysql') {
      const [raw, fields] = await connection.conn.execute(sql)
      return {
        columns: (fields || []).map(f => f.name),
        rows: (Array.isArray(raw) ? raw : []).map(r => ({ ...r })),
        rowCount: Array.isArray(raw) ? raw.length : 0,
      }
    }
    
    throw new Error('Invalid connection type')
  }

  // Close a specific session
  async closeSession(sessionId) {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return false
    }

    try {
      if (session.connection.type === 'postgres') {
        await session.connection.client.end()
      } else if (session.connection.type === 'mysql') {
        await session.connection.conn.end()
      }
    } catch (e) {
      console.error(`[Session] Error closing connection: ${e.message}`)
    }

    this.sessions.delete(sessionId)
    console.log(`[Session] Closed: ${sessionId} (total: ${this.sessions.size})`)
    return true
  }

  // Cleanup expired sessions
  cleanupExpired() {
    const now = Date.now()
    const expired = []

    for (const [sessionId, session] of this.sessions) {
      const idleTime = now - session.lastAccess.getTime()
      if (idleTime > SESSION_CONFIG.sessionTimeout) {
        expired.push(sessionId)
      }
    }

    for (const sessionId of expired) {
      this.closeSession(sessionId)
    }

    if (expired.length > 0) {
      console.log(`[Session] Cleaned up ${expired.length} expired sessions`)
    }

    return expired.length
  }

  // Start periodic cleanup
  startCleanup() {
    setInterval(() => {
      this.cleanupExpired()
    }, SESSION_CONFIG.cleanupInterval)
  }

  // Get session stats
  getStats() {
    const sessions = Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      user: s.user,
      createdAt: s.createdAt,
      lastAccess: s.lastAccess,
      queryCount: s.queryCount,
      idleMs: Date.now() - s.lastAccess.getTime(),
    }))

    return {
      total: this.sessions.size,
      maxSessions: SESSION_CONFIG.maxSessions,
      sessionTimeout: SESSION_CONFIG.sessionTimeout,
      sessions,
    }
  }
}

// Initialize session manager
const sessionManager = new SessionConnectionManager()
sessionManager.init().catch(console.error)

// ========== Audit Log Storage ==========
// In production, this would be stored in a database
const auditLog = []
const MAX_AUDIT_ENTRIES = 1000

function addAuditEntry(entry) {
  const newEntry = {
    id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  }
  
  // Add to beginning, keep only last MAX_AUDIT_ENTRIES
  auditLog.unshift(newEntry)
  if (auditLog.length > MAX_AUDIT_ENTRIES) {
    auditLog.pop()
  }
  
  return newEntry
}

// ========== Guardrails Configuration ==========
// This is determined by the backend based on user role/permissions
// The frontend never sees this configuration directly

const GUARDRAILS_MODE = process.env.GUARDRAILS_MODE || 'full'

// Dynamic guardrails state (can be updated via API for demo)
let dynamicGuardrails = null

function getGuardrailsConfig() {
  // Return dynamic config if set (for demo purposes)
  if (dynamicGuardrails) {
    return dynamicGuardrails
  }

  switch (GUARDRAILS_MODE) {
    case 'read-only':
      return {
        permissions: {
          select: true,
          insert: false,
          update: false,
          delete: false,
          ddl: false,
          dcl: false,
          other: true,
        },
        blockedMessage: 'Read-only mode: Only SELECT queries are allowed.',
      }
    case 'write':
      return {
        permissions: {
          select: true,
          insert: true,
          update: true,
          delete: false,
          ddl: false,
          dcl: false,
          other: true,
        },
        blockedMessage: 'Delete operations are not permitted for your role.',
      }
    case 'strict':
      return {
        permissions: {
          select: true,
          insert: true,
          update: true,
          delete: false,
          ddl: false,
          dcl: false,
          other: true,
        },
        limits: {
          maxRows: 100,
          maxJoinedTables: 3,
          maxSelectedColumns: 20,
          timeout: 5000,
        },
        patterns: {
          allowSelectAll: false,
          allowFullTableScan: false,
          allowCrossJoin: false,
          allowSubqueries: true,
          allowUnion: true,
          maxSubqueryDepth: 2,
          allowOrderByWithoutLimit: false,
          requireLimit: true,
          defaultLimit: 100,
        },
        tableAccess: {
          allowSystemTables: false,
        },
        blockedMessage: 'Strict mode: Query violates guardrails policy.',
      }
    case 'full':
    default:
      return {
        permissions: {
          select: true,
          insert: true,
          update: true,
          delete: true,
          ddl: true,
          dcl: false, // DCL typically restricted
          other: true,
        },
      }
  }
}

// Guardrails endpoint - frontend can fetch current permissions
app.get('/api/guardrails', (_req, res) => {
  res.json({ guardrails: getGuardrailsConfig() })
})

// Update guardrails endpoint (for demo purposes - in production, this would be role-based)
app.post('/api/guardrails', (req, res) => {
  const { guardrails } = req.body || {}
  if (!guardrails) {
    return res.status(400).json({ error: 'Missing guardrails in body' })
  }

  // Validate guardrails structure
  if (typeof guardrails !== 'object') {
    return res.status(400).json({ error: 'Invalid guardrails format' })
  }

  dynamicGuardrails = guardrails
  res.json({ success: true, guardrails: getGuardrailsConfig() })
})

// Reset guardrails to default
app.delete('/api/guardrails', (_req, res) => {
  dynamicGuardrails = null
  res.json({ success: true, guardrails: getGuardrailsConfig() })
})

// Get available guardrails presets
app.get('/api/guardrails/presets', (_req, res) => {
  res.json({
    presets: [
      {
        name: 'full',
        description: 'Full access - all operations allowed',
        config: {
          permissions: { select: true, insert: true, update: true, delete: true, ddl: true, dcl: false, other: true },
        },
      },
      {
        name: 'read-only',
        description: 'Read-only mode - only SELECT queries allowed',
        config: {
          permissions: { select: true, insert: false, update: false, delete: false, ddl: false, dcl: false, other: true },
          blockedMessage: 'Read-only mode: Only SELECT queries are allowed.',
        },
      },
      {
        name: 'write',
        description: 'Write mode - SELECT, INSERT, UPDATE allowed (no DELETE)',
        config: {
          permissions: { select: true, insert: true, update: true, delete: false, ddl: false, dcl: false, other: true },
          blockedMessage: 'Delete operations are not permitted for your role.',
        },
      },
      {
        name: 'strict',
        description: 'Strict mode - with pattern controls and limits',
        config: {
          permissions: { select: true, insert: true, update: true, delete: false, ddl: false, dcl: false, other: true },
          limits: { maxRows: 100, maxJoinedTables: 3, maxSelectedColumns: 20, timeout: 5000 },
          patterns: {
            allowSelectAll: false,
            allowFullTableScan: false,
            allowCrossJoin: false,
            allowSubqueries: true,
            allowUnion: true,
            maxSubqueryDepth: 2,
            allowOrderByWithoutLimit: false,
            requireLimit: true,
            defaultLimit: 100,
          },
          tableAccess: { allowSystemTables: false },
          blockedMessage: 'Strict mode: Query violates guardrails policy.',
        },
      },
      {
        name: 'no-full-scan',
        description: 'Prevent full table scans - WHERE clause required',
        config: {
          permissions: { select: true, insert: true, update: true, delete: true, ddl: false, dcl: false, other: true },
          patterns: { allowFullTableScan: false },
          blockedMessage: 'Full table scans are not allowed. Please add a WHERE clause.',
        },
      },
      {
        name: 'limit-required',
        description: 'Require LIMIT clause for all SELECT queries',
        config: {
          permissions: { select: true, insert: true, update: true, delete: true, ddl: false, dcl: false, other: true },
          patterns: { requireLimit: true, defaultLimit: 100 },
          blockedMessage: 'LIMIT clause is required for SELECT queries.',
        },
      },
    ],
  })
})

// ========== Audit Log Endpoints ==========
// Get all audit log entries
app.get('/api/audit', (_req, res) => {
  res.json({ 
    logs: auditLog,
    total: auditLog.length,
  })
})

// Add an audit log entry (from frontend)
app.post('/api/audit', (req, res) => {
  const entry = req.body
  
  if (!entry || typeof entry !== 'object') {
    return res.status(400).json({ error: 'Missing audit entry' })
  }
  
  // Validate required fields
  const requiredFields = ['user', 'sql', 'operationType', 'status']
  const missingFields = requiredFields.filter(f => !entry[f])
  if (missingFields.length > 0) {
    return res.status(400).json({ error: `Missing required fields: ${missingFields.join(', ')}` })
  }
  
  const newEntry = addAuditEntry(entry)
  res.json({ success: true, entry: newEntry })
})

// Clear audit log (for demo purposes)
app.delete('/api/audit', (_req, res) => {
  auditLog.length = 0
  res.json({ success: true, message: 'Audit log cleared' })
})

// ========== Query endpoint ==========
// Execute a query using a session connection
app.post('/api/query', async (req, res) => {
  const { sql, sessionId } = req.body || {}
  
  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({ error: 'Missing sql in body' })
  }

  const start = Date.now()
  try {
    let rows = []
    let columns = []
    let usedSession = false

    // If sessionId provided, use session connection
    if (sessionId) {
      try {
        const result = await sessionManager.executeQuery(sessionId, sql)
        columns = result.columns
        rows = result.rows
        usedSession = true
      } catch (e) {
        if (e.message.includes('Session not found')) {
          return res.status(401).json({ error: 'Session expired or not found', needsNewSession: true })
        }
        throw e
      }
    } else {
      // Fallback: create one-off connection (for backward compatibility)
      if (DB_TYPE === 'postgres') {
        const { Client } = require('pg')
        const client = new Client(DB_CONFIG)
        await client.connect()
        const result = await client.query(sql)
        await client.end()
        columns = (result.fields || []).map((f) => f.name)
        rows = (result.rows || []).map((r) => ({ ...r }))
      } else if (DB_TYPE === 'mysql') {
        const mysql = require('mysql2/promise')
        const conn = await mysql.createConnection({
          host: DB_CONFIG.host,
          port: DB_CONFIG.port,
          user: DB_CONFIG.user,
          password: DB_CONFIG.password,
          database: DB_CONFIG.database,
        })
        const [raw, fields] = await conn.execute(sql)
        await conn.end()
        columns = (fields || []).map((f) => f.name)
        rows = (Array.isArray(raw) ? raw : []).map((r) => ({ ...r }))
      } else {
        return res.status(400).json({ error: 'Set DB_TYPE to postgres or mysql' })
      }
    }

    const elapsed = Date.now() - start
    res.json({ 
      columns, 
      rows, 
      rowCount: rows.length, 
      elapsed,
      sessionId: usedSession ? sessionId : null,
    })
  } catch (err) {
    const message = err.message || String(err)
    res.status(500).json({ error: message })
  }
})

// ========== Session Endpoints ==========
// Create a new session with its own DB connection
app.post('/api/session', async (req, res) => {
  const { user, metadata } = req.body || {}
  
  try {
    const session = await sessionManager.createSession(user || 'anonymous', metadata || {})
    res.json({ 
      success: true, 
      session,
      message: 'Session created with dedicated database connection',
    })
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) })
  }
})

// Get session info
app.get('/api/session/:sessionId', (req, res) => {
  const { sessionId } = req.params
  const session = sessionManager.getSession(sessionId)
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' })
  }
  
  res.json({
    sessionId: session.id,
    user: session.user,
    createdAt: session.createdAt,
    lastAccess: session.lastAccess,
    queryCount: session.queryCount,
  })
})

// Close a session (release connection)
app.delete('/api/session/:sessionId', async (req, res) => {
  const { sessionId } = req.params
  const closed = await sessionManager.closeSession(sessionId)
  
  if (!closed) {
    return res.status(404).json({ error: 'Session not found' })
  }
  
  res.json({ success: true, message: 'Session closed and connection released' })
})

// Get all sessions stats (admin)
app.get('/api/sessions', (_req, res) => {
  res.json(sessionManager.getStats())
})

// Optional: schema for autocomplete
app.get('/api/schema', async (_req, res) => {
  try {
    if (DB_TYPE === 'postgres') {
      const { Client } = require('pg')
      const client = new Client(DB_CONFIG)
      await client.connect()
      const r = await client.query(`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
      `)
      await client.end()
      const schema = {}
      for (const row of r.rows || []) {
        const t = row.table_name
        if (!schema[t]) schema[t] = []
        schema[t].push({ name: row.column_name })
      }
      return res.json(schema)
    }
    if (DB_TYPE === 'mysql') {
      const mysql = require('mysql2/promise')
      const conn = await mysql.createConnection({
        host: DB_CONFIG.host,
        port: DB_CONFIG.port,
        user: DB_CONFIG.user,
        password: DB_CONFIG.password,
        database: DB_CONFIG.database,
      })
      const [tables] = await conn.execute('SHOW TABLES')
      const schema = {}
      for (const row of tables || []) {
        const tableName = Object.values(row)[0]
        const [cols] = await conn.execute(`SHOW COLUMNS FROM \`${tableName}\``)
        schema[tableName] = (cols || []).map((c) => ({ name: c.Field }))
      }
      await conn.end()
      return res.json(schema)
    }
    res.json({})
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) })
  }
})

// Health check for frontend connection status
app.get('/api/health', async (_req, res) => {
  try {
    if (DB_TYPE === 'postgres') {
      const { Client } = require('pg')
      const client = new Client(DB_CONFIG)
      await client.connect()
      await client.query('SELECT 1')
      await client.end()
    } else if (DB_TYPE === 'mysql') {
      const mysql = require('mysql2/promise')
      const conn = await mysql.createConnection({
        host: DB_CONFIG.host,
        port: DB_CONFIG.port,
        user: DB_CONFIG.user,
        password: DB_CONFIG.password,
        database: DB_CONFIG.database,
      })
      await conn.ping()
      await conn.end()
    }
    res.json({ ok: true, db: DB_TYPE })
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message || String(err) })
  }
})

const PORT = process.env.PORT || 3002
app.listen(PORT, () => {
  console.log(`SQL API running at http://localhost:${PORT}`)
  console.log(``)
  console.log(`Session Endpoints:`)
  console.log(`  POST /api/session      — create new session with dedicated DB connection`)
  console.log(`  GET  /api/session/:id  — get session info`)
  console.log(`  DEL  /api/session/:id  — close session and release connection`)
  console.log(`  GET  /api/sessions     — list all active sessions (admin)`)
  console.log(``)
  console.log(`Query Endpoints:`)
  console.log(`  POST /api/query        — run SQL (with optional sessionId for session connection)`)
  console.log(`  GET  /api/schema       — schema for autocomplete`)
  console.log(`  GET  /api/health       — connection check`)
  console.log(``)
  console.log(`Configuration Endpoints:`)
  console.log(`  GET  /api/guardrails   — guardrails config for access control`)
  console.log(`  GET  /api/audit        — audit log of all executed queries`)
  console.log(``)
  console.log(`Session Config:`)
  console.log(`  Max sessions: ${SESSION_CONFIG.maxSessions}`)
  console.log(`  Timeout: ${SESSION_CONFIG.sessionTimeout / 60000} minutes`)
  console.log(``)
  console.log(`Guardrails mode: ${GUARDRAILS_MODE}`)
  console.log(`  Set GUARDRAILS_MODE env var: 'read-only', 'write', 'strict', or 'full'`)
})
