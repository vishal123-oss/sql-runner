import { useState, useCallback, useEffect, useRef } from 'react'
import { useSqlEditor, SqlResults } from '@vsql/react'
import {
  configureSqlJsWasm,
  type SqlDialect,
  type ThemePreset,
  type AccessControlHints,
  type AccessMode,
  type AccessControlConfig
} from '@vsql/core'
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
  'SELECT id, name, email FROM users LIMIT 10;',
  'SELECT u.name, o.product, o.amount FROM users u JOIN orders o ON u.id = o.user_id WHERE o.status = "completed";',
  'INSERT INTO users (name, email, age, city) VALUES ("New User", "new@example.com", 25, "London");',
  'UPDATE users SET age = 31 WHERE name = "Alice";',
  'ALTER TABLE products ADD COLUMN stock INTEGER DEFAULT 0;',
  'SELECT city, COUNT(*) as total FROM users GROUP BY city HAVING total > 1;',
]

type ConnectionStatus = 'checking' | 'connected' | 'error' | null

export function App() {
  const [dialect, setDialect] = useState<SqlDialect>(USE_REMOTE_DB ? 'postgresql' : 'sqlite')
  const [theme, setTheme] = useState<ThemePreset>('light')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [dataLoaded, setDataLoaded] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(USE_REMOTE_DB ? 'checking' : null)
  const [activeConnection, setActiveConnection] = useState<string>('default')
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [accessHints, setAccessHints] = useState<AccessControlHints | null>(null)
  const [showGuardrails, setShowGuardrails] = useState(false)
  const [showAuditLogs, setShowAuditLogs] = useState(false)
  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [userName, setUserName] = useState(localStorage.getItem('vsql_user') || 'Admin')
  // Local audit logs storage for local-only mode
  const localAuditLogsRef = useRef<any[]>([])
  const [paginationVariant, setPaginationVariant] = useState<'simple' | 'full' | 'compact'>('full')
  const [pageSize, setPageSize] = useState(10)
  const [localGuardrails, setLocalGuardrails] = useState<AccessControlConfig>({
    mode: 'full',
    maxRowsLimit: 1000,
    blockSelectStar: false,
    requireWhereForModify: false,
    allowFullTableScan: true,
  })

  useEffect(() => {
    localStorage.setItem('vsql_user', userName)
  }, [userName])

  const fetchAuditLogs = useCallback(async () => {
    if (!USE_REMOTE_DB) {
      // For local mode, use local storage
      setAuditLogs([...localAuditLogsRef.current].slice(-100).reverse())
      return
    }
    try {
      const res = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/api/audit-logs`)
      if (res.ok) setAuditLogs(await res.json())
    } catch {}
  }, [USE_REMOTE_DB])

  const updateBackendConfig = async (updates: any) => {
    if (!USE_REMOTE_DB) {
      setLocalGuardrails(prev => {
        const newConfig = { ...prev, ...updates }
        // Regenerate access hints from new config
        import('@vsql/core').then(({ generateAccessHints }) => {
          setAccessHints(generateAccessHints(newConfig))
        })
        return newConfig
      })
      return
    }
    try {
      await fetch(`${API_BASE_URL.replace(/\/$/, '')}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })
      // Refresh hints
      const hintsRes = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/api/access-hints`)
      if (hintsRes.ok) setAccessHints(await hintsRes.json())
    } catch (e) {
      console.error('Failed to update config', e)
    }
  }


  const {
    containerRef,
    editor,
    errors,
    results,
    guardrailResult,
    isRunning,
    run,
    setSql,
    setDialect: changeDialect,
    setTheme: changeTheme,
    accessHints: hookAccessHints,
    isReadOnly,
    accessModeLabel,
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
    guardrails: localGuardrails,
  })

  // Generate initial access hints on mount for local mode
  useEffect(() => {
    if (!USE_REMOTE_DB) {
      import('@vsql/core').then(({ generateAccessHints }) => {
        setAccessHints(generateAccessHints(localGuardrails))
      })
    } else {
      remoteDbAdapter.getAccessHints?.()
        .then(hints => hints && setAccessHints(hints))
        .catch(() => {})
    }
  }, [])

  // Update remote hints when they change
  useEffect(() => {
    if (USE_REMOTE_DB && hookAccessHints) setAccessHints(hookAccessHints)
  }, [USE_REMOTE_DB, hookAccessHints])

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
        await editor.execRaw(`
          INSERT OR IGNORE INTO users VALUES (1, 'Alice', 'alice@example.com', 30, 'New York');
          INSERT OR IGNORE INTO users VALUES (2, 'Bob', 'bob@example.com', 25, 'San Francisco');
          INSERT OR IGNORE INTO users VALUES (3, 'Charlie', 'charlie@example.com', 35, 'New York');
          INSERT OR IGNORE INTO users VALUES (4, 'Diana', 'diana@example.com', 28, 'Chicago');
          INSERT OR IGNORE INTO users VALUES (5, 'Eve', 'eve@example.com', 32, 'San Francisco');
          INSERT OR IGNORE INTO users VALUES (6, 'Frank', 'frank@example.com', 45, 'New York');
          INSERT OR IGNORE INTO users VALUES (7, 'Grace', 'grace@example.com', 22, 'Chicago');
          INSERT OR IGNORE INTO users VALUES (8, 'Hank', 'hank@example.com', 38, 'San Francisco');
          INSERT OR IGNORE INTO users VALUES (9, 'Ivy', 'ivy@example.com', 29, 'New York');
          INSERT OR IGNORE INTO users VALUES (10, 'Jack', 'jack@example.com', 31, 'Chicago');
          INSERT OR IGNORE INTO users VALUES (11, 'Kelly', 'kelly@example.com', 27, 'San Francisco');
          INSERT OR IGNORE INTO users VALUES (12, 'Leo', 'leo@example.com', 40, 'New York');
          INSERT OR IGNORE INTO users VALUES (13, 'Mona', 'mona@example.com', 33, 'Chicago');
          INSERT OR IGNORE INTO users VALUES (14, 'Nate', 'nate@example.com', 26, 'San Francisco');
          INSERT OR IGNORE INTO users VALUES (15, 'Olive', 'olive@example.com', 34, 'New York');
          INSERT OR IGNORE INTO users VALUES (16, 'Paul', 'paul@example.com', 36, 'Chicago');
          INSERT OR IGNORE INTO users VALUES (17, 'Quinn', 'quinn@example.com', 24, 'San Francisco');
          INSERT OR IGNORE INTO users VALUES (18, 'Rose', 'rose@example.com', 39, 'New York');
          INSERT OR IGNORE INTO users VALUES (19, 'Sam', 'sam@example.com', 41, 'Chicago');
          INSERT OR IGNORE INTO users VALUES (20, 'Tina', 'tina@example.com', 23, 'San Francisco');
          INSERT OR IGNORE INTO users VALUES (21, 'Uma', 'uma@example.com', 30, 'New York');
          INSERT OR IGNORE INTO users VALUES (22, 'Victor', 'victor@example.com', 28, 'Chicago');
          INSERT OR IGNORE INTO users VALUES (23, 'Wendy', 'wendy@example.com', 32, 'San Francisco');
          INSERT OR IGNORE INTO users VALUES (24, 'Xander', 'xander@example.com', 35, 'New York');
          INSERT OR IGNORE INTO users VALUES (25, 'Yara', 'yara@example.com', 29, 'Chicago');
        `)
        await editor.execRaw(`
          INSERT OR IGNORE INTO orders VALUES (1, 1, 'Laptop', 999.99, 'completed');
          INSERT OR IGNORE INTO orders VALUES (2, 2, 'Phone', 699.99, 'completed');
          INSERT OR IGNORE INTO orders VALUES (3, 1, 'Tablet', 449.99, 'pending');
          INSERT OR IGNORE INTO orders VALUES (4, 3, 'Monitor', 349.99, 'completed');
          INSERT OR IGNORE INTO orders VALUES (5, 4, 'Keyboard', 79.99, 'shipped');
          INSERT OR IGNORE INTO orders VALUES (6, 2, 'Mouse', 29.99, 'completed');
        `)
        await editor.execRaw(`
          INSERT OR IGNORE INTO products VALUES (1, 'Laptop', 999.99, 'Electronics');
          INSERT OR IGNORE INTO products VALUES (2, 'Phone', 699.99, 'Electronics');
          INSERT OR IGNORE INTO products VALUES (3, 'Tablet', 449.99, 'Electronics');
          INSERT OR IGNORE INTO products VALUES (4, 'Keyboard', 79.99, 'Accessories');
          INSERT OR IGNORE INTO products VALUES (5, 'Mouse', 29.99, 'Accessories');
          INSERT OR IGNORE INTO products VALUES (6, 'Headphones', 149.99, 'Audio');
        `)
        setDataLoaded(true)
        setStatusMessage('Sample data loaded. Click Run Query!')
        setTimeout(() => setStatusMessage(null), 3000)
      } catch (e: any) {
        setStatusMessage('Error loading data: ' + e.message)
      }
    })()
  }, [editor])

  const handleRun = useCallback(async (page = 0, size = pageSize) => {
    setStatusMessage(null)
    try {
      // Always pass pagination options for consistent pagination UI
      const result = await run({ page, pageSize: size })
      if (!result) {
        setStatusMessage('Query returned no data.')
      } else if (result.columns?.length === 0 && result.rows?.length === 0) {
        // DML/DDL query succeeded
        setStatusMessage(`Query executed successfully (${result.elapsed}ms)`)
        setTimeout(() => setStatusMessage(null), 2000)
      }
      // Log to local audit for local mode
      if (!USE_REMOTE_DB && result) {
        const logEntry = {
          id: Date.now(),
          user: userName,
          sql: result.sql || editor?.getValue() || 'Unknown query',
          status: 'success',
          resultSize: result.rowCount ?? result.totalCount ?? 0,
          timestamp: new Date().toISOString(),
        }
        localAuditLogsRef.current.push(logEntry)
        if (showAuditLogs) fetchAuditLogs()
      }
    } catch (e: any) {
      setStatusMessage('Execution error: ' + (e?.message || String(e)))
      // Log error to local audit
      if (!USE_REMOTE_DB) {
        const logEntry = {
          id: Date.now(),
          user: userName,
          sql: editor?.getValue() || 'Unknown query',
          status: 'error',
          resultSize: 0,
          timestamp: new Date().toISOString(),
        }
        localAuditLogsRef.current.push(logEntry)
        if (showAuditLogs) fetchAuditLogs()
      }
    }
  }, [run, pageSize, USE_REMOTE_DB, userName, showAuditLogs, fetchAuditLogs, editor])

  const handlePageChange = (page: number, size: number) => {
    setPageSize(size)
    handleRun(page, size)
  }

  // Handle connection change
  useEffect(() => {
    if (activeConnection === 'session-2') {
      updateBackendConfig({ mode: 'read-only', blockSelectStar: true })
    } else if (activeConnection === 'user-123') {
      updateBackendConfig({ mode: 'no-access' })
    } else {
      updateBackendConfig({ mode: 'full', blockSelectStar: false, requireWhereForModify: false, allowFullTableScan: true })
    }
  }, [activeConnection])

  const handleDialectChange = (d: SqlDialect) => {
    setDialect(d)
    changeDialect(d)
  }

  const handleThemeChange = (t: ThemePreset) => {
    setTheme(t)
    changeTheme(t)
  }

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

          <select
            value={activeConnection}
            onChange={(e) => setActiveConnection(e.target.value)}
            style={selectStyle(isDark)}
            title="Active Connection"
          >
            <option value="default">Default Connection</option>
            <option value="session-1">Session 1 (Dev)</option>
            <option value="session-2">Session 2 (Prod-Read)</option>
            <option value="user-123">User 123 (Restricted)</option>
          </select>

          <input
            type="text"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="User Name"
            style={{ ...selectStyle(isDark), width: 100 }}
            title="Name used for audit logs"
          />

          <button 
            onClick={() => {
              const newState = !showAuditLogs
              setShowAuditLogs(newState)
              if (newState) fetchAuditLogs()
            }} 
            style={btnStyle(isDark, false)}
          >
            {showAuditLogs ? 'Hide Logs' : 'Audit Logs'}
          </button>


          <select
            value={paginationVariant}
            onChange={(e) => setPaginationVariant(e.target.value as any)}
            style={selectStyle(isDark)}
            title="Pagination UI Style"
          >
            <option value="full">Full Pagination</option>
            <option value="simple">Simple Pagination</option>
            <option value="compact">Compact Pagination</option>
          </select>

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
            onClick={() => handleRun()}
            disabled={
              isRunning || 
              !dataLoaded || 
              isReadOnly || 
              (guardrailResult && !guardrailResult.allowed) ||
              activeConnection === 'user-123' ||
              localGuardrails.mode === 'no-access'
            }
            style={{
              ...btnStyle(isDark, true),
              opacity: (isRunning || !dataLoaded || isReadOnly || (guardrailResult && !guardrailResult.allowed) || activeConnection === 'user-123' || localGuardrails.mode === 'no-access') ? 0.6 : 1,
              minWidth: 120,
              backgroundColor: (guardrailResult && !guardrailResult.allowed) || activeConnection === 'user-123' || localGuardrails.mode === 'no-access' ? '#ef4444' : '#2563eb',
            }}
            title={
              isReadOnly ? 'Read-only mode - cannot execute queries' : 
              activeConnection === 'user-123' ? 'User 123 is restricted - no access' :
              localGuardrails.mode === 'no-access' ? 'No access mode - queries disabled' :
              (guardrailResult && !guardrailResult.allowed) ? `Access Denied: ${guardrailResult.reason}` : ''
            }
          >
            {isRunning ? 'Running...' : activeConnection === 'user-123' || localGuardrails.mode === 'no-access' ? 'No Access' : 'Run Query'}
          </button>

          {/* Manage Access Button */}
          <button
            onClick={() => setShowGuardrails(!showGuardrails)}
            style={{
              ...btnStyle(isDark, false),
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              borderColor: accessHints?.isReadOnly ? (isDark ? '#b45309' : '#f59e0b') : (isDark ? '#3b82f6' : '#2563eb'),
              backgroundColor: accessHints?.isReadOnly ? (isDark ? '#422006' : '#fffbeb') : (isDark ? '#1e3a5f' : '#eff6ff'),
              color: accessHints?.isReadOnly ? (isDark ? '#fcd34d' : '#92400e') : (isDark ? '#60a5fa' : '#2563eb'),
            }}
            title="Manage access permissions and guardrails"
          >
            <span style={{ fontSize: 14 }}>🔐</span>
            Manage Access
            {accessHints?.mode && accessHints.mode !== 'full' && (
              <span style={{
                fontSize: 10,
                padding: '1px 5px',
                borderRadius: 3,
                backgroundColor: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.1)',
                textTransform: 'capitalize',
              }}>
                {accessHints.mode.replace('-', ' ')}
              </span>
            )}
          </button>
        </div>

        {/* Guardrails Panel - Redesigned */}
        {showGuardrails && (
          <div style={{
            marginBottom: 12,
            borderRadius: 12,
            border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
            backgroundColor: isDark ? '#1f2937' : '#ffffff',
            boxShadow: isDark ? '0 10px 40px rgba(0,0,0,0.4)' : '0 10px 40px rgba(0,0,0,0.08)',
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '14px 18px',
              borderBottom: `1px solid ${isDark ? '#374151' : '#f3f4f6'}`,
              backgroundColor: isDark ? '#111827' : '#f9fafb',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>🔐</span>
                <div>
                  <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: isDark ? '#f3f4f6' : '#111827' }}>
                    Access Control
                  </h4>
                  <p style={{ margin: 0, fontSize: 11, color: isDark ? '#6b7280' : '#9ca3af' }}>
                    Configure permissions and security guardrails
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowGuardrails(false)} 
                style={{ 
                  ...btnStyle(isDark, false), 
                  padding: '6px 12px', 
                  fontSize: 12,
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: isDark ? '#9ca3af' : '#6b7280',
                }}
              >
                ✕ Close
              </button>
            </div>

            <div style={{ padding: 18 }}>
              {/* Permission Level Selector */}
              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8, color: isDark ? '#9ca3af' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Permission Level
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
                  {[
                    { value: 'no-access', label: 'No Access', icon: '🚫', color: isDark ? '#7f1d1d' : '#fee2e2' },
                    { value: 'read-only', label: 'Read Only', icon: '👁️', color: isDark ? '#1e3a5f' : '#dbeafe' },
                    { value: 'write', label: 'Write', icon: '✏️', color: isDark ? '#064e3b' : '#d1fae5' },
                    { value: 'update', label: 'Update', icon: '🔄', color: isDark ? '#4c1d95' : '#ede9fe' },
                    { value: 'delete', label: 'Delete', icon: '🗑️', color: isDark ? '#7c2d12' : '#ffedd5' },
                    { value: 'full', label: 'Full Access', icon: '✅', color: isDark ? '#064e3b' : '#d1fae5' },
                  ].map(mode => (
                    <button
                      key={mode.value}
                      onClick={() => updateBackendConfig({ mode: mode.value })}
                      style={{
                        padding: '10px 8px',
                        borderRadius: 8,
                        border: localGuardrails.mode === mode.value 
                          ? `2px solid ${isDark ? '#3b82f6' : '#2563eb'}` 
                          : `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                        backgroundColor: localGuardrails.mode === mode.value 
                          ? (isDark ? '#1e3a5f' : '#eff6ff') 
                          : (isDark ? '#111827' : '#fff'),
                        color: isDark ? '#e5e7eb' : '#374151',
                        cursor: 'pointer',
                        textAlign: 'center',
                        fontSize: 11,
                        fontWeight: 500,
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ fontSize: 16, marginBottom: 4 }}>{mode.icon}</div>
                      <div style={{ fontSize: 10 }}>{mode.label}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Permission Matrix */}
              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8, color: isDark ? '#9ca3af' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Allowed Operations
                </label>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: 8,
                  padding: 12,
                  borderRadius: 10,
                  backgroundColor: isDark ? '#111827' : '#f9fafb',
                  border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                }}>
                  {[
                    { op: 'SELECT', desc: 'Read data', category: 'select' },
                    { op: 'INSERT', desc: 'Add rows', category: 'insert' },
                    { op: 'UPDATE', desc: 'Modify rows', category: 'update' },
                    { op: 'DELETE', desc: 'Remove rows', category: 'delete' },
                    { op: 'CREATE', desc: 'Create tables', category: 'ddl_write' },
                    { op: 'DROP', desc: 'Delete tables', category: 'ddl_write' },
                    { op: 'ALTER', desc: 'Modify schema', category: 'ddl_write' },
                    { op: 'PRAGMA', desc: 'Introspection', category: 'select' },
                  ].map(item => {
                    const isAllowed = getAllowedOps(accessHints).includes(item.category)
                    return (
                      <div
                        key={item.op}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '8px 10px',
                          borderRadius: 6,
                          backgroundColor: isAllowed 
                            ? (isDark ? '#065f46' : '#ecfdf5') 
                            : (isDark ? '#1f2937' : '#f3f4f6'),
                          border: `1px solid ${isAllowed 
                            ? (isDark ? '#059669' : '#a7f3d0') 
                            : (isDark ? '#374151' : '#e5e7eb')}`,
                        }}
                      >
                        <span style={{ fontSize: 14 }}>{isAllowed ? '✓' : '✕'}</span>
                        <div>
                          <div style={{ 
                            fontSize: 11, 
                            fontWeight: 600, 
                            fontFamily: 'monospace',
                            color: isAllowed 
                              ? (isDark ? '#34d399' : '#047857') 
                              : (isDark ? '#6b7280' : '#9ca3af'),
                          }}>
                            {item.op}
                          </div>
                          <div style={{ fontSize: 9, color: isDark ? '#6b7280' : '#9ca3af' }}>{item.desc}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Guardrail Toggles */}
              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8, color: isDark ? '#9ca3af' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Query Guardrails
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <label style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 8, 
                    padding: '8px 14px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    backgroundColor: localGuardrails.blockSelectStar ? (isDark ? '#422006' : '#fef3c7') : (isDark ? '#111827' : '#f9fafb'),
                    border: `1px solid ${localGuardrails.blockSelectStar ? (isDark ? '#b45309' : '#fcd34d') : (isDark ? '#374151' : '#e5e7eb')}`,
                    fontSize: 12,
                  }}>
                    <input
                      type="checkbox"
                      checked={localGuardrails.blockSelectStar || false}
                      onChange={(e) => updateBackendConfig({ blockSelectStar: e.target.checked })}
                      style={{ accentColor: '#2563eb' }}
                    />
                    <span>🚫 Block SELECT *</span>
                  </label>

                  <label style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 8, 
                    padding: '8px 14px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    backgroundColor: localGuardrails.requireWhereForModify ? (isDark ? '#1e3a5f' : '#dbeafe') : (isDark ? '#111827' : '#f9fafb'),
                    border: `1px solid ${localGuardrails.requireWhereForModify ? (isDark ? '#3b82f6' : '#93c5fd') : (isDark ? '#374151' : '#e5e7eb')}`,
                    fontSize: 12,
                  }}>
                    <input
                      type="checkbox"
                      checked={localGuardrails.requireWhereForModify || false}
                      onChange={(e) => updateBackendConfig({ requireWhereForModify: e.target.checked })}
                      style={{ accentColor: '#2563eb' }}
                    />
                    <span>⚠️ WHERE required</span>
                  </label>

                  <label style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 8, 
                    padding: '8px 14px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    backgroundColor: localGuardrails.allowFullTableScan === false ? (isDark ? '#422006' : '#fef3c7') : (isDark ? '#111827' : '#f9fafb'),
                    border: `1px solid ${localGuardrails.allowFullTableScan === false ? (isDark ? '#b45309' : '#fcd34d') : (isDark ? '#374151' : '#e5e7eb')}`,
                    fontSize: 12,
                  }}>
                    <input
                      type="checkbox"
                      checked={localGuardrails.allowFullTableScan === false}
                      onChange={(e) => updateBackendConfig({ allowFullTableScan: !e.target.checked })}
                      style={{ accentColor: '#2563eb' }}
                    />
                    <span>🔒 No full table scan</span>
                  </label>

                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 8, 
                    padding: '8px 14px',
                    borderRadius: 8,
                    backgroundColor: isDark ? '#111827' : '#f9fafb',
                    border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                    fontSize: 12,
                  }}>
                    <span>📊 Max rows:</span>
                    <select
                      value={localGuardrails.maxRowsLimit || 1000}
                      onChange={(e) => updateBackendConfig({ maxRowsLimit: parseInt(e.target.value) })}
                      style={{ ...selectStyle(isDark), padding: '4px 8px', fontSize: 11, width: 80 }}
                    >
                      <option value={10}>10</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={500}>500</option>
                      <option value={1000}>1000</option>
                      <option value={5000}>5000</option>
                      <option value={-1}>Unlimited</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Warning Banner */}
              {isReadOnly && (
                <div style={{
                  padding: '12px 16px',
                  borderRadius: 8,
                  backgroundColor: isDark ? '#422006' : '#fffbeb',
                  border: `1px solid ${isDark ? '#b45309' : '#fcd34d'}`,
                  color: isDark ? '#fcd34d' : '#92400e',
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}>
                  <span style={{ fontSize: 18 }}>⚠️</span>
                  <div>
                    <strong>Read-only mode active.</strong> Query execution is disabled. Only SELECT, WITH, PRAGMA, EXPLAIN, and DESCRIBE queries are permitted.
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

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
        {guardrailResult && !guardrailResult.allowed && (
          <div style={{
            marginTop: 12, padding: '8px 14px', borderRadius: 8, fontSize: 13,
            backgroundColor: isDark ? '#422006' : '#fffbeb',
            color: isDark ? '#fcd34d' : '#92400e',
            border: `1px solid ${isDark ? '#b45309' : '#fcd34d'}`,
          }}>
            🚫 <strong>Security Policy:</strong> {guardrailResult.reason} (Category: {guardrailResult.category})
          </div>
        )}

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

        {/* Audit Logs */}
        {showAuditLogs && (
          <div style={{
            marginTop: 16, padding: 16, borderRadius: 10,
            border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
            backgroundColor: isDark ? '#111318' : '#fff',
            maxHeight: 300, overflow: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: isDark ? '#9ca3af' : '#6b7280' }}>
                📋 Audit Logs (Last 100 queries)
              </h3>
              <button onClick={fetchAuditLogs} style={{ ...btnStyle(isDark, false), padding: '2px 8px', fontSize: 11 }}>
                Refresh
              </button>
            </div>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: `1px solid ${isDark ? '#1f2937' : '#f3f4f6'}` }}>
                  <th style={{ padding: '8px 4px' }}>User</th>
                  <th style={{ padding: '8px 4px' }}>SQL</th>
                  <th style={{ padding: '8px 4px' }}>Status</th>
                  <th style={{ padding: '8px 4px' }}>Rows</th>
                  <th style={{ padding: '8px 4px' }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map(log => (
                  <tr key={log.id} style={{ borderBottom: `1px solid ${isDark ? '#1f2937' : '#f3f4f6'}` }}>
                    <td style={{ padding: '8px 4px', fontWeight: 500 }}>{log.user}</td>
                    <td style={{ padding: '8px 4px', fontFamily: 'monospace', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={log.sql}>
                      {log.sql}
                    </td>
                    <td style={{ padding: '8px 4px' }}>
                      <span style={{
                        padding: '2px 6px', borderRadius: 4, fontSize: 10,
                        backgroundColor: log.status === 'success' ? '#065f46' : '#7f1d1d',
                        color: '#fff'
                      }}>
                        {log.status}
                      </span>
                    </td>
                    <td style={{ padding: '8px 4px' }}>{log.resultSize}</td>
                    <td style={{ padding: '8px 4px', color: isDark ? '#6b7280' : '#9ca3af' }}>
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
                {auditLogs.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: 24, textAlign: 'center', color: isDark ? '#4b5563' : '#9ca3af' }}>
                      No logs found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
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
            onPageChange={handlePageChange}
            paginationVariant={paginationVariant}
            style={{
              ...(isDark ? {
                '--vsql-border': '#1f2937', '--vsql-muted': '#6b7280',
                '--vsql-badge-bg': '#1e3a5f', '--vsql-badge-fg': '#60a5fa',
                '--vsql-th-bg': '#151921', '--vsql-th-fg': '#9ca3af',
                '--vsql-row-alt': '#0d0f14',
                '--vsql-bg': '#111318', '--vsql-fg': '#e4e5e7',
                '--vsql-primary': '#2563eb',
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

function getAllowedOps(hints: AccessControlHints | null): string[] {
  if (!hints) return []
  const allOps: string[] = ['select', 'insert', 'update', 'delete', 'ddl_read', 'ddl_write', 'dcl', 'transaction', 'admin']
  const disabled = hints.disabledOperations || []
  return allOps.filter(op => !disabled.includes(op as any))
}
