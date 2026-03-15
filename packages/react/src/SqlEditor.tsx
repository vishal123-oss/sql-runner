import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useMemo,
  useState,
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
  type AccessControlHints,
  type AccessControlConfig,
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
  /** Read-only mode (also can be derived from accessHints) */
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
  /** Access control hints from backend (for UI only, not security) */
  accessHints?: AccessControlHints
  /** Show access mode badge in corner (default: true if accessHints provided) */
  showAccessBadge?: boolean
  /** Local guardrails config to enforce in the editor */
  guardrails?: AccessControlConfig
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
      accessHints,
      showAccessBadge,
      guardrails,
    } = props

    // Derive effective read-only from prop or accessHints
    const effectiveReadOnly = readOnly || accessHints?.isReadOnly || false
    const shouldShowBadge = showAccessBadge ?? (accessHints != null)

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
        readOnly: effectiveReadOnly,
        minHeight,
        maxHeight,
        executor,
        validateDelay,
        guardrails,
        onChange: (val: string) => callbacksRef.current.onChange?.(val),
        onValidate: (errs: ValidationError[]) => callbacksRef.current.onValidate?.(errs),
        onExecute: (sql: string, result: QueryResult) => {
          callbacksRef.current.onExecute?.(sql, result)
        },
        onError: (err: Error, sql: string) => callbacksRef.current.onError?.(err, sql),
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
      } as any)

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

    // Access mode badge styles
    const badgeStyle: React.CSSProperties = {
      position: 'absolute',
      top: 8,
      right: 8,
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      backgroundColor: accessHints?.isReadOnly ? '#fef3c7' : '#e0e7ff',
      color: accessHints?.isReadOnly ? '#92400e' : '#3730a3',
      border: `1px solid ${accessHints?.isReadOnly ? '#fcd34d' : '#c7d2fe'}`,
      zIndex: 10,
      cursor: 'help',
    }

    const badgeLabel = accessHints?.mode
      ? accessHints.mode === 'no-access' ? 'No Access'
        : accessHints.mode === 'read-only' ? 'Read-only'
        : accessHints.mode === 'write' ? 'Write'
        : accessHints.mode === 'update' ? 'Update'
        : accessHints.mode === 'delete' ? 'Delete'
        : 'Full'
      : null

    const isNoAccess = accessHints?.mode === 'no-access'

    const [showPermissions, setShowPermissions] = useState(true)

    return (
      <div
        ref={containerRef}
        className={className ? `vsql-editor ${className}` : 'vsql-editor'}
        style={{ ...wrapperStyle, position: 'relative' }}
      >
        {shouldShowBadge && badgeLabel && (
          <div 
            style={badgeStyle} 
            title="Click to see permissions"
            onClick={() => setShowPermissions(!showPermissions)}
          >
            {badgeLabel}
          </div>
        )}
        {showPermissions && accessHints && (
          <div style={{
            position: 'absolute',
            top: 36,
            right: 8,
            backgroundColor: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            padding: 12,
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            zIndex: 20,
            fontSize: 12,
            minWidth: 200,
            color: '#374151',
          }}>
            <div style={{ fontWeight: 600, marginBottom: 8, borderBottom: '1px solid #f3f4f6', paddingBottom: 4 }}>
              Permissions: {badgeLabel}
            </div>
            <div style={{ marginBottom: 8, fontStyle: 'italic', fontSize: 11 }}>
              {accessHints.description}
            </div>
            <div>
              <div style={{ fontWeight: 500, fontSize: 11, color: '#6b7280', marginBottom: 4 }}>Allowed Actions:</div>
              <ul style={{ margin: 0, paddingLeft: 16, listStyleType: 'disc' }}>
                {getAllowedOps(accessHints).map(op => (
                  <li key={op} style={{ textTransform: 'capitalize' }}>{op.replace('_', ' ')}</li>
                ))}
              </ul>
            </div>
            {accessHints.disabledOperations && accessHints.disabledOperations.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontWeight: 500, fontSize: 11, color: '#991b1b', marginBottom: 4 }}>Blocked Actions:</div>
                <ul style={{ margin: 0, paddingLeft: 16, listStyleType: 'disc', color: '#991b1b' }}>
                  {accessHints.disabledOperations.map(op => (
                    <li key={op} style={{ textTransform: 'capitalize' }}>{op.replace('_', ' ')}</li>
                  ))}
                </ul>
              </div>
            )}
            <button 
              onClick={() => setShowPermissions(false)}
              style={{
                marginTop: 12,
                width: '100%',
                padding: '4px 0',
                backgroundColor: '#f3f4f6',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              Close
            </button>
          </div>
        )}
        {isNoAccess && (
          <div style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(255, 255, 255, 0.7)',
            backdropFilter: 'blur(1px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 5,
            color: '#991b1b',
            fontWeight: 500,
          }}>
            {accessHints?.description || 'Access restricted'}
          </div>
        )}
      </div>
    )
  },
)

function getAllowedOps(hints: AccessControlHints): string[] {
  const allOps: string[] = ['select', 'insert', 'update', 'delete', 'ddl_read', 'ddl_write', 'dcl', 'transaction', 'admin']
  const disabled = hints.disabledOperations || []
  return allOps.filter(op => !disabled.includes(op as any))
}
