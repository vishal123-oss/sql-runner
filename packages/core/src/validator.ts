import { linter, type Diagnostic } from '@codemirror/lint'
import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { SqlDialect, ValidationError } from './types'

// ---------------------------------------------------------------------------
// Dialect → node-sql-parser database mapping
// ---------------------------------------------------------------------------

const DIALECT_MAP: Record<SqlDialect, string> = {
  mysql: 'MySQL',
  postgresql: 'PostgreSQL',
  sqlite: 'SQLite',
  mssql: 'TransactSQL',
  mariadb: 'MariaDB',
  standard: 'MySQL',
}

// ---------------------------------------------------------------------------
// Lazy-loaded parser singleton
// ---------------------------------------------------------------------------

import { Parser } from 'node-sql-parser'

let parserInstance: Parser | null = null

function getParser(): Parser {
  if (!parserInstance) {
    parserInstance = new Parser()
  }
  return parserInstance
}

// ---------------------------------------------------------------------------
// Core validation logic
// ---------------------------------------------------------------------------

export function validateSql(
  sql: string,
  dialect: SqlDialect = 'standard',
): ValidationError[] {
  if (!sql.trim()) return []

  const parser = getParser()
  const database = DIALECT_MAP[dialect]
  const errors: ValidationError[] = []

  try {
    parser.astify(sql, { database })
  } catch (e: any) {
    const msg: string = e.message || String(e)
    const { line, column, offset } = parseErrorPosition(msg, sql)

    errors.push({
      message: cleanErrorMessage(msg),
      line,
      column,
      offset,
      severity: 'error',
    })
  }

  return errors
}

// ---------------------------------------------------------------------------
// Parse error positions from node-sql-parser messages
// ---------------------------------------------------------------------------

function parseErrorPosition(
  message: string,
  sql: string,
): { line: number; column: number; offset: number } {
  // node-sql-parser error messages may contain position info like:
  // "...at line N column C..."  or reference a token position
  const lineMatch = message.match(/line\s+(\d+)/i)
  const colMatch = message.match(/column\s+(\d+)/i)

  if (lineMatch && colMatch) {
    const line = Math.max(0, parseInt(lineMatch[1], 10) - 1)
    const col = Math.max(0, parseInt(colMatch[1], 10) - 1)
    const offset = getOffset(sql, line, col)
    return { line, column: col, offset }
  }

  // Fallback: try to find the problematic token in the error message
  const tokenMatch = message.match(/(?:near|at)\s+"([^"]+)"/i)
    || message.match(/(?:near|at)\s+'([^']+)'/i)
  if (tokenMatch) {
    const token = tokenMatch[1]
    const idx = sql.lastIndexOf(token)
    if (idx !== -1) {
      const { line, col } = getLineCol(sql, idx)
      return { line, column: col, offset: idx }
    }
  }

  // Last resort: point at the end of the input
  const lastLine = sql.split('\n').length - 1
  return { line: lastLine, column: 0, offset: Math.max(0, sql.length - 1) }
}

function getOffset(sql: string, line: number, col: number): number {
  const lines = sql.split('\n')
  let offset = 0
  for (let i = 0; i < line && i < lines.length; i++) {
    offset += lines[i].length + 1
  }
  return offset + col
}

function getLineCol(sql: string, offset: number): { line: number; col: number } {
  const before = sql.slice(0, offset)
  const lines = before.split('\n')
  return { line: lines.length - 1, col: lines[lines.length - 1].length }
}

function cleanErrorMessage(msg: string): string {
  return msg
    .replace(/^(Syntax error|Parse error):\s*/i, '')
    .replace(/\s+at\s+line\s+\d+.*$/i, '')
    .trim()
    || msg.trim()
}

// ---------------------------------------------------------------------------
// CodeMirror linter extension
// ---------------------------------------------------------------------------

export function createSqlLinter(
  dialect: SqlDialect,
  delay: number,
  onValidate?: (errors: ValidationError[]) => void,
): Extension {
  return linter(
    (view: EditorView): Diagnostic[] => {
      const sql = view.state.doc.toString()
      const errors = validateSql(sql, dialect)

      onValidate?.(errors)

      return errors.map((err) => {
        const from = Math.min(err.offset, sql.length)
        const lineEnd = sql.indexOf('\n', from)
        const to = Math.min(
          lineEnd === -1 ? sql.length : lineEnd,
          from + 50,
        )

        return {
          from,
          to: Math.max(to, from + 1),
          severity: err.severity,
          message: err.message,
        }
      })
    },
    { delay },
  )
}
