import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue'
import {
  createSqlEditor,
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
}

export interface UseSqlEditorReturn {
  /** Template ref — bind to a container element */
  containerRef: Ref<HTMLElement | null>
  /** The underlying editor instance */
  editor: Ref<SqlEditorInstance | null>
  /** Reactive SQL value */
  sql: Ref<string>
  /** Current validation errors */
  errors: Ref<ValidationError[]>
  /** Last query result */
  results: Ref<QueryResult | null>
  /** Whether a query is currently running */
  isRunning: Ref<boolean>
  /** Execute the current query */
  run: () => Promise<QueryResult | undefined>
  /** Update SQL content */
  setSql: (value: string) => void
  /** Update schema dynamically */
  setSchema: (schema: SchemaDefinition) => void
  /** Switch dialect */
  setDialect: (dialect: SqlDialect) => void
  /** Switch theme */
  setTheme: (theme: ThemePreset | ThemeConfig) => void
}

export function useSqlEditor(options: UseSqlEditorOptions = {}): UseSqlEditorReturn {
  const containerRef = ref<HTMLElement | null>(null)
  const editor = ref<SqlEditorInstance | null>(null)
  const sql = ref(options.value ?? '')
  const errors = ref<ValidationError[]>([])
  const results = ref<QueryResult | null>(null)
  const isRunning = ref(false)

  onMounted(() => {
    const el = containerRef.value
    if (!el) return

    const instance = createSqlEditor({
      container: el,
      dialect: options.dialect,
      schema: options.schema,
      theme: options.theme,
      placeholder: options.placeholder,
      value: options.value,
      readOnly: options.readOnly,
      minHeight: options.minHeight,
      maxHeight: options.maxHeight,
      executor: options.executor,
      validateDelay: options.validateDelay,
      onChange: (value) => {
        sql.value = value
      },
      onValidate: (errs) => {
        errors.value = errs
      },
      onExecute: (_sql, result) => {
        results.value = result
        isRunning.value = false
      },
      onError: () => {
        isRunning.value = false
      },
    })

    editor.value = instance
  })

  onBeforeUnmount(() => {
    editor.value?.destroy()
    editor.value = null
  })

  async function run(): Promise<QueryResult | undefined> {
    if (!editor.value) return undefined
    isRunning.value = true
    try {
      const result = await editor.value.run()
      results.value = result ?? null
      return result
    } catch {
      return undefined
    } finally {
      isRunning.value = false
    }
  }

  function setSql(value: string) {
    editor.value?.setValue(value)
    sql.value = value
  }

  function setSchema(schema: SchemaDefinition) {
    editor.value?.setSchema(schema)
  }

  function setDialect(dialect: SqlDialect) {
    editor.value?.setDialect(dialect)
  }

  function setTheme(theme: ThemePreset | ThemeConfig) {
    editor.value?.setTheme(theme)
  }

  return {
    containerRef,
    editor: editor as Ref<SqlEditorInstance | null>,
    sql,
    errors: errors as Ref<ValidationError[]>,
    results: results as Ref<QueryResult | null>,
    isRunning,
    run,
    setSql,
    setSchema,
    setDialect,
    setTheme,
  }
}
