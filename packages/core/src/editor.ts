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
} from './types'

import { buildTheme } from './theme'
import { toCodeMirrorSchema } from './schema'
import { validateSql, createSqlLinter } from './validator'
import { LocalExecutor, AdapterExecutor } from './executor'
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

// ---------------------------------------------------------------------------
// createSqlEditor — the main factory
// ---------------------------------------------------------------------------

export function createSqlEditor(config: SqlEditorConfig): SqlEditorInstance {
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

  // --- Initialize executor ---
  if (executor === 'local') {
    localExecutor = new LocalExecutor()
    localExecutor.init().catch(() => {})
  } else if (executor !== 'none') {
    adapterExecutor = new AdapterExecutor(executor as DatabaseAdapter)
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
      let result: QueryResult | undefined

      if (localExecutor) {
        result = await localExecutor.execute(sqlText)
      } else if (adapterExecutor) {
        result = await adapterExecutor.execute(sqlText)
      }

      if (result) {
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
  const instance: SqlEditorInstance = {
    async run() {
      const sqlText = view.state.doc.toString().trim()
      if (!sqlText) return undefined

      try {
        let result: QueryResult | undefined
        if (localExecutor) {
          result = await localExecutor.execute(sqlText)
        } else if (adapterExecutor) {
          result = await adapterExecutor.execute(sqlText)
        }
        if (result) onExecute?.(sqlText, result)
        return result
      } catch (e: any) {
        const error = e instanceof Error ? e : new Error(String(e))
        onError?.(error, sqlText)
        throw error
      }
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
      if (!localExecutor) {
        throw new Error(
          'loadData() requires executor: "local". Set executor to "local" in config.',
        )
      }
      await localExecutor.loadData(tableName, columns, rows)
    },

    async execRaw(rawSql: string) {
      if (localExecutor) return localExecutor.execute(rawSql)
      if (adapterExecutor) return adapterExecutor.execute(rawSql)
      throw new Error('No executor configured. Set executor to "local" or provide a DatabaseAdapter.')
    },

    focus() {
      view.focus()
    },

    destroy() {
      view.destroy()
      localExecutor?.destroy()
      adapterExecutor?.destroy()
    },
  }

  return instance
}
