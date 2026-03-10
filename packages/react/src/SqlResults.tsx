import type { QueryResult } from '@vsql/core'

export interface SqlResultsProps {
  /** Query result data to display */
  data: QueryResult | null
  /** CSS class name */
  className?: string
  /** Inline styles */
  style?: React.CSSProperties
  /** Max height for scrollable area (default: 400px) */
  maxHeight?: number
  /** Show row count badge */
  showRowCount?: boolean
  /** Show execution time */
  showElapsed?: boolean
  /** Empty state message */
  emptyMessage?: string
}

export function SqlResults({
  data,
  className,
  style,
  maxHeight = 400,
  showRowCount = true,
  showElapsed = true,
  emptyMessage = 'Run a query to see results',
}: SqlResultsProps) {
  if (!data) {
    return (
      <div className={cls('vsql-results vsql-results--empty', className)} style={style}>
        <p style={styles.empty}>{emptyMessage}</p>
      </div>
    )
  }

  if (data.columns.length === 0) {
    return (
      <div className={cls('vsql-results vsql-results--success', className)} style={style}>
        <div style={styles.meta}>
          <span style={styles.badge}>Query executed successfully</span>
          {showElapsed && data.elapsed != null && (
            <span style={styles.elapsed}>{data.elapsed}ms</span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={cls('vsql-results', className)} style={style}>
      {(showRowCount || showElapsed) && (
        <div style={styles.meta}>
          {showRowCount && (
            <span style={styles.badge}>
              {data.rowCount} row{data.rowCount !== 1 ? 's' : ''}
            </span>
          )}
          {showElapsed && data.elapsed != null && (
            <span style={styles.elapsed}>{data.elapsed}ms</span>
          )}
        </div>
      )}

      <div style={{ ...styles.scroll, maxHeight }}>
        <table style={styles.table}>
          <thead>
            <tr>
              {data.columns.map((col, i) => (
                <th key={i} style={styles.th}>
                  {col.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, ri) => (
              <tr key={ri} style={ri % 2 === 0 ? styles.rowEven : styles.rowOdd}>
                {data.columns.map((col, ci) => (
                  <td key={ci} style={styles.td}>
                    {formatCell(row[col.name])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function cls(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const styles: Record<string, React.CSSProperties> = {
  empty: {
    margin: 0,
    padding: '24px',
    textAlign: 'center',
    color: 'var(--vsql-muted, #9ca3af)',
    fontSize: '14px',
  },
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    fontSize: '12px',
    borderBottom: '1px solid var(--vsql-border, #e5e7eb)',
  },
  badge: {
    padding: '2px 8px',
    borderRadius: '9999px',
    backgroundColor: 'var(--vsql-badge-bg, #eff6ff)',
    color: 'var(--vsql-badge-fg, #2563eb)',
    fontWeight: 500,
    fontSize: '12px',
  },
  elapsed: {
    color: 'var(--vsql-muted, #9ca3af)',
    fontSize: '12px',
  },
  scroll: {
    overflow: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  th: {
    position: 'sticky',
    top: 0,
    padding: '8px 12px',
    textAlign: 'left',
    fontWeight: 600,
    fontSize: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    backgroundColor: 'var(--vsql-th-bg, #f8f9fb)',
    color: 'var(--vsql-th-fg, #6b7280)',
    borderBottom: '2px solid var(--vsql-border, #e5e7eb)',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '6px 12px',
    borderBottom: '1px solid var(--vsql-border, #f3f4f6)',
    whiteSpace: 'nowrap',
    maxWidth: '300px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  rowEven: {},
  rowOdd: {
    backgroundColor: 'var(--vsql-row-alt, #f9fafb)',
  },
}
