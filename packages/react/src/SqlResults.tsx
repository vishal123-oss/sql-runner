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
  /** Callback for page change */
  onPageChange?: (page: number, pageSize: number) => void
  /** Pagination UI variant: 'simple' | 'full' | 'compact' */
  paginationVariant?: 'simple' | 'full' | 'compact'
}

export function SqlResults({
  data,
  className,
  style,
  maxHeight = 400,
  showRowCount = true,
  showElapsed = true,
  emptyMessage = 'Run a query to see results',
  onPageChange,
  paginationVariant = 'full',
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

  const isPaginated = data.pageSize != null && data.page != null && data.totalCount != null
  const totalPages = isPaginated ? Math.ceil(data.totalCount! / data.pageSize!) : 0

  return (
    <div className={cls('vsql-results', className)} style={style}>
      {(showRowCount || showElapsed || isPaginated) && (
        <div style={styles.meta}>
          {showRowCount && (
            <span style={styles.badge}>
              {isPaginated ? `${data.totalCount} total rows` : `${data.rowCount} row${data.rowCount !== 1 ? 's' : ''}`}
            </span>
          )}
          {showElapsed && data.elapsed != null && (
            <span style={styles.elapsed}>{data.elapsed}ms</span>
          )}
          <div style={{ flex: 1 }} />
          {isPaginated && paginationVariant === 'compact' && (
            <div style={styles.paginationCompact}>
              <button
                disabled={data.page === 0}
                onClick={() => onPageChange?.(data.page! - 1, data.pageSize!)}
                style={styles.pageBtn}
              >
                &lt;
              </button>
              <span style={styles.pageInfo}>
                {data.page! + 1} / {totalPages}
              </span>
              <button
                disabled={data.page! >= totalPages - 1}
                onClick={() => onPageChange?.(data.page! + 1, data.pageSize!)}
                style={styles.pageBtn}
              >
                &gt;
              </button>
            </div>
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

      {isPaginated && (paginationVariant === 'full' || paginationVariant === 'simple') && (
        <div style={styles.footer}>
          <div style={styles.pagination}>
            <button
              disabled={data.page === 0}
              onClick={() => onPageChange?.(0, data.pageSize!)}
              style={styles.pageBtn}
              title="First Page"
            >
              &laquo;
            </button>
            <button
              disabled={data.page === 0}
              onClick={() => onPageChange?.(data.page! - 1, data.pageSize!)}
              style={styles.pageBtn}
              title="Previous Page"
            >
              &lt;
            </button>
            
            {paginationVariant === 'full' && (
              <div style={styles.pageNumbers}>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum = i
                  if (totalPages > 5) {
                    if (data.page! > 2) pageNum = data.page! - 2 + i
                    if (pageNum >= totalPages) pageNum = totalPages - 5 + i
                    if (pageNum < 0) pageNum = i
                  }
                  
                  return (
                    <button
                      key={pageNum}
                      onClick={() => onPageChange?.(pageNum, data.pageSize!)}
                      style={{
                        ...styles.pageBtn,
                        ...(data.page === pageNum ? styles.pageBtnActive : {})
                      }}
                    >
                      {pageNum + 1}
                    </button>
                  )
                })}
              </div>
            )}

            <span style={styles.pageInfo}>
              Page {data.page! + 1} of {totalPages}
            </span>

            <button
              disabled={data.page! >= totalPages - 1}
              onClick={() => onPageChange?.(data.page! + 1, data.pageSize!)}
              style={styles.pageBtn}
              title="Next Page"
            >
              &gt;
            </button>
            <button
              disabled={data.page! >= totalPages - 1}
              onClick={() => onPageChange?.(totalPages - 1, data.pageSize!)}
              style={styles.pageBtn}
              title="Last Page"
            >
              &raquo;
            </button>
          </div>

          {paginationVariant === 'full' && (
            <div style={styles.pageSize}>
              <span>Rows per page:</span>
              <select
                value={data.pageSize}
                onChange={(e) => onPageChange?.(0, parseInt(e.target.value))}
                style={styles.pageSizeSelect}
              >
                {[10, 25, 50, 100].map(size => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
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
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderTop: '1px solid var(--vsql-border, #e5e7eb)',
    fontSize: '12px',
    color: 'var(--vsql-muted, #6b7280)',
    flexWrap: 'wrap',
    gap: '12px',
  },
  pagination: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  paginationCompact: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  pageNumbers: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    margin: '0 8px',
  },
  pageBtn: {
    padding: '4px 8px',
    borderRadius: '4px',
    border: '1px solid var(--vsql-border, #e5e7eb)',
    backgroundColor: 'var(--vsql-bg, #fff)',
    color: 'var(--vsql-fg, #374151)',
    fontSize: '11px',
    cursor: 'pointer',
    minWidth: '28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageBtnActive: {
    backgroundColor: 'var(--vsql-primary, #2563eb)',
    color: '#fff',
    borderColor: 'var(--vsql-primary, #2563eb)',
  },
  pageInfo: {
    margin: '0 8px',
    fontSize: '11px',
  },
  pageSize: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  pageSizeSelect: {
    padding: '2px 4px',
    borderRadius: '4px',
    border: '1px solid var(--vsql-border, #e5e7eb)',
    backgroundColor: 'var(--vsql-bg, #fff)',
    color: 'var(--vsql-fg, #374151)',
    fontSize: '11px',
    cursor: 'pointer',
  },
}
