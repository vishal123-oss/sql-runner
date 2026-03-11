import { useState, useCallback, useEffect, useRef } from 'react'
import { useSqlEditor, SqlResults, SqlChart } from '@vsql/react'
import { configureSqlJsWasm } from '@vsql/core'
import type { SqlDialect, ThemePreset, ExportResult, ChartType, ChartColumnConfig } from '@vsql/core'
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
    { name: 'department', type: 'TEXT' },
    { name: 'salary', type: 'REAL' },
  ],
  orders: [
    { name: 'id', type: 'INTEGER' },
    { name: 'user_id', type: 'INTEGER' },
    { name: 'product', type: 'TEXT' },
    { name: 'amount', type: 'REAL' },
    { name: 'status', type: 'TEXT' },
    { name: 'order_date', type: 'TEXT' },
  ],
  products: [
    { name: 'id', type: 'INTEGER' },
    { name: 'name', type: 'TEXT' },
    { name: 'price', type: 'REAL' },
    { name: 'category', type: 'TEXT' },
    { name: 'stock', type: 'INTEGER' },
  ],
  sales: [
    { name: 'id', type: 'INTEGER' },
    { name: 'region', type: 'TEXT' },
    { name: 'product', type: 'TEXT' },
    { name: 'quantity', type: 'INTEGER' },
    { name: 'revenue', type: 'REAL' },
    { name: 'month', type: 'TEXT' },
  ],
}

const SAMPLE_QUERIES = [
  'SELECT * FROM users LIMIT 10;',
  'SELECT city, COUNT(*) as count FROM users GROUP BY city ORDER BY count DESC;',
  'SELECT department, AVG(salary) as avg_salary FROM users GROUP BY department;',
  'SELECT status, COUNT(*) as count FROM orders GROUP BY status;',
]

// Suggested queries specifically for visualization
const CHART_SUGGESTION_QUERIES = [
  {
    name: 'Users by City',
    query: "SELECT city, COUNT(*) as count FROM users GROUP BY city ORDER BY count DESC LIMIT 10;",
    description: 'Bar chart showing user distribution by city'
  },
  {
    name: 'Order Status',
    query: "SELECT status, COUNT(*) as count FROM orders GROUP BY status ORDER BY count DESC;",
    description: 'Pie chart showing order status distribution'
  },
  {
    name: 'Sales by Region',
    query: "SELECT region, SUM(revenue) as total_revenue, SUM(quantity) as total_qty FROM sales GROUP BY region ORDER BY total_revenue DESC;",
    description: 'Bar chart comparing revenue and quantity by region'
  },
  {
    name: 'Department Salaries',
    query: "SELECT department, AVG(salary) as avg_salary, COUNT(*) as employees FROM users GROUP BY department ORDER BY avg_salary DESC;",
    description: 'Grouped bar chart showing salary and employee count'
  },
  {
    name: 'Monthly Revenue',
    query: "SELECT month, SUM(revenue) as revenue FROM sales GROUP BY month ORDER BY month;",
    description: 'Bar chart showing monthly revenue trend'
  },
  {
    name: 'Product Categories',
    query: "SELECT category, COUNT(*) as products, SUM(stock) as total_stock FROM products GROUP BY category;",
    description: 'Stacked bar chart showing products and stock by category'
  },
]

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: 'bar', label: '📊 Bar Chart' },
  { value: 'horizontal-bar', label: '📊 Horizontal Bar' },
  { value: 'pie', label: '🥧 Pie Chart' },
  { value: 'donut', label: '🍩 Donut Chart' },
  { value: 'grouped-bar', label: '📊 Grouped Bar' },
  { value: 'stacked-bar', label: '📊 Stacked Bar' },
]

interface ChartConfig {
  id: string
  type: ChartType
  labelColumn: string
  valueColumns: string[]
  title: string
}

type ConnectionStatus = 'checking' | 'connected' | 'error' | null

export function App() {
  const [dialect, setDialect] = useState<SqlDialect>(USE_REMOTE_DB ? 'postgresql' : 'sqlite')
  const [theme, setTheme] = useState<ThemePreset>('light')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [dataLoaded, setDataLoaded] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(USE_REMOTE_DB ? 'checking' : null)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [charts, setCharts] = useState<ChartConfig[]>([])
  const [showChartModal, setShowChartModal] = useState(false)
  const [newChartConfig, setNewChartConfig] = useState<Partial<ChartConfig>>({
    type: 'bar',
    title: '',
  })

  const {
    containerRef,
    editor,
    errors,
    results,
    isRunning,
    run,
    cancel,
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
          CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, age INTEGER, city TEXT, department TEXT, salary REAL);
          CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, user_id INTEGER, product TEXT, amount REAL, status TEXT, order_date TEXT);
          CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT, price REAL, category TEXT, stock INTEGER);
          CREATE TABLE IF NOT EXISTS sales (id INTEGER PRIMARY KEY, region TEXT, product TEXT, quantity INTEGER, revenue REAL, month TEXT);
        `)

        // Generate 100 users with departments and salaries
        const firstNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack', 'Kate', 'Liam', 'Mia', 'Noah', 'Olivia', 'Peter', 'Quinn', 'Ruby', 'Sam', 'Tina', 'Uma', 'Victor', 'Wendy', 'Xavier', 'Yara', 'Zack']
        const cities = ['New York', 'San Francisco', 'Chicago', 'Los Angeles', 'Houston', 'Phoenix', 'Seattle', 'Denver', 'Boston', 'Miami']
        const departments = ['Engineering', 'Marketing', 'Sales', 'HR', 'Finance', 'Operations', 'Support', 'Design', 'Legal', 'Product']
        const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'example.com', 'mail.com']

        let usersInsert = ''
        for (let i = 1; i <= 100; i++) {
          const name = firstNames[i % firstNames.length] + (i > 26 ? i : '')
          const email = `user${i}@${domains[i % domains.length]}`
          const age = 20 + (i % 45)
          const city = cities[i % cities.length]
          const department = departments[i % departments.length]
          const salary = 50000 + (i % 10) * 15000 + (i % 5) * 5000
          usersInsert += `INSERT OR IGNORE INTO users VALUES (${i}, '${name}', '${email}', ${age}, '${city}', '${department}', ${salary});\n`
        }
        await editor.execRaw(usersInsert)

        // Generate 150 orders
        const products = ['Laptop', 'Phone', 'Tablet', 'Monitor', 'Keyboard', 'Mouse', 'Headphones', 'Webcam', 'Speaker', 'Charger']
        const statuses = ['completed', 'pending', 'shipped', 'cancelled', 'processing']
        const months = ['2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06']

        let ordersInsert = ''
        for (let i = 1; i <= 150; i++) {
          const userId = (i % 100) + 1
          const product = products[i % products.length]
          const amount = (19.99 + (i * 7.5)).toFixed(2)
          const status = statuses[i % statuses.length]
          const orderDate = months[i % months.length] + '-' + String((i % 28) + 1).padStart(2, '0')
          ordersInsert += `INSERT OR IGNORE INTO orders VALUES (${i}, ${userId}, '${product}', ${amount}, '${status}', '${orderDate}');\n`
        }
        await editor.execRaw(ordersInsert)

        // Generate 50 products
        const productNames = ['Laptop', 'Phone', 'Tablet', 'Monitor', 'Keyboard', 'Mouse', 'Headphones', 'Webcam', 'Speaker', 'Charger', 'Cable', 'Case', 'Stand', 'Dock', 'Printer']
        const categories = ['Electronics', 'Accessories', 'Audio', 'Storage', 'Networking', 'Peripherals']

        let productsInsert = ''
        for (let i = 1; i <= 50; i++) {
          const name = productNames[i % productNames.length] + (i > 15 ? ` Pro ${Math.floor(i / 15)}` : '')
          const price = (29.99 + (i * 4.99)).toFixed(2)
          const category = categories[i % categories.length]
          const stock = 10 + (i % 100)
          productsInsert += `INSERT OR IGNORE INTO products VALUES (${i}, '${name}', ${price}, '${category}', ${stock});\n`
        }
        await editor.execRaw(productsInsert)

        // Generate sales data
        const regions = ['North', 'South', 'East', 'West', 'Central']
        const salesProducts = ['Laptop', 'Phone', 'Tablet', 'Monitor', 'Keyboard']

        let salesInsert = ''
        let salesId = 1
        for (const region of regions) {
          for (const product of salesProducts) {
            for (const month of months) {
              const quantity = 50 + Math.floor(Math.random() * 150)
              const revenue = (quantity * (100 + Math.random() * 200)).toFixed(2)
              salesInsert += `INSERT OR IGNORE INTO sales VALUES (${salesId}, '${region}', '${product}', ${quantity}, ${revenue}, '${month}');\n`
              salesId++
            }
          }
        }
        await editor.execRaw(salesInsert)

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
    // Clear charts when running new query
    setCharts([])
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

  const handleExport = useCallback((result: ExportResult) => {
    if (result.success) {
      const formatLabel = result.format === 'xlsx' ? 'Excel' : result.format.toUpperCase()
      setStatusMessage(`Successfully exported ${result.rowCount} rows to ${formatLabel} (${result.filename})!`)
    } else {
      setStatusMessage(`Export failed: ${result.error || 'Unknown error'}`)
    }
    setTimeout(() => setStatusMessage(null), 3000)
  }, [])

  // Get available columns from results
  const availableColumns = results?.columns?.map(c => c.name) || []
  
  // Filter to only numeric columns for value columns
  const numericColumns = results?.rows?.length 
    ? availableColumns.filter(col => {
        const sampleVal = results.rows[0][col]
        return typeof sampleVal === 'number'
      })
    : []

  // Chart management functions
  const addChart = () => {
    if (!results || !newChartConfig.labelColumn || !newChartConfig.valueColumns?.length) {
      setStatusMessage('Please select label and value columns')
      setTimeout(() => setStatusMessage(null), 3000)
      return
    }

    const chart: ChartConfig = {
      id: Date.now().toString(),
      type: newChartConfig.type || 'bar',
      labelColumn: newChartConfig.labelColumn,
      valueColumns: newChartConfig.valueColumns,
      title: newChartConfig.title || `Chart ${charts.length + 1}`,
    }

    setCharts([...charts, chart])
    setShowChartModal(false)
    setNewChartConfig({ type: 'bar', title: '' })
    setStatusMessage('Chart added successfully!')
    setTimeout(() => setStatusMessage(null), 3000)
  }

  const removeChart = (id: string) => {
    setCharts(charts.filter(c => c.id !== id))
  }

  const canAddChart = results && results.rows && results.rows.length > 0 && numericColumns.length > 0

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

          {isRunning ? (
            <button
              onClick={cancel}
              style={{
                fontSize: 13, fontWeight: 600, padding: '8px 18px', borderRadius: 8,
                border: 'none', backgroundColor: '#dc2626', color: '#fff', cursor: 'pointer',
                minWidth: 120,
              }}
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={handleRun}
              disabled={!dataLoaded}
              style={{
                ...btnStyle(isDark, true),
                opacity: !dataLoaded ? 0.6 : 1,
                minWidth: 120,
              }}
            >
              Run Query
            </button>
          )}
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

        {/* Chart suggestion queries */}
        <div style={{ marginTop: 16 }}>
          <h4 style={{
            margin: '0 0 8px 0', fontSize: 12, fontWeight: 600,
            color: isDark ? '#9ca3af' : '#6b7280',
            textTransform: 'uppercase', letterSpacing: '0.5px',
          }}>
            📊 Visualization Queries
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            {CHART_SUGGESTION_QUERIES.map((item, i) => (
              <button
                key={i}
                onClick={() => setSql(item.query)}
                style={{
                  fontSize: 12, padding: '8px 12px', borderRadius: 8,
                  border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                  backgroundColor: isDark ? '#1f2937' : '#fff',
                  color: isDark ? '#e4e5e7' : '#1e1e1e',
                  cursor: 'pointer',
                  textAlign: 'left' as const,
                  transition: 'all 0.15s ease',
                }}
                title={item.query}
              >
                <div style={{ fontWeight: 500, marginBottom: 2 }}>{item.name}</div>
                <div style={{ fontSize: 10, color: isDark ? '#6b7280' : '#9ca3af' }}>{item.description}</div>
              </button>
            ))}
          </div>
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
            showExport
            exportButtonText="Export"
            onExport={handleExport}
            emptyMessage="Click 'Run Query' to see results"
            style={{
              ...(isDark ? {
                '--vsql-border': '#1f2937', '--vsql-muted': '#6b7280',
                '--vsql-badge-bg': '#1e3a5f', '--vsql-badge-fg': '#60a5fa',
                '--vsql-th-bg': '#151921', '--vsql-th-fg': '#9ca3af',
                '--vsql-row-alt': '#0d0f14',
                '--vsql-export-bg': '#2563eb', '--vsql-export-fg': '#fff',
                '--vsql-dropdown-bg': '#1f2937', '--vsql-dropdown-fg': '#e4e5e7',
              } as any : {}),
            }}
          />
        </div>

        {/* Visualizations Section */}
        {canAddChart && (
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{
                margin: 0, fontSize: 14, fontWeight: 600,
                color: isDark ? '#9ca3af' : '#6b7280',
                textTransform: 'uppercase', letterSpacing: '0.5px',
              }}>
                Data Visualizations
              </h3>
              <button
                onClick={() => setShowChartModal(true)}
                style={{
                  fontSize: 13, fontWeight: 500, padding: '6px 14px', borderRadius: 8,
                  border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                  backgroundColor: isDark ? '#1f2937' : '#fff',
                  color: isDark ? '#60a5fa' : '#2563eb',
                  cursor: 'pointer',
                }}
              >
                + Add Chart
              </button>
            </div>

            {charts.length > 0 ? (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
                gap: 16,
              }}>
                {charts.map((chart) => (
                  <div
                    key={chart.id}
                    style={{
                      borderRadius: 10,
                      border: `1px solid ${isDark ? '#1f2937' : '#e5e7eb'}`,
                      backgroundColor: isDark ? '#111318' : '#fff',
                      boxShadow: isDark ? '0 2px 12px rgba(0,0,0,.3)' : '0 2px 12px rgba(0,0,0,.04)',
                      overflow: 'hidden',
                      position: 'relative',
                    }}
                  >
                    <button
                      onClick={() => removeChart(chart.id)}
                      style={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        border: 'none',
                        backgroundColor: isDark ? '#374151' : '#f3f4f6',
                        color: isDark ? '#9ca3af' : '#6b7280',
                        cursor: 'pointer',
                        fontSize: 14,
                        lineHeight: 1,
                        zIndex: 10,
                      }}
                      title="Remove chart"
                    >
                      ×
                    </button>
                    <SqlChart
                      data={results}
                      type={chart.type}
                      columns={{ labelColumn: chart.labelColumn, valueColumns: chart.valueColumns }}
                      options={{
                        title: chart.title,
                        showValues: true,
                        showGrid: true,
                        showLegend: chart.valueColumns.length > 1 || chart.type === 'pie' || chart.type === 'donut',
                        height: 280,
                        colors: isDark ? {
                          text: '#d1d5db',
                          grid: '#374151',
                          axis: '#6b7280',
                        } : undefined,
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div style={{
                padding: 32,
                textAlign: 'center',
                borderRadius: 10,
                border: `2px dashed ${isDark ? '#374151' : '#e5e7eb'}`,
                color: isDark ? '#6b7280' : '#9ca3af',
              }}>
                <p style={{ margin: 0, fontSize: 14 }}>
                  No charts yet. Click "Add Chart" to visualize your query results.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Add Chart Modal */}
        {showChartModal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}>
            <div style={{
              backgroundColor: isDark ? '#1f2937' : '#fff',
              borderRadius: 12,
              padding: 24,
              width: 400,
              maxWidth: '90vw',
              maxHeight: '90vh',
              overflow: 'auto',
            }}>
              <h3 style={{ margin: '0 0 20px 0', color: isDark ? '#e4e5e7' : '#1e1e1e' }}>
                Add New Chart
              </h3>

              {/* Chart Title */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: isDark ? '#9ca3af' : '#6b7280' }}>
                  Chart Title
                </label>
                <input
                  type="text"
                  value={newChartConfig.title || ''}
                  onChange={(e) => setNewChartConfig({ ...newChartConfig, title: e.target.value })}
                  placeholder="Enter chart title"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                    backgroundColor: isDark ? '#111827' : '#fff',
                    color: isDark ? '#e4e5e7' : '#1e1e1e',
                    fontSize: 14,
                  }}
                />
              </div>

              {/* Chart Type */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: isDark ? '#9ca3af' : '#6b7280' }}>
                  Chart Type
                </label>
                <select
                  value={newChartConfig.type || 'bar'}
                  onChange={(e) => setNewChartConfig({ ...newChartConfig, type: e.target.value as ChartType })}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                    backgroundColor: isDark ? '#111827' : '#fff',
                    color: isDark ? '#e4e5e7' : '#1e1e1e',
                    fontSize: 14,
                  }}
                >
                  {CHART_TYPES.map(ct => (
                    <option key={ct.value} value={ct.value}>{ct.label}</option>
                  ))}
                </select>
              </div>

              {/* Label Column */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: isDark ? '#9ca3af' : '#6b7280' }}>
                  Label Column (X-axis / Pie segments)
                </label>
                <select
                  value={newChartConfig.labelColumn || ''}
                  onChange={(e) => setNewChartConfig({ ...newChartConfig, labelColumn: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                    backgroundColor: isDark ? '#111827' : '#fff',
                    color: isDark ? '#e4e5e7' : '#1e1e1e',
                    fontSize: 14,
                  }}
                >
                  <option value="">Select column...</option>
                  {availableColumns.map(col => (
                    <option key={col} value={col}>{col}</option>
                  ))}
                </select>
              </div>

              {/* Value Columns */}
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: isDark ? '#9ca3af' : '#6b7280' }}>
                  Value Column(s) (Y-axis) - Numeric columns only
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {numericColumns.map(col => (
                    <label key={col} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                      backgroundColor: newChartConfig.valueColumns?.includes(col)
                        ? (isDark ? '#1e3a5f' : '#eff6ff')
                        : 'transparent',
                      cursor: 'pointer',
                      fontSize: 13,
                      color: isDark ? '#e4e5e7' : '#1e1e1e',
                    }}>
                      <input
                        type="checkbox"
                        checked={newChartConfig.valueColumns?.includes(col) || false}
                        onChange={(e) => {
                          const current = newChartConfig.valueColumns || []
                          if (e.target.checked) {
                            setNewChartConfig({ ...newChartConfig, valueColumns: [...current, col] })
                          } else {
                            setNewChartConfig({ ...newChartConfig, valueColumns: current.filter(c => c !== col) })
                          }
                        }}
                        style={{ margin: 0 }}
                      />
                      {col}
                    </label>
                  ))}
                </div>
                {numericColumns.length === 0 && (
                  <p style={{ margin: '8px 0 0', fontSize: 12, color: isDark ? '#f87171' : '#dc2626' }}>
                    No numeric columns available for charting
                  </p>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => {
                    setShowChartModal(false)
                    setNewChartConfig({ type: 'bar', title: '' })
                  }}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 6,
                    border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                    backgroundColor: 'transparent',
                    color: isDark ? '#9ca3af' : '#6b7280',
                    cursor: 'pointer',
                    fontSize: 14,
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={addChart}
                  disabled={!newChartConfig.labelColumn || !newChartConfig.valueColumns?.length}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 6,
                    border: 'none',
                    backgroundColor: (!newChartConfig.labelColumn || !newChartConfig.valueColumns?.length)
                      ? (isDark ? '#374151' : '#9ca3af')
                      : '#2563eb',
                    color: '#fff',
                    cursor: (!newChartConfig.labelColumn || !newChartConfig.valueColumns?.length)
                      ? 'not-allowed'
                      : 'pointer',
                    fontSize: 14,
                    fontWeight: 500,
                  }}
                >
                  Add Chart
                </button>
              </div>
            </div>
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
