import { EditorView, keymap, placeholder as placeholderExt, lineNumbers } from '@codemirror/view'
import { EditorState, Compartment, type Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { sql, MySQL, PostgreSQL, SQLite, StandardSQL, MariaSQL, MSSQL } from '@codemirror/lang-sql'
import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { bracketMatching, foldGutter, indentOnInput } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { lintGutter } from '@codemirror/lint'

import type {
  SqlEditorConfig,
  SqlEditorInstance,
  SqlDialect,
  SchemaDefinition,
  ThemePreset,
  ThemeConfig,
  ValidationError,
  QueryResult,
  DatabaseAdapter,
  AccessControlConfig,
} from './types'

import { buildTheme } from './theme'
import { toCodeMirrorSchema } from './schema'
import { validateSql, createSqlLinter } from './validator'
import { LocalExecutor, AdapterExecutor, QueryCancelledError } from './executor'
import { sqlFunctionCompletions } from './completions'

// ---------------------------------------------------------------------------
// Dialect mapping
// ---------------------------------------------------------------------------

function getDialectConfig(dialect: SqlDialect) {
  switch (dialect) {
    case 'mysql':
      return MySQL
    case 'postgresql':
      return PostgreSQL
    case 'sqlite':
      return SQLite
    case 'mssql':
      return MSSQL
    case 'mariadb':
      return MariaSQL
    case 'standard':
    default:
      return StandardSQL
  }
}

/**
 * Extended editor config with guardrails.
 */
export interface SqlEditorConfigWithGuardrails extends SqlEditorConfig {
  /**
   * Access control guardrails.
   * If provided, the editor will enforce these rules locally.
   */
  guardrails?: AccessControlConfig
}

// ---------------------------------------------------------------------------
// createSqlEditor — the main factory
// ---------------------------------------------------------------------------

export function createSqlEditor(config: SqlEditorConfigWithGuardrails): SqlEditorInstance {
  const {
    container,
    dialect = 'standard',
    schema = {},
    theme = 'light',
    placeholder = '',
    value = '',
    readOnly = false,
    minHeight,
    maxHeight,
    executor = 'none',
    validateDelay = 300,
    extensions: userExtensions = [],
    keyBindings = [],
    onValidate,
    onExecute,
    onError,
    onChange,
    guardrails,
  } = config

  // --- Compartments for reconfigurable extensions ---
  const langCompartment = new Compartment()
  const themeCompartment = new Compartment()
  const lintCompartment = new Compartment()
  const readOnlyCompartment = new Compartment()

  // --- Mutable state ---
  let currentDialect: SqlDialect = dialect
  let currentSchema: SchemaDefinition = schema
  let localExecutor: LocalExecutor | null = null
  let adapterExecutor: AdapterExecutor | null = null
  let currentAbortController: AbortController | null = null
  let isExecuting: boolean = false

  // --- Initialize executor ---
  if (executor === 'local') {
    let local = new LocalExecutor() as DatabaseAdapter
    if (guardrails) {
      local = createAccessControlledAdapter(local, { config: guardrails })
    }
    activeExecutor = local
    ;(local as any).init?.().catch(() => {})
  } else if (executor !== 'none') {
    let adapter = executor as DatabaseAdapter
    if (guardrails) {
      adapter = createAccessControlledAdapter(adapter, { config: guardrails })
    }
    activeExecutor = adapter
  }

  // --- Build SQL language extension ---
  function buildLangExtension(d: SqlDialect, s: SchemaDefinition) {
    return sql({
      dialect: getDialectConfig(d),
      schema: toCodeMirrorSchema(s),
      upperCaseKeywords: true,
    })
  }

  // --- Sizing ---
  const sizeTheme = EditorView.theme({
    '&': {
      ...(minHeight ? { minHeight: `${minHeight}px` } : {}),
      ...(maxHeight ? { maxHeight: `${maxHeight}px` } : {}),
    },
    '.cm-scroller': {
      overflow: 'auto',
    },
  })

  // --- Run handler ---
  async function runQuery(view: EditorView) {
    const sqlText = view.state.doc.toString().trim()
    if (!sqlText) return false

    try {
      if (activeExecutor) {
        const result = await activeExecutor.execute(sqlText)
        onExecute?.(sqlText, result)
      }
    } catch (e: any) {
      onError?.(e instanceof Error ? e : new Error(String(e)), sqlText)
    }

    return true
  }

  // --- Assemble extensions ---
  const allExtensions: Extension[] = [
    // Core editing
    lineNumbers(),
    history(),
    foldGutter(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightSelectionMatches(),
    lintGutter(),

    // Autocomplete
    autocompletion({
      override: [sqlFunctionCompletions],
      defaultKeymap: true,
      icons: true,
    }),

    // Keymaps
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      indentWithTab,
      {
        key: 'Mod-Enter',
        run: (view) => {
          runQuery(view)
          return true
        },
      },
      ...keyBindings,
    ]),

    // Reconfigurable compartments
    langCompartment.of(buildLangExtension(currentDialect, currentSchema)),
    themeCompartment.of(buildTheme(theme)),
    lintCompartment.of(createSqlLinter(currentDialect, validateDelay, onValidate)),
    readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),

    // Sizing
    sizeTheme,

    // Placeholder
    ...(placeholder ? [placeholderExt(placeholder)] : []),

    // Change listener
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChange?.(update.state.doc.toString())
      }
    }),

    // User extensions (last, so they can override)
    ...userExtensions,
  ]

  // --- Create editor ---
  const view = new EditorView({
    state: EditorState.create({
      doc: value,
      extensions: allExtensions,
    }),
    parent: container,
  })

  // --- Instance methods ---
  const instance: SqlEditorInstance & { run(opts?: { page?: number; pageSize?: number }): Promise<QueryResult | undefined> } = {
    async run(opts?: { page?: number; pageSize?: number }) {
      const sqlText = view.state.doc.toString().trim()
      if (!sqlText) return undefined

      // Cancel any previous running query
      if (currentAbortController) {
        currentAbortController.abort()
      }

      // Create new abort controller for this query
      currentAbortController = new AbortController()
      const signal = currentAbortController.signal
      isExecuting = true

      try {
        let result: QueryResult | undefined
        if (localExecutor) {
          result = await localExecutor.execute(sqlText, signal)
        } else if (adapterExecutor) {
          result = await adapterExecutor.execute(sqlText, signal)
        }
        return undefined
      } catch (e: any) {
        // Don't propagate cancellation errors to onError callback
        if (e instanceof QueryCancelledError || e.name === 'QueryCancelledError') {
          return undefined
        }
        const error = e instanceof Error ? e : new Error(String(e))
        onError?.(error, sqlText)
        throw error
      } finally {
        currentAbortController = null
        isExecuting = false
      }
    },

    cancel() {
      if (currentAbortController) {
        currentAbortController.abort()
        currentAbortController = null
      }
      if (localExecutor) {
        localExecutor.cancel()
      }
      if (adapterExecutor) {
        adapterExecutor.cancel()
      }
      isExecuting = false
    },

    validate() {
      const sqlText = view.state.doc.toString()
      const errors = validateSql(sqlText, currentDialect)
      onValidate?.(errors)
      return errors
    },

    getValue() {
      return view.state.doc.toString()
    },

    setValue(newSql: string) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: newSql },
      })
    },

    setSchema(newSchema: SchemaDefinition) {
      currentSchema = newSchema
      view.dispatch({
        effects: langCompartment.reconfigure(
          buildLangExtension(currentDialect, currentSchema),
        ),
      })
    },

    setDialect(newDialect: SqlDialect) {
      currentDialect = newDialect
      view.dispatch({
        effects: [
          langCompartment.reconfigure(
            buildLangExtension(currentDialect, currentSchema),
          ),
          lintCompartment.reconfigure(
            createSqlLinter(currentDialect, validateDelay, onValidate),
          ),
        ],
      })
    },

    setTheme(newTheme: ThemePreset | ThemeConfig) {
      view.dispatch({
        effects: themeCompartment.reconfigure(buildTheme(newTheme)),
      })
    },

    async loadData(tableName, columns, rows) {
      if (executor !== 'local') {
        throw new Error(
          'loadData() requires executor: "local". Set executor to "local" in config.',
        )
      }
      // Note: we can't easily access the underlying local executor if it's wrapped
      // but for demo/internal use we assume it's there
      if ((activeExecutor as any).loadData) {
        await (activeExecutor as any).loadData(tableName, columns, rows)
      } else if ((activeExecutor as any).adapter?.loadData) {
        await (activeExecutor as any).adapter.loadData(tableName, columns, rows)
      }
    },

    async execRaw(rawSql: string) {
      if (activeExecutor) return activeExecutor.execute(rawSql)
      throw new Error('No executor configured. Set executor to "local" or provide a DatabaseAdapter.')
    },

    focus() {
      view.focus()
    },

    destroy() {
      // Cancel any running query
      if (currentAbortController) {
        currentAbortController.abort()
        currentAbortController = null
      }
      view.destroy()
      activeExecutor?.destroy?.()
    },
  }

  return instance
}
