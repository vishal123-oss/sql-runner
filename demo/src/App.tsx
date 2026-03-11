import { useState, useCallback, useEffect, useRef } from 'react'
import { useSqlEditor, SqlResults } from '@vsql/react'
import { configureSqlJsWasm } from '@vsql/core'
import type { SqlDialect, ThemePreset } from '@vsql/core'
import { USE_REMOTE_DB, API_BASE_URL } from './db/config'
import { remoteDbAdapter } from './db/remoteAdapter'

if (!USE_REMOTE_DB) configureSqlJsWasm('/sql-wasm.wasm')

const SAMPLE_SCHEMA = {
  users: [
    { name: 'id', type: 'INTEGER' },
    { name: 'name', type: 'TEXT' },
    { name: 'email', type: 'TEXT' },
    { name: 'age', type: 'INTEGER' },
    { name: 'city', type: 'TEXT' },
  ],
  orders: [
    { name: 'id', type: 'INTEGER' },
    { name: 'user_id', type: 'INTEGER' },
    { name: 'product', type: 'TEXT' },
    { name: 'amount', type: 'REAL' },
    { name: 'status', type: 'TEXT' },
  ],
  products: [
    { name: 'id', type: 'INTEGER' },
    { name: 'name', type: 'TEXT' },
    { name: 'price', type: 'REAL' },
    { name: 'category', type: 'TEXT' },
  ],
}

const SAMPLE_QUERIES = [
  'SELECT * FROM users;',
  'SELECT u.name, o.product, o.amount FROM users u JOIN orders o ON u.id = o.user_id;',
  "SELECT city, COUNT(*) as total, AVG(age) as avg_age FROM users GROUP BY city HAVING total > 1;",
  "SELECT * FROM products WHERE price > 20 ORDER BY price DESC;",
]

type ConnectionStatus = 'checking' | 'connected' | 'error' | null

export function App() {
  const [dialect, setDialect] = useState<SqlDialect>(USE_REMOTE_DB ? 'postgresql' : 'sqlite')
  const [theme, setTheme] = useState<ThemePreset>('light')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [dataLoaded, setDataLoaded] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(USE_REMOTE_DB ? 'checking' : null)
  const [connectionError, setConnectionError] = useState<string | null>(null)

  const {
    containerRef,
    editor,
    errors,
    results,
    isRunning,
    run,
    setSql,
    setDialect: changeDialect,
    setTheme: changeTheme,
  } = useSqlEditor({
    dialect,
    schema: SAMPLE_SCHEMA,
    theme,
    executor: USE_REMOTE_DB ? remoteDbAdapter : 'local',
    placeholder: 'Write your SQL query here... (Ctrl+Enter to run)',
    value: 'SELECT * FROM users;',
    minHeight: 180,
    maxHeight: 400,
    validateDelay: 300,
  })

  const seedDone = useRef(false)

  // When using remote DB: check API health and enable Run Query
  useEffect(() => {
    if (!USE_REMOTE_DB) return
    setDataLoaded(true)
    const url = `${API_BASE_URL.replace(/\/$/, '')}/api/health`
    fetch(url)
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (data?.ok) {
          setConnectionStatus('connected')
          setConnectionError(null)
        } else {
          setConnectionStatus('error')
          setConnectionError(data?.error || 'Connection failed')
        }
      })
      .catch((err) => {
        setConnectionStatus('error')
        setConnectionError(err?.message || 'Cannot reach server. Start it with: pnpm run server')
      })
  }, [])

  // Load real schema from API when using remote DB and editor is ready
  useEffect(() => {
    if (!USE_REMOTE_DB || !editor || !remoteDbAdapter.getSchema) return
    remoteDbAdapter
      .getSchema()
      .then((schema) => {
        if (schema && typeof schema === 'object' && Object.keys(schema).length > 0) {
          editor.setSchema(schema)
        }
      })
      .catch(() => { /* keep default schema on error */ })
  }, [editor])

  useEffect(() => {
    if (USE_REMOTE_DB || !editor || seedDone.current) return
    seedDone.current = true

    ;(async () => {
      try {
        await editor.execRaw(`
          CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, age INTEGER, city TEXT);
          CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, user_id INTEGER, product TEXT, amount REAL, status TEXT);
          CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT, price REAL, category TEXT);
        `)
        // Generate 100 users
        const firstNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack', 'Kate', 'Liam', 'Mia', 'Noah', 'Olivia', 'Peter', 'Quinn', 'Ruby', 'Sam', 'Tina', 'Uma', 'Victor', 'Wendy', 'Xavier', 'Yara', 'Zack']
        const cities = ['New York', 'San Francisco', 'Chicago', 'Los Angeles', 'Houston', 'Phoenix', 'Seattle', 'Denver', 'Boston', 'Miami']
        const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'example.com', 'mail.com']

        let usersInsert = ''
        for (let i = 1; i <= 100; i++) {
          const name = firstNames[i % firstNames.length] + (i > 26 ? i : '')
          const email = `user${i}@${domains[i % domains.length]}`
          const age = 20 + (i % 50)
          const city = cities[i % cities.length]
          usersInsert += `INSERT OR IGNORE INTO users VALUES (${i}, '${name}', '${email}', ${age}, '${city}');\n`
        }
        await editor.execRaw(usersInsert)
        // Generate 100 orders
        const products = ['Laptop', 'Phone', 'Tablet', 'Monitor', 'Keyboard', 'Mouse', 'Headphones', 'Webcam', 'Speaker', 'Charger', 'Cable', 'Case', 'Stand', 'Dock', 'Printer']
        const statuses = ['completed', 'pending', 'shipped', 'cancelled', 'processing']

        let ordersInsert = ''
        for (let i = 1; i <= 100; i++) {
          const userId = (i % 100) + 1
          const product = products[i % products.length]
          const amount = (19.99 + (i * 7.5)).toFixed(2)
          const status = statuses[i % statuses.length]
          ordersInsert += `INSERT OR IGNORE INTO orders VALUES (${i}, ${userId}, '${product}', ${amount}, '${status}');\n`
        }
        await editor.execRaw(ordersInsert)
        // Generate 100 products
        const productNames = ['Laptop', 'Phone', 'Tablet', 'Monitor', 'Keyboard', 'Mouse', 'Headphones', 'Webcam', 'Speaker', 'Charger', 'Cable', 'Case', 'Stand', 'Dock', 'Printer', 'Scanner', 'Router', 'SSD', 'RAM', 'GPU']
        const categories = ['Electronics', 'Accessories', 'Audio', 'Storage', 'Networking', 'Peripherals']

        let productsInsert = ''
        for (let i = 1; i <= 100; i++) {
          const name = productNames[i % productNames.length] + (i > 20 ? ` Pro ${Math.floor(i / 20)}` : '')
          const price = (29.99 + (i * 4.99)).toFixed(2)
          const category = categories[i % categories.length]
          productsInsert += `INSERT OR IGNORE INTO products VALUES (${i}, '${name}', ${price}, '${category}');\n`
        }
        await editor.execRaw(productsInsert)
        setDataLoaded(true)
        setStatusMessage('Sample data loaded. Click Run Query!')
        setTimeout(() => setStatusMessage(null), 3000)
      } catch (e: any) {
        setStatusMessage('Error loading data: ' + e.message)
      }
    })()
  }, [editor])

  const handleRun = useCallback(async () => {
    setStatusMessage(null)
    try {
      const result = await run()
      if (!result) {
        setStatusMessage('Query returned no data.')
      }
    } catch (e: any) {
      setStatusMessage('Execution error: ' + (e?.message || String(e)))
    }
  }, [run])

  const handleDialectChange = (d: SqlDialect) => {
    setDialect(d)
    changeDialect(d)
  }

  const handleThemeChange = (t: ThemePreset) => {
    setTheme(t)
    changeTheme(t)
  }

  const handleExport = useCallback(() => {
    if (!results) {
      setStatusMessage('No results to export. Run a query first.')
      setTimeout(() => setStatusMessage(null), 3000)
      return
    }

    const success = exportToCSV(results)
    if (success) {
      const rowCount = results.rows?.length || 0
      setStatusMessage(`Successfully exported ${rowCount} rows to CSV!`)
      setTimeout(() => setStatusMessage(null), 3000)
    } else {
      setStatusMessage('Failed to export. No data available.')
      setTimeout(() => setStatusMessage(null), 3000)
    }
  }, [results])

  const isDark = theme === 'dark'

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: isDark ? '#0f1117' : '#f8f9fb',
      color: isDark ? '#e4e5e7' : '#1e1e1e',
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      transition: 'background-color 0.2s, color 0.2s',
    }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{
            fontSize: 28, fontWeight: 700, margin: '0 0 4px 0', letterSpacing: '-0.5px',
          }}>
            <span style={{ color: isDark ? '#60a5fa' : '#2563eb' }}>@vsql</span> SQL Runner
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: isDark ? '#6b7280' : '#9ca3af' }}>
            Write, validate, and run SQL queries in the browser
          </p>
        </div>

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <select
            value={dialect}
            onChange={(e) => handleDialectChange(e.target.value as SqlDialect)}
            style={selectStyle(isDark)}
          >
            <option value="sqlite">SQLite</option>
            <option value="mysql">MySQL</option>
            <option value="postgresql">PostgreSQL</option>
            <option value="mssql">MSSQL</option>
            <option value="mariadb">MariaDB</option>
            <option value="standard">Standard SQL</option>
          </select>

          <button onClick={() => handleThemeChange(isDark ? 'light' : 'dark')} style={btnStyle(isDark, false)}>
            {isDark ? 'Light Mode' : 'Dark Mode'}
          </button>

          <div style={{ flex: 1 }} />

          {USE_REMOTE_DB && connectionStatus === 'checking' && (
            <span style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af' }}>
              Connecting...
            </span>
          )}
          {USE_REMOTE_DB && connectionStatus === 'connected' && (
            <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, color: isDark ? '#34d399' : '#059669' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'currentColor' }} />
              Connected to database
            </span>
          )}
          {USE_REMOTE_DB && connectionStatus === 'error' && (
            <span style={{ fontSize: 12, color: isDark ? '#f87171' : '#dc2626' }} title={connectionError || ''}>
              Offline — {connectionError || 'Cannot reach server'}
            </span>
          )}

          {!dataLoaded && !USE_REMOTE_DB && (
            <span style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af' }}>
              Loading database...
            </span>
          )}

          <button
            onClick={handleRun}
            disabled={isRunning || !dataLoaded}
            style={{
              ...btnStyle(isDark, true),
              opacity: (isRunning || !dataLoaded) ? 0.6 : 1,
              minWidth: 120,
            }}
          >
            {isRunning ? 'Running...' : 'Run Query'}
          </button>

          <button
            onClick={handleExport}
            disabled={!results || !results.rows || results.rows.length === 0}
            style={{
              ...btnStyle(isDark, false),
              opacity: (!results || !results.rows || results.rows.length === 0) ? 0.6 : 1,
              backgroundColor: isDark ? '#1e3a5f' : '#eff6ff',
              color: isDark ? '#60a5fa' : '#2563eb',
              border: `1px solid ${isDark ? '#1e3a5f' : '#bfdbfe'}`,
            }}
          >
            Export CSV
          </button>
        </div>

        {/* Editor */}
        <div
          ref={containerRef}
          style={{
            borderRadius: 10,
            overflow: 'hidden',
            border: `1px solid ${isDark ? '#1f2937' : '#e5e7eb'}`,
            boxShadow: isDark ? '0 4px 24px rgba(0,0,0,.4)' : '0 4px 24px rgba(0,0,0,.06)',
          }}
        />

        {/* Sample queries */}
        <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af', lineHeight: '28px' }}>Try:</span>
          {SAMPLE_QUERIES.map((q, i) => (
            <button
              key={i}
              onClick={() => setSql(q)}
              style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 6,
                border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                backgroundColor: isDark ? '#1f2937' : '#fff',
                color: isDark ? '#d1d5db' : '#4b5563',
                cursor: 'pointer', whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220,
              }}
              title={q}
            >
              {q.length > 40 ? q.slice(0, 40) + '...' : q}
            </button>
          ))}
        </div>

        {/* Status / errors */}
        {statusMessage && (
          <div style={{
            marginTop: 12, padding: '8px 14px', borderRadius: 8, fontSize: 13,
            backgroundColor: isDark ? '#1e3a5f' : '#eff6ff',
            color: isDark ? '#60a5fa' : '#2563eb',
            border: `1px solid ${isDark ? '#1e3a5f' : '#bfdbfe'}`,
          }}>
            {statusMessage}
          </div>
        )}

        {errors.length > 0 && (
          <div style={{
            marginTop: 12, padding: '10px 14px', borderRadius: 8,
            backgroundColor: isDark ? '#1c1017' : '#fef2f2',
            border: `1px solid ${isDark ? '#7f1d1d' : '#fecaca'}`,
          }}>
            {errors.map((e, i) => (
              <p key={i} style={{
                margin: i > 0 ? '4px 0 0' : 0, fontSize: 13,
                color: isDark ? '#f87171' : '#dc2626',
              }}>
                <strong>Line {e.line + 1}:</strong> {e.message}
              </p>
            ))}
          </div>
        )}

        {/* Results */}
        <div style={{
          marginTop: 16, borderRadius: 10, overflow: 'hidden',
          border: `1px solid ${isDark ? '#1f2937' : '#e5e7eb'}`,
          backgroundColor: isDark ? '#111318' : '#fff',
          boxShadow: isDark ? '0 2px 12px rgba(0,0,0,.3)' : '0 2px 12px rgba(0,0,0,.04)',
        }}>
          <SqlResults
            data={results}
            maxHeight={350}
            showRowCount
            showElapsed
            emptyMessage="Click 'Run Query' to see results"
            style={{
              ...(isDark ? {
                '--vsql-border': '#1f2937', '--vsql-muted': '#6b7280',
                '--vsql-badge-bg': '#1e3a5f', '--vsql-badge-fg': '#60a5fa',
                '--vsql-th-bg': '#151921', '--vsql-th-fg': '#9ca3af',
                '--vsql-row-alt': '#0d0f14',
              } as any : {}),
            }}
          />
        </div>

        {/* Schema info */}
        <div style={{
          marginTop: 24, padding: 16, borderRadius: 10,
          border: `1px solid ${isDark ? '#1f2937' : '#e5e7eb'}`,
          backgroundColor: isDark ? '#111318' : '#fff',
        }}>
          <h3 style={{
            margin: '0 0 12px', fontSize: 14, fontWeight: 600,
            color: isDark ? '#9ca3af' : '#6b7280',
            textTransform: 'uppercase', letterSpacing: '0.5px',
          }}>
            Database Schema
          </h3>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {Object.entries(SAMPLE_SCHEMA).map(([table, cols]) => (
              <div key={table}>
                <h4 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 600, color: isDark ? '#60a5fa' : '#2563eb' }}>
                  {table}
                </h4>
                <div style={{ fontSize: 13 }}>
                  {cols.map((c, i) => (
                    <div key={i} style={{ padding: '2px 0', color: isDark ? '#d1d5db' : '#4b5563' }}>
                      <span style={{ fontFamily: 'monospace' }}>{c.name}</span>
                      <span style={{ marginLeft: 6, fontSize: 11, color: isDark ? '#6b7280' : '#9ca3af' }}>{c.type}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <p style={{ marginTop: 32, textAlign: 'center', fontSize: 12, color: isDark ? '#4b5563' : '#9ca3af' }}>
          @vsql/core + @vsql/react | CodeMirror 6 + sql.js + node-sql-parser
        </p>
      </div>
    </div>
  )
}

function selectStyle(isDark: boolean): React.CSSProperties {
  return {
    fontSize: 13, padding: '6px 12px', borderRadius: 8,
    border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
    backgroundColor: isDark ? '#1f2937' : '#fff',
    color: isDark ? '#e4e5e7' : '#1e1e1e',
    cursor: 'pointer', outline: 'none',
  }
}

function btnStyle(isDark: boolean, primary: boolean): React.CSSProperties {
  if (primary) {
    return {
      fontSize: 13, fontWeight: 600, padding: '8px 18px', borderRadius: 8,
      border: 'none', backgroundColor: '#2563eb', color: '#fff', cursor: 'pointer',
    }
  }
  return {
    fontSize: 13, padding: '6px 14px', borderRadius: 8,
    border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
    backgroundColor: isDark ? '#1f2937' : '#fff',
    color: isDark ? '#d1d5db' : '#4b5563',
    cursor: 'pointer',
  }
}

// Helper function to export query results to CSV
function exportToCSV(results: any): boolean {
  if (!results || !results.columns || !results.rows) {
    return false
  }

  const headers = results.columns.map((col: any) => col.name || col)
  const csvRows: string[] = []

  // Add header row
  csvRows.push(headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(','))

  // Add data rows
  for (const row of results.rows) {
    const values = row.map((val: any) => {
      if (val === null || val === undefined) return ''
      const str = String(val)
      return `"${str.replace(/"/g, '""')}"`
    })
    csvRows.push(values.join(','))
  }

  const csvContent = csvRows.join('\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `query-results-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)

  return true
}
