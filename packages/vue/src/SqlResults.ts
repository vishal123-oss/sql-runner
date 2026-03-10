import { defineComponent, h, type PropType } from 'vue'
import type { QueryResult } from '@vsql/core'

export const SqlResults = defineComponent({
  name: 'SqlResults',

  props: {
    data: {
      type: Object as PropType<QueryResult | null>,
      default: null,
    },
    maxHeight: {
      type: Number,
      default: 400,
    },
    showRowCount: {
      type: Boolean,
      default: true,
    },
    showElapsed: {
      type: Boolean,
      default: true,
    },
    emptyMessage: {
      type: String,
      default: 'Run a query to see results',
    },
  },

  setup(props) {
    function formatCell(value: unknown): string {
      if (value === null || value === undefined) return 'NULL'
      if (typeof value === 'object') return JSON.stringify(value)
      return String(value)
    }

    return () => {
      const { data, maxHeight, showRowCount, showElapsed, emptyMessage } = props

      if (!data) {
        return h(
          'div',
          { class: 'vsql-results vsql-results--empty' },
          h('p', { style: styles.empty }, emptyMessage),
        )
      }

      if (data.columns.length === 0) {
        return h('div', { class: 'vsql-results vsql-results--success' }, [
          h('div', { style: styles.meta }, [
            h('span', { style: styles.badge }, 'Query executed successfully'),
            showElapsed && data.elapsed != null
              ? h('span', { style: styles.elapsed }, `${data.elapsed}ms`)
              : null,
          ]),
        ])
      }

      return h('div', { class: 'vsql-results' }, [
        (showRowCount || showElapsed)
          ? h('div', { style: styles.meta }, [
              showRowCount
                ? h('span', { style: styles.badge },
                    `${data.rowCount} row${data.rowCount !== 1 ? 's' : ''}`)
                : null,
              showElapsed && data.elapsed != null
                ? h('span', { style: styles.elapsed }, `${data.elapsed}ms`)
                : null,
            ])
          : null,

        h('div', { style: { ...styles.scroll, maxHeight: `${maxHeight}px` } }, [
          h('table', { style: styles.table }, [
            h('thead', null, [
              h('tr', null,
                data.columns.map((col, i) =>
                  h('th', { key: i, style: styles.th }, col.name),
                ),
              ),
            ]),
            h('tbody', null,
              data.rows.map((row, ri) =>
                h(
                  'tr',
                  { key: ri, style: ri % 2 !== 0 ? styles.rowOdd : undefined },
                  data.columns.map((col, ci) =>
                    h('td', { key: ci, style: styles.td }, formatCell(row[col.name])),
                  ),
                ),
              ),
            ),
          ]),
        ]),
      ])
    }
  },
})

const styles: Record<string, Record<string, string>> = {
  empty: {
    margin: '0',
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
    fontWeight: '500',
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
    top: '0',
    padding: '8px 12px',
    textAlign: 'left',
    fontWeight: '600',
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
  rowOdd: {
    backgroundColor: 'var(--vsql-row-alt, #f9fafb)',
  },
}
