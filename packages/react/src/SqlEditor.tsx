import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useMemo,
} from 'react'
import {
  createSqlEditor,
  type SqlEditorConfig,
  type SqlEditorInstance,
  type SqlDialect,
  type SchemaDefinition,
  type ThemePreset,
  type ThemeConfig,
  type ValidationError,
  type QueryResult,
} from '@vsql/core'

export interface SqlEditorProps {
  /** SQL dialect */
  dialect?: SqlDialect
  /** Database schema for autocomplete */
  schema?: SchemaDefinition
  /** Theme preset or custom theme */
  theme?: ThemePreset | ThemeConfig
  /** Controlled SQL value */
  value?: string
  /** Default SQL value (uncontrolled) */
  defaultValue?: string
  /** Placeholder text */
  placeholder?: string
  /** Read-only mode */
  readOnly?: boolean
  /** Minimum height in pixels */
  minHeight?: number
  /** Maximum height in pixels */
  maxHeight?: number
  /** Executor config */
  executor?: SqlEditorConfig['executor']
  /** Validation debounce delay in ms */
  validateDelay?: number
  /** CSS class name for the wrapper */
  className?: string
  /** Inline styles for the wrapper */
  style?: React.CSSProperties
  /** Called when content changes */
  onChange?: (value: string) => void
  /** Called when validation runs */
  onValidate?: (errors: ValidationError[]) => void
  /** Called when a query executes successfully */
  onExecute?: (sql: string, result: QueryResult) => void
  /** Called on execution error */
  onError?: (error: Error, sql: string) => void
  /** Called on Ctrl/Cmd+Enter */
  onRun?: () => void
}

export interface SqlEditorRef {
  /** The underlying core editor instance */
  instance: SqlEditorInstance | null
  /** Execute the current query */
  run: () => Promise<QueryResult | undefined>
  /** Get current SQL value */
  getValue: () => string
  /** Set SQL value */
  setValue: (sql: string) => void
  /** Focus the editor */
  focus: () => void
}

export const SqlEditor = forwardRef<SqlEditorRef, SqlEditorProps>(
  function SqlEditor(props, ref) {
    const {
      dialect = 'standard',
      schema = {},
      theme = 'light',
      value,
      defaultValue = '',
      placeholder,
      readOnly = false,
      minHeight = 120,
      maxHeight,
      executor = 'none',
      validateDelay = 300,
      className,
      style,
      onChange,
      onValidate,
      onExecute,
      onError,
      onRun,
    } = props

    const containerRef = useRef<HTMLDivElement>(null)
    const editorRef = useRef<SqlEditorInstance | null>(null)
    const callbacksRef = useRef({ onChange, onValidate, onExecute, onError, onRun })
    callbacksRef.current = { onChange, onValidate, onExecute, onError, onRun }

    // Initialize editor
    useEffect(() => {
      const el = containerRef.current
      if (!el) return

      const instance = createSqlEditor({
        container: el,
        dialect,
        schema,
        theme,
        placeholder,
        value: value ?? defaultValue,
        readOnly,
        minHeight,
        maxHeight,
        executor,
        validateDelay,
        onChange: (val) => callbacksRef.current.onChange?.(val),
        onValidate: (errs) => callbacksRef.current.onValidate?.(errs),
        onExecute: (sql, result) => {
          callbacksRef.current.onExecute?.(sql, result)
        },
        onError: (err, sql) => callbacksRef.current.onError?.(err, sql),
        keyBindings: [
          {
            key: 'Mod-Enter',
            run: () => {
              callbacksRef.current.onRun?.()
              return true
            },
            preventDefault: true,
          },
        ],
      })

      editorRef.current = instance

      return () => {
        instance.destroy()
        editorRef.current = null
      }
      // Only re-create on mount. Dynamic updates go through reconfigure effects below.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Sync controlled value
    useEffect(() => {
      if (value !== undefined && editorRef.current) {
        const current = editorRef.current.getValue()
        if (current !== value) {
          editorRef.current.setValue(value)
        }
      }
    }, [value])

    // Sync dialect
    useEffect(() => {
      editorRef.current?.setDialect(dialect)
    }, [dialect])

    // Sync schema
    const schemaKey = useMemo(() => JSON.stringify(schema), [schema])
    useEffect(() => {
      editorRef.current?.setSchema(schema)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [schemaKey])

    // Sync theme
    const themeKey = useMemo(
      () => (typeof theme === 'string' ? theme : JSON.stringify(theme)),
      [theme],
    )
    useEffect(() => {
      editorRef.current?.setTheme(theme)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [themeKey])

    // Imperative handle
    useImperativeHandle(ref, () => ({
      instance: editorRef.current,
      async run() {
        return editorRef.current?.run()
      },
      getValue() {
        return editorRef.current?.getValue() ?? ''
      },
      setValue(sql: string) {
        editorRef.current?.setValue(sql)
      },
      focus() {
        editorRef.current?.focus()
      },
    }))

    const wrapperStyle: React.CSSProperties = {
      border: '1px solid var(--vsql-border, #e5e7eb)',
      borderRadius: '8px',
      overflow: 'hidden',
      ...style,
    }

    return (
      <div
        ref={containerRef}
        className={className ? `vsql-editor ${className}` : 'vsql-editor'}
        style={wrapperStyle}
      />
    )
  },
)
