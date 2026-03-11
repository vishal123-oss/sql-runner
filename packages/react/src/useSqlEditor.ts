import { useRef, useState, useCallback, useEffect } from 'react'
import {
  createSqlEditor,
  QueryCancelledError,
  type SqlEditorConfig,
  type SqlEditorInstance,
  type QueryResult,
  type ValidationError,
  type SchemaDefinition,
  type SqlDialect,
  type ThemePreset,
  type ThemeConfig,
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
  /** Whether a query is currently executing */
  isRunning: boolean
  /** Execute the current query */
  run: () => Promise<QueryResult | undefined>
  /** Cancel the currently running query */
  cancel: () => void
  /** Set the SQL content */
  setSql: (value: string) => void
  /** Update schema dynamically */
  setSchema: (schema: SchemaDefinition) => void
  /** Switch dialect */
  setDialect: (dialect: SqlDialect) => void
  /** Switch theme */
  setTheme: (theme: ThemePreset | ThemeConfig) => void
}

export function useSqlEditor(options: UseSqlEditorOptions = {}): UseSqlEditorReturn {
  const [sql, setSqlState] = useState(options.value ?? '')
  const [errors, setErrors] = useState<ValidationError[]>([])
  const [results, setResults] = useState<QueryResult | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [editorInstance, setEditorInstance] = useState<SqlEditorInstance | null>(null)

  const editorRef = useRef<SqlEditorInstance | null>(null)
  const containerElRef = useRef<HTMLDivElement | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

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
      onChange: (value) => {
        setSqlState(value)
        optionsRef.current.onChange?.(value)
      },
      onValidate: (errs) => {
        setErrors(errs)
      },
      onExecute: (_sql, result) => {
        setResults(result)
      },
      onError: () => {
      },
    })

    editorRef.current = instance
    setEditorInstance(instance)
  }, [])

  useEffect(() => {
    return () => {
      editorRef.current?.destroy()
      editorRef.current = null
    }
  }, [])

  const run = useCallback(async () => {
    if (!editorRef.current) return undefined
    setIsRunning(true)
    try {
      const result = await editorRef.current.run()
      // result will be undefined if cancelled
      if (result !== undefined) {
        setResults(result)
      }
      return result
    } catch (err) {
      // Don't throw cancellation errors
      if (err instanceof QueryCancelledError || (err as any)?.name === 'QueryCancelledError') {
        return undefined
      }
      throw err
    } finally {
      setIsRunning(false)
    }
  }, [])

  const cancel = useCallback(() => {
    if (editorRef.current) {
      editorRef.current.cancel()
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

  return {
    containerRef,
    editor: editorInstance,
    sql,
    errors,
    results,
    isRunning,
    run,
    cancel,
    setSql,
    setSchema,
    setDialect,
    setTheme,
  }
}
