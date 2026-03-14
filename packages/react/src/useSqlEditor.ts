import { useRef, useState, useCallback, useEffect } from 'react'
import {
  createSqlEditor,
  validateAccessControl,
  type SqlEditorConfig,
  type SqlEditorInstance,
  type QueryResult,
  type ValidationError,
  type SchemaDefinition,
  type SqlDialect,
  type ThemePreset,
  type ThemeConfig,
  type AccessControlHints,
  type AccessMode,
  type AccessControlResult,
  type AccessControlConfig,
} from '@vsql/core'

export interface UseSqlEditorOptions {
  dialect?: SqlDialect
  schema?: SchemaDefinition
  theme?: ThemePreset | ThemeConfig
  executor?: SqlEditorConfig['executor']
  placeholder?: string
  value?: string
  readOnly?: boolean
  minHeight?: number
  maxHeight?: number
  validateDelay?: number
  onChange?: (value: string) => void
  /** Access control hints from backend (for UI only, not security) */
  accessHints?: AccessControlHints
  /** Local guardrails config to enforce in the editor */
  guardrails?: AccessControlConfig
}

export interface UseSqlEditorReturn {
  /** Ref callback — attach to a container div */
  containerRef: (el: HTMLDivElement | null) => void
  /** The underlying editor instance (null until mounted) */
  editor: SqlEditorInstance | null
  /** Current SQL value */
  sql: string
  /** Current validation errors */
  errors: ValidationError[]
  /** Last query result */
  results: QueryResult | null
  /** Current query validation result against guardrails */
  guardrailResult: AccessControlResult | null
  /** Whether a query is currently executing */
  isRunning: boolean
  /** Execute the current query */
  run: (options?: { page?: number; pageSize?: number }) => Promise<QueryResult | undefined>
  /** Set the SQL content */
  setSql: (value: string) => void
  /** Update schema dynamically */
  setSchema: (schema: SchemaDefinition) => void
  /** Switch dialect */
  setDialect: (dialect: SqlDialect) => void
  /** Switch theme */
  setTheme: (theme: ThemePreset | ThemeConfig) => void
  /** Access control hints (from backend, for UI display) */
  accessHints: AccessControlHints | null
  /** Quick check: is this editor in read-only mode? */
  isReadOnly: boolean
  /** Access mode label for display (e.g., "Read-only", "Write", "Full") */
  accessModeLabel: string
  /** Refresh access hints from the executor */
  refreshAccessHints: () => Promise<void>
}

export function useSqlEditor(options: UseSqlEditorOptions = {}): UseSqlEditorReturn {
  const [sql, setSqlState] = useState(options.value ?? '')
  const [errors, setErrors] = useState<ValidationError[]>([])
  const [results, setResults] = useState<QueryResult | null>(null)
  const [guardrailResult, setGuardrailResult] = useState<AccessControlResult | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [editorInstance, setEditorInstance] = useState<SqlEditorInstance | null>(null)
  const [accessHints, setAccessHints] = useState<AccessControlHints | null>(options.accessHints ?? null)

  const editorRef = useRef<SqlEditorInstance | null>(null)
  const containerElRef = useRef<HTMLDivElement | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const refreshAccessHints = useCallback(async () => {
    const executor = optionsRef.current.executor
    if (executor && typeof executor === 'object' && 'getAccessHints' in executor) {
      const adapter = executor as { getAccessHints?: () => Promise<AccessControlHints | null> }
      try {
        const hints = await adapter.getAccessHints?.()
        if (hints) setAccessHints(hints)
      } catch (e) {
        console.error('Failed to fetch access hints:', e)
      }
    }
  }, [])

  // Fetch access hints from adapter if available
  useEffect(() => {
    if (options.accessHints) {
      setAccessHints(options.accessHints)
      return
    }
    refreshAccessHints()
  }, [options.accessHints, refreshAccessHints])

  // Re-validate guardrails when guardrails config changes
  useEffect(() => {
    if (options.guardrails && sql) {
      try {
        const res = validateAccessControl(sql, options.guardrails)
        setGuardrailResult(res)
      } catch (e) {
        setGuardrailResult(null)
      }
    }
  }, [options.guardrails, sql])

  const containerRef = useCallback((el: HTMLDivElement | null) => {
    if (containerElRef.current === el) return

    if (editorRef.current) {
      editorRef.current.destroy()
      editorRef.current = null
      setEditorInstance(null)
    }

    containerElRef.current = el
    if (!el) return

    const opts = optionsRef.current
    const instance = createSqlEditor({
      container: el,
      dialect: opts.dialect,
      schema: opts.schema,
      theme: opts.theme,
      placeholder: opts.placeholder,
      value: opts.value,
      readOnly: opts.readOnly,
      minHeight: opts.minHeight,
      maxHeight: opts.maxHeight,
      executor: opts.executor,
      validateDelay: opts.validateDelay,
      guardrails: opts.guardrails,
      onChange: (value) => {
        setSqlState(value)
        optionsRef.current.onChange?.(value)
        
        // Real-time guardrail validation
        if (optionsRef.current.guardrails) {
          try {
            const res = validateAccessControl(value, optionsRef.current.guardrails)
            setGuardrailResult(res)
          } catch (e) {
            // If SQL is invalid, we might not be able to classify it yet
            setGuardrailResult(null)
          }
        }
      },
      onValidate: (errs) => {
        setErrors(errs)
      },
      onExecute: (_sql, result) => {
        setResults(result)
      },
      onError: () => {
      },
    } as any) // Cast as any because createSqlEditor now takes SqlEditorConfigWithGuardrails

    editorRef.current = instance
    setEditorInstance(instance)
  }, [])

  useEffect(() => {
    return () => {
      editorRef.current?.destroy()
      editorRef.current = null
    }
  }, [])

  const run = useCallback(async (options?: { page?: number; pageSize?: number }) => {
    if (!editorRef.current) return undefined
    setIsRunning(true)
    try {
      const result = await (editorRef.current as any).run(options)
      setResults(result ?? null)
      return result
    } catch (err) {
      throw err
    } finally {
      setIsRunning(false)
    }
  }, [])

  const setSql = useCallback((value: string) => {
    editorRef.current?.setValue(value)
    setSqlState(value)
  }, [])

  const setSchema = useCallback((schema: SchemaDefinition) => {
    editorRef.current?.setSchema(schema)
  }, [])

  const setDialect = useCallback((dialect: SqlDialect) => {
    editorRef.current?.setDialect(dialect)
  }, [])

  const setTheme = useCallback((theme: ThemePreset | ThemeConfig) => {
    editorRef.current?.setTheme(theme)
  }, [])

  // Compute derived values from accessHints
  const isReadOnly = accessHints?.isReadOnly ?? options.readOnly ?? false
  const accessModeLabel = getAccessModeLabel(accessHints?.mode ?? 'full')

  return {
    containerRef,
    editor: editorInstance,
    sql,
    errors,
    results,
    guardrailResult,
    isRunning,
    run,
    setSql,
    setSchema,
    setDialect,
    setTheme,
    accessHints,
    isReadOnly,
    accessModeLabel,
    refreshAccessHints,
  }
}

/**
 * Get human-readable label for access mode.
 */
function getAccessModeLabel(mode: AccessMode): string {
  switch (mode) {
    case 'read-only':
      return 'Read-only'
    case 'write':
      return 'Write'
    case 'update':
      return 'Update'
    case 'delete':
      return 'Delete'
    case 'full':
    default:
      return 'Full Access'
  }
}
