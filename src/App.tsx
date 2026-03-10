import { useState, useCallback, useEffect, useRef } from 'react'
import { useSqlEditor, SqlResults } from '@vsql/react'
import { 
  configureSqlJsWasm, 
  validateGuardrails, 
  analyzeQuery,
  type GuardrailsConfig,
  type QueryAnalysis,
  type PaginationConfig,
  type PaginationStyle,
  DEFAULT_PAGINATION_CONFIG,
} from '@vsql/core'
import type { SqlDialect, ThemePreset } from '@vsql/core'
import { USE_REMOTE_DB, API_BASE_URL } from './db/config'
import { remoteDbAdapter, sessionManager } from './db/remoteAdapter'

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

// Guardrails presets
const GUARDRAILS_PRESETS: { name: string; description: string; config: GuardrailsConfig }[] = [
  {
    name: 'full',
    description: 'Full access - all operations allowed',
    config: {
      permissions: { select: true, insert: true, update: true, delete: true, ddl: true, dcl: false, other: true },
    },
  },
  {
    name: 'read-only',
    description: 'Read-only - only SELECT allowed',
    config: {
      permissions: { select: true, insert: false, update: false, delete: false, ddl: false, dcl: false, other: true },
      blockedMessage: 'Read-only mode: Only SELECT queries are allowed.',
    },
  },
  {
    name: 'write',
    description: 'Write mode - no DELETE',
    config: {
      permissions: { select: true, insert: true, update: true, delete: false, ddl: false, dcl: false, other: true },
      blockedMessage: 'Delete operations are not permitted.',
    },
  },
  {
    name: 'strict',
    description: 'Strict - pattern controls & limits',
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
    description: 'No full table scans',
    config: {
      permissions: { select: true, insert: true, update: true, delete: true, ddl: false, dcl: false, other: true },
      patterns: { allowFullTableScan: false },
      blockedMessage: 'Full table scans are not allowed. Add a WHERE clause.',
    },
  },
  {
    name: 'limit-required',
    description: 'LIMIT clause required',
    config: {
      permissions: { select: true, insert: true, update: true, delete: true, ddl: false, dcl: false, other: true },
      patterns: { requireLimit: true, defaultLimit: 100 },
      blockedMessage: 'LIMIT clause is required for SELECT queries.',
    },
  },
]

// Audit log entry type
interface AuditLogEntry {
  id: string
  timestamp: string
  user: string
  sql: string
  operationType: string
  tables: string[]
  rowCount: number
  elapsed: number
  status: 'success' | 'blocked' | 'error'
  errorMessage?: string
}

type ConnectionStatus = 'checking' | 'connected' | 'error' | null

export function App() {
  const [dialect, setDialect] = useState<SqlDialect>(USE_REMOTE_DB ? 'postgresql' : 'sqlite')
  const [theme, setTheme] = useState<ThemePreset>('light')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [dataLoaded, setDataLoaded] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(USE_REMOTE_DB ? 'checking' : null)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  
  // Guardrails state
  const [guardrails, setGuardrails] = useState<GuardrailsConfig | null>(null)
  const [selectedPreset, setSelectedPreset] = useState<string>('full')
  const [showGuardrailsPanel, setShowGuardrailsPanel] = useState(false)
  const [queryAnalysis, setQueryAnalysis] = useState<QueryAnalysis | null>(null)
  const [guardrailsError, setGuardrailsError] = useState<string | null>(null)
  
  // Audit log state
  const [showAuditLog, setShowAuditLog] = useState(false)
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([])
  const [currentUser] = useState('demo_user')
  
  // Session state
  const [sessionInfo, setSessionInfo] = useState<{ sessionId: string; user: string; createdAt: Date } | null>(null)
  const [showSessionPanel, setShowSessionPanel] = useState(false)

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
    setGuardrails: setEditorGuardrails,
    getGuardrails: getEditorGuardrails,
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

  // Load guardrails from server on mount
  useEffect(() => {
    if (!USE_REMOTE_DB) return
    
    fetch(`${API_BASE_URL}/api/guardrails`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.guardrails) {
          setGuardrails(data.guardrails)
          setEditorGuardrails(data.guardrails)
        }
      })
      .catch(() => {})
  }, [])

  // Load audit log from server
  const loadAuditLog = useCallback(() => {
    if (!USE_REMOTE_DB) return
    
    fetch(`${API_BASE_URL}/api/audit`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.logs) {
          setAuditLog(data.logs)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (USE_REMOTE_DB && showAuditLog) {
      loadAuditLog()
    }
  }, [showAuditLog, loadAuditLog])

  // Create session on mount for remote DB
  useEffect(() => {
    if (!USE_REMOTE_DB) return
    
    // Create a session when connecting to remote DB
    sessionManager.createSession(currentUser).then((session) => {
      setSessionInfo({
        sessionId: session.sessionId,
        user: session.user,
        createdAt: new Date(session.createdAt),
      })
      console.log('Session created:', session.sessionId)
    }).catch((err) => {
      console.error('Failed to create session:', err)
    })
    
    // Cleanup on unmount
    return () => {
      sessionManager.closeSession().catch(() => {})
    }
  }, [currentUser])

  // Session management functions
  const handleCreateSession = useCallback(async () => {
    try {
      const session = await sessionManager.createSession(currentUser)
      setSessionInfo({
        sessionId: session.sessionId,
        user: session.user,
        createdAt: new Date(session.createdAt),
      })
      setStatusMessage('New session created with dedicated connection')
      setTimeout(() => setStatusMessage(null), 2000)
    } catch (e: any) {
      setStatusMessage('Failed to create session: ' + e.message)
    }
  }, [currentUser])

  const handleCloseSession = useCallback(async () => {
    try {
      await sessionManager.closeSession()
      setSessionInfo(null)
      setStatusMessage('Session closed, connection released')
      setTimeout(() => setStatusMessage(null), 2000)
    } catch (e: any) {
      setStatusMessage('Failed to close session: ' + e.message)
    }
  }, [])

  // Analyze current query when editor changes
  useEffect(() => {
    if (!editor) return
    
    const analyzeCurrentQuery = () => {
      const sql = editor.getValue()
      if (sql.trim()) {
        try {
          const analysis = analyzeQuery(sql, dialect)
          setQueryAnalysis(analysis)
          
          // Validate against guardrails
          if (guardrails) {
            const validation = validateGuardrails(sql, guardrails, dialect)
            if (!validation.allowed) {
              setGuardrailsError(validation.reason || 'Query blocked by guardrails')
            } else {
              setGuardrailsError(null)
            }
          } else {
            setGuardrailsError(null)
          }
        } catch {
          setQueryAnalysis(null)
        }
      }
    }

    // Initial analysis
    analyzeCurrentQuery()

    // Set up interval to check for changes
    const interval = setInterval(analyzeCurrentQuery, 500)
    return () => clearInterval(interval)
  }, [editor, guardrails, dialect])

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

  // Apply guardrails preset
  const applyPreset = useCallback((presetName: string) => {
    const preset = GUARDRAILS_PRESETS.find(p => p.name === presetName)
    if (preset) {
      setGuardrails(preset.config)
      setEditorGuardrails(preset.config)
      setSelectedPreset(presetName)
      
      // Send to server if using remote DB
      if (USE_REMOTE_DB) {
        fetch(`${API_BASE_URL}/api/guardrails`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guardrails: preset.config }),
        }).catch(() => {})
      }
      
      setStatusMessage(`Applied guardrails preset: ${preset.name}`)
      setTimeout(() => setStatusMessage(null), 2000)
    }
  }, [setEditorGuardrails])

  // Add entry to audit log
  const addAuditEntry = useCallback((entry: Omit<AuditLogEntry, 'id' | 'timestamp'>) => {
    const newEntry: AuditLogEntry = {
      ...entry,
      id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
    }
    
    // Add to local state
    setAuditLog(prev => [newEntry, ...prev].slice(0, 100)) // Keep last 100 entries
    
    // Send to server if using remote DB
    if (USE_REMOTE_DB) {
      fetch(`${API_BASE_URL}/api/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newEntry),
      }).catch(() => {})
    }
  }, [])

  const handleRun = useCallback(async () => {
    setStatusMessage(null)
    const sql = editor?.getValue() || ''
    
    // Check guardrails before running
    if (guardrails && editor) {
      const validation = validateGuardrails(sql, guardrails, dialect)
      if (!validation.allowed) {
        const errorMsg = validation.reason || 'Query blocked by guardrails'
        setStatusMessage(`Blocked: ${errorMsg}`)
        
        // Add blocked entry to audit log
        addAuditEntry({
          user: currentUser,
          sql,
          operationType: validation.operationType,
          tables: validation.tables,
          rowCount: 0,
          elapsed: 0,
          status: 'blocked',
          errorMessage: errorMsg,
        })
        
        return
      }
    }
    
    const startTime = performance.now()
    try {
      const result = await run()
      const elapsed = Math.round(performance.now() - startTime)
      
      if (!result) {
        setStatusMessage('Query returned no data.')
      }
      
      // Add success entry to audit log
      addAuditEntry({
        user: currentUser,
        sql,
        operationType: queryAnalysis?.operationType || 'UNKNOWN',
        tables: queryAnalysis?.tables || [],
        rowCount: result?.rowCount || 0,
        elapsed,
        status: 'success',
      })
    } catch (e: any) {
      const elapsed = Math.round(performance.now() - startTime)
      const errorMsg = e?.message || String(e)
      setStatusMessage('Execution error: ' + errorMsg)
      
      // Add error entry to audit log
      addAuditEntry({
        user: currentUser,
        sql,
        operationType: queryAnalysis?.operationType || 'UNKNOWN',
        tables: queryAnalysis?.tables || [],
        rowCount: 0,
        elapsed,
        status: 'error',
        errorMessage: errorMsg,
      })
    }
  }, [run, guardrails, editor, dialect, queryAnalysis, addAuditEntry, currentUser])

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
            Write, validate, and run SQL queries with guardrails support
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

          <button 
            onClick={() => setShowGuardrailsPanel(!showGuardrailsPanel)} 
            style={{
              ...btnStyle(isDark, false),
              backgroundColor: showGuardrailsPanel 
                ? (isDark ? '#1e3a5f' : '#dbeafe')
                : (isDark ? '#1f2937' : '#fff'),
              color: showGuardrailsPanel 
                ? (isDark ? '#60a5fa' : '#2563eb')
                : (isDark ? '#d1d5db' : '#4b5563'),
              border: showGuardrailsPanel 
                ? `1px solid ${isDark ? '#3b82f6' : '#2563eb'}`
                : `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
            }}
          >
            🔒 Guardrails
          </button>

          <button 
            onClick={() => setShowAuditLog(!showAuditLog)} 
            style={{
              ...btnStyle(isDark, false),
              backgroundColor: showAuditLog 
                ? (isDark ? '#1e3a5f' : '#dbeafe')
                : (isDark ? '#1f2937' : '#fff'),
              color: showAuditLog 
                ? (isDark ? '#60a5fa' : '#2563eb')
                : (isDark ? '#d1d5db' : '#4b5563'),
              border: showAuditLog 
                ? `1px solid ${isDark ? '#3b82f6' : '#2563eb'}`
                : `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
            }}
          >
            📋 Audit Log
          </button>

          {USE_REMOTE_DB && (
            <button 
              onClick={() => setShowSessionPanel(!showSessionPanel)} 
              style={{
                ...btnStyle(isDark, false),
                backgroundColor: showSessionPanel 
                  ? (isDark ? '#1e3a5f' : '#dbeafe')
                  : (isDark ? '#1f2937' : '#fff'),
                color: showSessionPanel 
                  ? (isDark ? '#60a5fa' : '#2563eb')
                  : (isDark ? '#d1d5db' : '#4b5563'),
                border: showSessionPanel 
                  ? `1px solid ${isDark ? '#3b82f6' : '#2563eb'}`
                  : `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
              }}
            >
              🔗 Session
              {sessionInfo && (
                <span style={{ 
                  marginLeft: 6, 
                  fontSize: 10,
                  backgroundColor: isDark ? '#065f46' : '#d1fae5',
                  color: isDark ? '#34d399' : '#059669',
                  padding: '1px 4px',
                  borderRadius: 3,
                }}>
                  Active
                </span>
              )}
            </button>
          )}

          <div style={{ flex: 1 }} />

          {USE_REMOTE_DB && connectionStatus === 'checking' && (
            <span style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af' }}>
              Connecting...
            </span>
          )}
          {USE_REMOTE_DB && connectionStatus === 'connected' && (
            <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, color: isDark ? '#34d399' : '#059669' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'currentColor' }} />
              Connected
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
            disabled={isRunning || !dataLoaded || !!guardrailsError}
            style={{
              ...btnStyle(isDark, true),
              opacity: (isRunning || !dataLoaded || guardrailsError) ? 0.6 : 1,
              minWidth: 120,
            }}
          >
            {isRunning ? 'Running...' : 'Run Query'}
          </button>
        </div>

        {/* Session Panel */}
        {USE_REMOTE_DB && showSessionPanel && (
          <div style={{
            marginBottom: 12,
            padding: 16,
            borderRadius: 10,
            border: `1px solid ${isDark ? '#1f2937' : '#e5e7eb'}`,
            backgroundColor: isDark ? '#111318' : '#fff',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
                🔗 Session Connection
              </h3>
              <span style={{ 
                fontSize: 10, 
                padding: '2px 8px', 
                borderRadius: 4,
                backgroundColor: sessionInfo 
                  ? (isDark ? '#065f46' : '#d1fae5')
                  : (isDark ? '#374151' : '#e5e7eb'),
                color: sessionInfo 
                  ? (isDark ? '#34d399' : '#059669')
                  : (isDark ? '#9ca3af' : '#6b7280'),
                fontWeight: 600,
                textTransform: 'uppercase',
              }}>
                {sessionInfo ? 'Active' : 'No Session'}
              </span>
            </div>
            
            <p style={{ 
              margin: '0 0 12px', 
              fontSize: 12, 
              color: isDark ? '#9ca3af' : '#6b7280' 
            }}>
              Each session has its own dedicated database connection, providing isolation for temporary tables, 
              session variables, and transactions.
            </p>

            {sessionInfo ? (
              <div style={{ 
                padding: 12, 
                borderRadius: 6, 
                backgroundColor: isDark ? '#1f2937' : '#f9fafb',
                marginBottom: 12,
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                  <div>
                    <span style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>Session ID:</span>
                    <div style={{ 
                      fontFamily: 'monospace', 
                      fontSize: 11, 
                      color: isDark ? '#60a5fa' : '#2563eb',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {sessionInfo.sessionId}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>User:</span>
                    <div style={{ fontWeight: 500, color: isDark ? '#d1d5db' : '#4b5563' }}>
                      {sessionInfo.user}
                    </div>
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <span style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>Created:</span>
                    <div style={{ color: isDark ? '#d1d5db' : '#4b5563' }}>
                      {sessionInfo.createdAt.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ 
                padding: 12, 
                borderRadius: 6, 
                backgroundColor: isDark ? '#1f2937' : '#f9fafb',
                marginBottom: 12,
                textAlign: 'center',
                color: isDark ? '#9ca3af' : '#6b7280',
                fontSize: 12,
              }}>
                No active session. Create one to get a dedicated database connection.
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleCreateSession}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: `1px solid ${isDark ? '#3b82f6' : '#2563eb'}`,
                  backgroundColor: isDark ? '#1e3a5f' : '#dbeafe',
                  color: isDark ? '#60a5fa' : '#2563eb',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {sessionInfo ? '🔄 New Session' : '➕ Create Session'}
              </button>
              {sessionInfo && (
                <button
                  onClick={handleCloseSession}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: `1px solid ${isDark ? '#dc2626' : '#dc2626'}`,
                    backgroundColor: isDark ? '#7f1d1d' : '#fee2e2',
                    color: '#dc2626',
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  ✕ Close Session
                </button>
              )}
            </div>

            {/* Session Benefits */}
            <div style={{ marginTop: 12, fontSize: 11, color: isDark ? '#6b7280' : '#9ca3af' }}>
              <strong>Benefits:</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                <li>Isolated temporary tables</li>
                <li>Session-level variables and settings</li>
                <li>Transaction isolation per user</li>
                <li>Independent connection lifecycle</li>
              </ul>
            </div>
          </div>
        )}

        {/* Guardrails Panel */}
        {showGuardrailsPanel && (
          <div style={{
            marginBottom: 12,
            padding: 16,
            borderRadius: 10,
            border: `1px solid ${isDark ? '#1f2937' : '#e5e7eb'}`,
            backgroundColor: isDark ? '#111318' : '#fff',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
                🔒 Guardrails Configuration
              </h3>
              <span style={{ 
                fontSize: 10, 
                padding: '2px 8px', 
                borderRadius: 4,
                backgroundColor: isDark ? '#1e3a5f' : '#dbeafe',
                color: isDark ? '#60a5fa' : '#2563eb',
                fontWeight: 600,
                textTransform: 'uppercase',
              }}>
                {selectedPreset}
              </span>
            </div>
            
            {/* Preset Buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 16 }}>
              {GUARDRAILS_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => applyPreset(preset.name)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: `1px solid ${selectedPreset === preset.name 
                      ? (isDark ? '#3b82f6' : '#2563eb')
                      : (isDark ? '#374151' : '#e5e7eb')}`,
                    backgroundColor: selectedPreset === preset.name 
                      ? (isDark ? '#1e3a5f' : '#dbeafe')
                      : 'transparent',
                    color: selectedPreset === preset.name 
                      ? (isDark ? '#60a5fa' : '#2563eb')
                      : (isDark ? '#9ca3af' : '#6b7280'),
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    textTransform: 'capitalize',
                  }}
                  title={preset.description}
                >
                  {preset.name.replace('-', ' ')}
                </button>
              ))}
            </div>

            {/* Permissions Section */}
            {guardrails?.permissions && (
              <div style={{ marginBottom: 16 }}>
                <h4 style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: isDark ? '#9ca3af' : '#6b7280', textTransform: 'uppercase' }}>
                  Permissions
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
                  {['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DDL', 'DCL'].map((op) => {
                    const key = op.toLowerCase() as keyof typeof guardrails.permissions
                    const enabled = guardrails.permissions[key] !== false
                    return (
                      <div key={op} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 8px',
                        borderRadius: 4,
                        backgroundColor: isDark ? '#1f2937' : '#f9fafb',
                      }}>
                        <span style={{
                          width: 18,
                          height: 18,
                          borderRadius: 4,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: enabled 
                            ? (isDark ? '#065f46' : '#d1fae5')
                            : (isDark ? '#7f1d1d' : '#fee2e2'),
                          fontSize: 10,
                        }}>
                          {enabled ? '✓' : '✗'}
                        </span>
                        <span style={{ 
                          fontSize: 11, 
                          fontWeight: 500,
                          color: enabled 
                            ? (isDark ? '#34d399' : '#059669')
                            : (isDark ? '#f87171' : '#dc2626'),
                        }}>
                          {op}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Pattern Controls Section */}
            {guardrails?.patterns && (
              <div style={{ marginBottom: 16 }}>
                <h4 style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: isDark ? '#9ca3af' : '#6b7280', textTransform: 'uppercase' }}>
                  Query Patterns
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
                  {[
                    { key: 'allowSelectAll', label: 'Allow SELECT *' },
                    { key: 'allowFullTableScan', label: 'Allow full table scan' },
                    { key: 'allowCrossJoin', label: 'Allow CROSS JOIN' },
                    { key: 'allowSubqueries', label: 'Allow subqueries' },
                    { key: 'requireLimit', label: 'Require LIMIT' },
                    { key: 'allowUnion', label: 'Allow UNION' },
                  ].map(({ key, label }) => {
                    const patternKey = key as keyof typeof guardrails.patterns
                    const value = guardrails.patterns?.[patternKey]
                    const isSet = value !== undefined
                    const enabled = value !== false
                    
                    return (
                      <div key={key} style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 8px',
                        borderRadius: 4,
                        backgroundColor: isDark ? '#1f2937' : '#f9fafb',
                      }}>
                        <span style={{ fontSize: 11, color: isDark ? '#d1d5db' : '#4b5563' }}>
                          {label}
                        </span>
                        <span style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '2px 6px',
                          borderRadius: 4,
                          backgroundColor: !isSet 
                            ? (isDark ? '#374151' : '#e5e7eb')
                            : enabled 
                              ? (isDark ? '#065f46' : '#d1fae5')
                              : (isDark ? '#7f1d1d' : '#fee2e2'),
                          color: !isSet 
                            ? (isDark ? '#6b7280' : '#9ca3af')
                            : enabled 
                              ? (isDark ? '#34d399' : '#059669')
                              : (isDark ? '#f87171' : '#dc2626'),
                        }}>
                          {!isSet ? 'default' : enabled ? 'ON' : 'OFF'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Limits Section */}
            {guardrails?.limits && Object.keys(guardrails.limits).length > 0 && (
              <div>
                <h4 style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: isDark ? '#9ca3af' : '#6b7280', textTransform: 'uppercase' }}>
                  Limits
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
                  {guardrails.limits.maxRows !== undefined && (
                    <div style={{ fontSize: 11, padding: '4px 8px', backgroundColor: isDark ? '#1f2937' : '#f9fafb', borderRadius: 4 }}>
                      <span style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>Max rows: </span>
                      <strong style={{ color: isDark ? '#fbbf24' : '#d97706' }}>{guardrails.limits.maxRows}</strong>
                    </div>
                  )}
                  {guardrails.limits.maxJoinedTables !== undefined && (
                    <div style={{ fontSize: 11, padding: '4px 8px', backgroundColor: isDark ? '#1f2937' : '#f9fafb', borderRadius: 4 }}>
                      <span style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>Max joins: </span>
                      <strong style={{ color: isDark ? '#fbbf24' : '#d97706' }}>{guardrails.limits.maxJoinedTables}</strong>
                    </div>
                  )}
                  {guardrails.limits.maxSelectedColumns !== undefined && (
                    <div style={{ fontSize: 11, padding: '4px 8px', backgroundColor: isDark ? '#1f2937' : '#f9fafb', borderRadius: 4 }}>
                      <span style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>Max columns: </span>
                      <strong style={{ color: isDark ? '#fbbf24' : '#d97706' }}>{guardrails.limits.maxSelectedColumns}</strong>
                    </div>
                  )}
                  {guardrails.limits.timeout !== undefined && (
                    <div style={{ fontSize: 11, padding: '4px 8px', backgroundColor: isDark ? '#1f2937' : '#f9fafb', borderRadius: 4 }}>
                      <span style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>Timeout: </span>
                      <strong style={{ color: isDark ? '#fbbf24' : '#d97706' }}>{guardrails.limits.timeout}ms</strong>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Query Analysis Panel */}
        {queryAnalysis && showGuardrailsPanel && (
          <div style={{
            marginBottom: 12,
            padding: 12,
            borderRadius: 10,
            border: `1px solid ${guardrailsError 
              ? (isDark ? '#7f1d1d' : '#fecaca')
              : (isDark ? '#065f46' : '#d1fae5')}`,
            backgroundColor: guardrailsError 
              ? (isDark ? '#1c1017' : '#fef2f2')
              : (isDark ? '#0d1f17' : '#f0fdf4'),
          }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
              <div>
                <span style={{ color: isDark ? '#6b7280' : '#9ca3af' }}>Type: </span>
                <span style={{ 
                  color: queryAnalysis.operationType === 'SELECT' 
                    ? (isDark ? '#34d399' : '#059669')
                    : (isDark ? '#f59e0b' : '#d97706'),
                  fontWeight: 600,
                }}>
                  {queryAnalysis.operationType}
                </span>
              </div>
              <div>
                <span style={{ color: isDark ? '#6b7280' : '#9ca3af' }}>Tables: </span>
                <span>{queryAnalysis.tables.join(', ') || 'none'}</span>
              </div>
              <div>
                <span style={{ color: isDark ? '#6b7280' : '#9ca3af' }}>SELECT *: </span>
                <span style={{ color: queryAnalysis.hasSelectAll ? '#f87171' : '#34d399' }}>
                  {queryAnalysis.hasSelectAll ? 'Yes' : 'No'}
                </span>
              </div>
              <div>
                <span style={{ color: isDark ? '#6b7280' : '#9ca3af' }}>WHERE: </span>
                <span style={{ color: queryAnalysis.hasWhereClause ? '#34d399' : '#f87171' }}>
                  {queryAnalysis.hasWhereClause ? 'Yes' : 'No'}
                </span>
              </div>
              <div>
                <span style={{ color: isDark ? '#6b7280' : '#9ca3af' }}>LIMIT: </span>
                <span style={{ color: queryAnalysis.hasLimitClause ? '#34d399' : '#f87171' }}>
                  {queryAnalysis.hasLimitClause ? 'Yes' : 'No'}
                </span>
              </div>
              <div>
                <span style={{ color: isDark ? '#6b7280' : '#9ca3af' }}>Joins: </span>
                <span>{queryAnalysis.joinCount}</span>
              </div>
            </div>
            
            {guardrailsError && (
              <div style={{ 
                marginTop: 8, 
                padding: '6px 10px', 
                borderRadius: 4,
                backgroundColor: isDark ? '#7f1d1d' : '#fee2e2',
                color: isDark ? '#fca5a5' : '#dc2626',
                fontSize: 12,
              }}>
                ⚠️ {guardrailsError}
              </div>
            )}
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

        {/* Audit Log Panel */}
        {showAuditLog && (
          <div style={{
            marginTop: 16,
            padding: 16,
            borderRadius: 10,
            border: `1px solid ${isDark ? '#1f2937' : '#e5e7eb'}`,
            backgroundColor: isDark ? '#111318' : '#fff',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
                📋 Query Audit Log
              </h3>
              <span style={{ fontSize: 11, color: isDark ? '#6b7280' : '#9ca3af' }}>
                {auditLog.length} queries logged
              </span>
            </div>
            
            {auditLog.length === 0 ? (
              <div style={{ 
                padding: 24, 
                textAlign: 'center', 
                color: isDark ? '#6b7280' : '#9ca3af',
                fontSize: 13,
              }}>
                No queries executed yet. Run a query to see audit entries.
              </div>
            ) : (
              <div style={{ 
                maxHeight: 300, 
                overflow: 'auto',
                borderRadius: 6,
                border: `1px solid ${isDark ? '#1f2937' : '#e5e7eb'}`,
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ 
                      backgroundColor: isDark ? '#1f2937' : '#f9fafb',
                      position: 'sticky',
                      top: 0,
                    }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, borderBottom: `1px solid ${isDark ? '#374151' : '#e5e7eb'}` }}>Time</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, borderBottom: `1px solid ${isDark ? '#374151' : '#e5e7eb'}` }}>User</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, borderBottom: `1px solid ${isDark ? '#374151' : '#e5e7eb'}` }}>Type</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, borderBottom: `1px solid ${isDark ? '#374151' : '#e5e7eb'}` }}>SQL</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, borderBottom: `1px solid ${isDark ? '#374151' : '#e5e7eb'}` }}>Rows</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, borderBottom: `1px solid ${isDark ? '#374151' : '#e5e7eb'}` }}>Time</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600, borderBottom: `1px solid ${isDark ? '#374151' : '#e5e7eb'}` }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map((entry) => (
                      <tr key={entry.id} style={{ 
                        backgroundColor: entry.status === 'success' 
                          ? 'transparent'
                          : entry.status === 'blocked'
                            ? (isDark ? '#1c101750' : '#fef2f250')
                            : (isDark ? '#7f1d1d50' : '#fee2e250'),
                      }}>
                        <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: isDark ? '#9ca3af' : '#6b7280' }}>
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </td>
                        <td style={{ padding: '8px 12px', color: isDark ? '#d1d5db' : '#4b5563' }}>
                          {entry.user}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 600,
                            backgroundColor: entry.operationType === 'SELECT'
                              ? (isDark ? '#065f46' : '#d1fae5')
                              : (isDark ? '#78350f' : '#fef3c7'),
                            color: entry.operationType === 'SELECT'
                              ? (isDark ? '#34d399' : '#059669')
                              : (isDark ? '#fbbf24' : '#d97706'),
                          }}>
                            {entry.operationType}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', maxWidth: 200 }}>
                          <div style={{ 
                            overflow: 'hidden', 
                            textOverflow: 'ellipsis', 
                            whiteSpace: 'nowrap',
                            fontFamily: 'monospace',
                            fontSize: 11,
                          }} title={entry.sql}>
                            {entry.sql}
                          </div>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: isDark ? '#d1d5db' : '#4b5563' }}>
                          {entry.rowCount}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: isDark ? '#9ca3af' : '#6b7280' }}>
                          {entry.elapsed}ms
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '2px 8px',
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 600,
                            backgroundColor: entry.status === 'success'
                              ? (isDark ? '#065f46' : '#d1fae5')
                              : entry.status === 'blocked'
                                ? (isDark ? '#78350f' : '#fef3c7')
                                : (isDark ? '#7f1d1d' : '#fee2e2'),
                            color: entry.status === 'success'
                              ? (isDark ? '#34d399' : '#059669')
                              : entry.status === 'blocked'
                                ? (isDark ? '#fbbf24' : '#d97706')
                                : (isDark ? '#f87171' : '#dc2626'),
                          }}>
                            {entry.status === 'success' ? '✓' : entry.status === 'blocked' ? '⊘' : '✗'}
                            {' '}
                            {entry.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

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
          @vsql/core + @vsql/react | CodeMirror 6 + sql.js + node-sql-parser | Guardrails & Audit Enabled
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
