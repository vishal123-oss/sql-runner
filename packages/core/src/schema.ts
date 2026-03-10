import type { SchemaDefinition, ColumnSpec, ColumnDefinition } from './types'

/**
 * CodeMirror @codemirror/lang-sql accepts schema as:
 *   Record<string, string[]>               — table → column names
 *   Record<string, Record<string, ...>>    — schema → table → columns (nested)
 *
 * This module normalizes our richer `SchemaDefinition` into the shape
 * CodeMirror expects.
 */

export type CodeMirrorSchema = Record<string, readonly string[]>

function normalizeColumn(col: ColumnSpec): string {
  if (typeof col === 'string') return col
  return col.name
}

/**
 * Convert the user-facing `SchemaDefinition` into the flat
 * `{ tableName: [col, ...] }` shape CodeMirror uses.
 *
 * Handles both flat (`{ users: ['id', 'name'] }`) and nested
 * (`{ public: { users: ['id'] } }`) schemas.
 */
export function toCodeMirrorSchema(schema: SchemaDefinition): CodeMirrorSchema {
  const result: Record<string, string[]> = {}

  for (const [key, value] of Object.entries(schema)) {
    if (Array.isArray(value)) {
      result[key] = value.map(normalizeColumn)
    } else {
      for (const [tableName, columns] of Object.entries(value)) {
        const qualifiedName = `${key}.${tableName}`
        const cols = (columns as ColumnSpec[]).map(normalizeColumn)
        result[qualifiedName] = cols
        result[tableName] = cols
      }
    }
  }

  return result
}

/**
 * Extract all table names from a schema definition.
 */
export function getTableNames(schema: SchemaDefinition): string[] {
  const names: string[] = []
  for (const [key, value] of Object.entries(schema)) {
    if (Array.isArray(value)) {
      names.push(key)
    } else {
      for (const tableName of Object.keys(value)) {
        names.push(tableName)
        names.push(`${key}.${tableName}`)
      }
    }
  }
  return names
}

/**
 * Extract all column names from a schema definition (flattened, deduplicated).
 */
export function getAllColumns(schema: SchemaDefinition): string[] {
  const cols = new Set<string>()
  for (const value of Object.values(schema)) {
    const columns: ColumnSpec[] = Array.isArray(value)
      ? value
      : Object.values(value).flat() as ColumnSpec[]
    for (const col of columns) {
      cols.add(normalizeColumn(col))
    }
  }
  return Array.from(cols)
}

/**
 * Extract rich column info for a given table (for tooltip/docs).
 */
export function getColumnsForTable(
  schema: SchemaDefinition,
  tableName: string,
): ColumnDefinition[] {
  for (const [key, value] of Object.entries(schema)) {
    if (Array.isArray(value) && key === tableName) {
      return value.map((c) =>
        typeof c === 'string' ? { name: c } : c,
      )
    }
    if (!Array.isArray(value) && tableName in value) {
      const cols = value[tableName] as ColumnSpec[]
      return cols.map((c) => (typeof c === 'string' ? { name: c } : c))
    }
  }
  return []
}
