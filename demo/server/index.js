/**
 * Example backend: put your DATABASE CREDENTIALS here (or in .env).
 * This server runs SQL and returns results; the frontend never sees credentials.
 *
 * 1. Copy server/.env.example to server/.env and set DB_* values.
 * 2. cd server && npm install && npm start
 */

require('dotenv').config()
const express = require('express')
const cors = require('cors')

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

// ========== Query endpoint ==========
app.post('/api/query', async (req, res) => {
  const { sql } = req.body || {}
  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({ error: 'Missing sql in body' })
  }

  const start = Date.now()
  try {
    let rows = []
    let columns = []

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

    const elapsed = Date.now() - start
    res.json({ columns, rows, rowCount: rows.length, elapsed })
  } catch (err) {
    const message = err.message || String(err)
    res.status(500).json({ error: message })
  }
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
