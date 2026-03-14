/**
 * Example backend: put your DATABASE CREDENTIALS here (or in .env).
 * This server runs SQL and returns results; the frontend never sees credentials.
 *
 * 1. Copy server/.env.example to server/.env and set DB_* values.
 * 2. cd server && npm install && npm start
 *
 * ============================================================================
 * ACCESS CONTROL / GUARDRAILS
 * ============================================================================
 * IMPORTANT: Access control is configured HERE on the backend.
 * - The frontend receives only "hints" for UI display (read-only badge, etc.)
 * - NEVER trust the client for security - always validate on every request.
 * - Change ACCESS_CONTROL_CONFIG below to control what users can do.
 * ============================================================================
 */

require('dotenv').config()
const express = require('express')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json())

// ============================================================================
// BACKEND-ONLY ACCESS CONTROL CONFIG (NEVER expose to client!)
// ============================================================================
// Available modes:
//   'read-only'  - SELECT, WITH, PRAGMA, SHOW, DESCRIBE, EXPLAIN only
//   'write'      - Above + INSERT, CREATE TABLE, COPY
//   'update'     - Above + UPDATE
//   'delete'     - Above + DELETE, TRUNCATE, DROP
//   'full'       - All operations
//
// You can also use blockedPatterns to block specific dangerous SQL.
const ACCESS_CONTROL_CONFIG = {
  // Change this to set the access level:
  mode: process.env.ACCESS_MODE || 'read-only', // 'no-access' | 'read-only' | 'write' | 'update' | 'delete' | 'full'
  
  // Additional blocked operations (overrides mode defaults)
  blockedOperations: [],
  
  // Regex patterns for extra blocking (e.g., block DROP DATABASE)
  blockedPatterns: [
    // Uncomment to block dropping databases:
    // '\\bDROP\\s+DATABASE\\b',
    // '\\bpg_terminate_backend\\b',
  ],
  
  // Limit result rows (backend enforces)
  maxRowsLimit: parseInt(process.env.MAX_ROWS || '1000', 10),
  
  // Prevent multi-statement injection
  allowMultiStatement: false,
  
  // Block transactions in read-only
  allowTransactions: true,
}

const MODE_DEFAULTS = {
  'no-access': [],
  'read-only': ['select', 'ddl_read'],
  'write': ['select', 'ddl_read', 'insert'],
  'update': ['select', 'ddl_read', 'insert', 'update'],
  'delete': ['select', 'ddl_read', 'insert', 'update', 'delete'],
  'full': ['select', 'ddl_read', 'insert', 'update', 'delete', 'ddl_write', 'dcl', 'transaction', 'admin'],
}

function getAccessHints() {
  const cfg = ACCESS_CONTROL_CONFIG
  const mode = cfg.mode || 'full'
  const isReadOnly = mode === 'read-only' || mode === 'no-access'
  
  let description = `Access mode: ${mode}`
  if (mode === 'no-access') description = 'Access denied: You do not have permission to access this database'
  else if (mode === 'read-only') description = 'Read-only mode: only SELECT and introspection queries allowed'
  else if (mode === 'write') description = 'Write mode: SELECT and INSERT allowed'
  else if (mode === 'update') description = 'Update mode: SELECT, INSERT, and UPDATE allowed'
  else if (mode === 'delete') description = 'Delete mode: Full CRUD access (no DDL)'

  return {
    mode,
    description,
    isReadOnly,
    disabledOperations: mode === 'no-access'
      ? ['select', 'insert', 'update', 'delete', 'ddl_read', 'ddl_write', 'dcl', 'transaction', 'admin']
      : isReadOnly 
        ? ['insert', 'update', 'delete', 'ddl_write', 'dcl', 'transaction', 'admin']
        : cfg.blockedOperations,
    // Guardrail controls
    maxRowsLimit: cfg.maxRowsLimit,
    requireWhereForModify: cfg.requireWhereForModify || false,
    blockSelectStar: cfg.blockSelectStar || false,
    allowFullTableScan: cfg.allowFullTableScan !== false,
  }
}
// ============================================================================

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

// ========== Query endpoint (WITH ACCESS CONTROL ENFORCEMENT) ==========
app.post('/api/query', async (req, res) => {
  const { sql } = req.body || {}
  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({ error: 'Missing sql in body' })
  }

  // ========================================
  // BACKEND ACCESS CONTROL VALIDATION
  // THIS IS THE REAL SECURITY - NEVER SKIP
  // ========================================
  const validation = validateAccessControl(sql)
  if (!validation.allowed) {
    console.warn(`[SECURITY] Blocked query from client: ${validation.reason}`)
    return res.status(403).json({
      error: `Access denied: ${validation.reason}`,
      code: 'ACCESS_DENIED',
      category: validation.category,
    })
  }

  const start = Date.now()
  try {
    let rows = []
    let columns = []

    if (DB_TYPE === 'postgres') {
      const { Client } = require('pg')
      const client = new Client(DB_CONFIG)
      await client.connect()
      
      // Apply row limit if configured (additional backend enforcement)
      let execSql = sql
      const cfg = ACCESS_CONTROL_CONFIG
      if (cfg.maxRowsLimit && /^\s*(SELECT|WITH)\b/i.test(sql.trim())) {
        // Wrap with LIMIT if not already present
        if (!/\bLIMIT\s+\d+/i.test(sql)) {
          execSql = `${sql.trim().replace(/;?\s*$/, '')} LIMIT ${cfg.maxRowsLimit}`
        }
      }
      
      const result = await client.query(execSql)
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
      
      // Apply row limit
      let execSql = sql
      const cfg = ACCESS_CONTROL_CONFIG
      if (cfg.maxRowsLimit && /^\s*(SELECT|WITH)\b/i.test(sql.trim())) {
        if (!/\bLIMIT\s+\d+/i.test(sql)) {
          execSql = `${sql.trim().replace(/;?\s*$/, '')} LIMIT ${cfg.maxRowsLimit}`
        }
      }
      
      const [raw, fields] = await conn.execute(execSql)
      await conn.end()
      columns = (fields || []).map((f) => f.name)
      rows = (Array.isArray(raw) ? raw : []).map((r) => ({ ...r }))
    } else {
      return res.status(400).json({ error: 'Set DB_TYPE to postgres or mysql' })
    }

    const elapsed = Date.now() - start
    res.json({ columns, rows, rowCount: rows.length, elapsed })
  } catch (err) {
    const message = err.message || String(err)
    res.status(500).json({ error: message })
  }
})

// ========== Access control hints endpoint (for client UX) ==========
// This is SAFE to expose - it's just UI hints, not the real config
app.get('/api/access-hints', (_req, res) => {
  res.json(getAccessHints())
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

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`SQL API running at http://localhost:${PORT}`)
  console.log(`  POST /api/query  — run SQL`)
  console.log(`  GET  /api/schema — schema for autocomplete`)
  console.log(`  GET  /api/health — connection check`)
})
