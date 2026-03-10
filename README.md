# @vsql — SQL Editor, Validator & Runner for JavaScript

A production-grade, framework-agnostic SQL editor library with **syntax highlighting**, **intelligent autocomplete**, **real-time validation**, and **in-browser query execution**. Works with React, Vue, Next.js, and vanilla JavaScript.

| Package | Description | Size |
|---------|-------------|------|
| `@vsql/core` | Framework-agnostic engine | ~22 KB |
| `@vsql/react` | React components & hooks | ~10 KB |
| `@vsql/vue` | Vue components & composables | ~9 KB |

## Features

- **SQL Syntax Highlighting** — Powered by CodeMirror 6 with full token coloring
- **Intelligent Autocomplete** — Schema-aware completions for tables, columns, SQL keywords, and functions
- **Real-time Validation** — Syntax error detection with inline markers (wavy underlines + error messages)
- **Multi-dialect Support** — MySQL, PostgreSQL, SQLite, MSSQL, MariaDB, Standard SQL
- **In-browser Execution** — Run queries locally via sql.js (SQLite compiled to WebAssembly)
- **Custom Backend Support** — Plug in any database via the `DatabaseAdapter` interface
- **Beautiful Themes** — Light and dark themes out of the box, fully customizable via CSS variables
- **SQL Snippets** — Snippet templates for SELECT, JOIN, INSERT, UPDATE, DELETE, CREATE TABLE, etc.
- **Keyboard Shortcuts** — Ctrl/Cmd+Enter to run, Ctrl+Space for autocomplete, full history navigation
- **Tiny Bundle** — Core is ~22 KB (dependencies excluded), framework bindings add ~10 KB each
- **TypeScript First** — Full type definitions, documented interfaces, IntelliSense-friendly

---

## Quick Start

### React

```bash
npm install @vsql/react
```

```tsx
import { SqlEditor, SqlResults, useSqlEditor } from '@vsql/react'

function App() {
  const { containerRef, results, errors, isRunning, run } = useSqlEditor({
    dialect: 'postgresql',
    schema: {
      users: ['id', 'name', 'email', 'created_at'],
      orders: ['id', 'user_id', 'total', 'status'],
    },
    executor: 'local',
  })

  return (
    <div>
      <div ref={containerRef} />
      <button onClick={run} disabled={isRunning}>
        {isRunning ? 'Running...' : 'Run Query'}
      </button>
      {errors.length > 0 && (
        <div style={{ color: 'red' }}>
          {errors.map((e, i) => <p key={i}>{e.message}</p>)}
        </div>
      )}
      <SqlResults data={results} />
    </div>
  )
}
```

#### Passing database config from your (parent) app

Your parent app holds the API URL (and optional API key). The real database credentials stay on your backend. Create an adapter with that config and pass it as `executor`:

```tsx
import { useSqlEditor, createRemoteAdapter, SqlResults } from '@vsql/react'

// In your parent app: create adapter from your config (env, state, etc.)
const sqlAdapter = createRemoteAdapter({
  apiUrl: process.env.NEXT_PUBLIC_SQL_API_URL ?? 'http://localhost:3001',
  apiKey: process.env.NEXT_PUBLIC_SQL_API_KEY, // optional
  // headers: { 'X-Custom': 'value' }, // optional
})

function MySqlRunner() {
  const { containerRef, results, run, isRunning } = useSqlEditor({
    dialect: 'postgresql',
    executor: sqlAdapter,  // your adapter from parent
    schema: { users: ['id', 'name', 'email'], orders: ['id', 'user_id', 'total'] },
  })

  return (
    <div>
      <div ref={containerRef} />
      <button onClick={run} disabled={isRunning}>Run Query</button>
      <SqlResults data={results} />
    </div>
  )
}
```

Your backend (any stack) must expose `POST /api/query` with body `{ "sql": "..." }` and return `{ columns: string[], rows: object[] }`. Optional `GET /api/schema` for autocomplete. Keep DB credentials only on the backend.

Or use the declarative `<SqlEditor />` component:

```tsx
import { useRef } from 'react'
import { SqlEditor, type SqlEditorRef } from '@vsql/react'

function App() {
  const editorRef = useRef<SqlEditorRef>(null)

  return (
    <SqlEditor
      ref={editorRef}
      dialect="mysql"
      schema={{ users: ['id', 'name', 'email'] }}
      theme="dark"
      placeholder="SELECT * FROM users"
      executor="local"
      onExecute={(sql, result) => console.log(result)}
      onValidate={(errors) => console.log(errors)}
    />
  )
}
```

### Vue

```bash
npm install @vsql/vue
```

```vue
<template>
  <div>
    <SqlEditor
      dialect="postgresql"
      :schema="schema"
      v-model="query"
      theme="light"
      executor="local"
      @execute="onExecute"
      @validate="onValidate"
    />
    <button @click="run" :disabled="isRunning">Run Query</button>
    <SqlResults :data="results" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { SqlEditor, SqlResults, useSqlEditor } from '@vsql/vue'

const schema = {
  users: ['id', 'name', 'email', 'created_at'],
  orders: ['id', 'user_id', 'total', 'status'],
}

const { sql: query, results, errors, isRunning, run } = useSqlEditor({
  dialect: 'postgresql',
  schema,
  executor: 'local',
})

function onExecute(sql: string, result: any) {
  console.log('Executed:', result)
}

function onValidate(errs: any[]) {
  console.log('Validation:', errs)
}
</script>
```

### Next.js (App Router)

```tsx
'use client'

import dynamic from 'next/dynamic'
import { useSqlEditor } from '@vsql/react'

// CodeMirror requires DOM — dynamic import with SSR disabled
const SqlResults = dynamic(
  () => import('@vsql/react').then((m) => m.SqlResults),
  { ssr: false }
)

export default function SqlPage() {
  const { containerRef, results, run } = useSqlEditor({
    dialect: 'postgresql',
    executor: 'local',
    schema: { users: ['id', 'name', 'email'] },
  })

  return (
    <div>
      <div ref={containerRef} />
      <button onClick={run}>Run</button>
      <SqlResults data={results} />
    </div>
  )
}
```

### Vanilla JavaScript

```bash
npm install @vsql/core
```

```html
<div id="editor"></div>
<div id="results"></div>

<script type="module">
  import { createSqlEditor } from '@vsql/core'

  const editor = createSqlEditor({
    container: document.getElementById('editor'),
    dialect: 'sqlite',
    schema: {
      users: ['id', 'name', 'email'],
      posts: ['id', 'user_id', 'title', 'body'],
    },
    theme: 'light',
    executor: 'local',
    placeholder: 'Write your SQL query...',
    onExecute(sql, result) {
      document.getElementById('results').textContent =
        JSON.stringify(result.rows, null, 2)
    },
    onValidate(errors) {
      errors.forEach(e => console.warn(`Line ${e.line}: ${e.message}`))
    },
  })

  // Load sample data
  await editor.loadData('users', ['id', 'name', 'email'], [
    [1, 'Alice', 'alice@example.com'],
    [2, 'Bob', 'bob@example.com'],
    [3, 'Charlie', 'charlie@example.com'],
  ])
</script>
```

---

## API Reference

### `@vsql/core`

#### `createSqlEditor(config: SqlEditorConfig): SqlEditorInstance`

Creates a new SQL editor instance.

**Config:**

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `container` | `HTMLElement` | *required* | DOM element to mount into |
| `dialect` | `SqlDialect` | `'standard'` | SQL dialect for parsing and autocomplete |
| `schema` | `SchemaDefinition` | `{}` | Database schema for autocomplete |
| `theme` | `'light' \| 'dark' \| ThemeConfig` | `'light'` | Theme preset or custom config |
| `value` | `string` | `''` | Initial SQL content |
| `placeholder` | `string` | `''` | Placeholder text |
| `readOnly` | `boolean` | `false` | Read-only mode |
| `minHeight` | `number` | — | Minimum editor height in px |
| `maxHeight` | `number` | — | Maximum editor height in px |
| `executor` | `'local' \| 'none' \| DatabaseAdapter` | `'none'` | Execution strategy |
| `validateDelay` | `number` | `300` | Validation debounce in ms |
| `extensions` | `Extension[]` | `[]` | Additional CodeMirror extensions |
| `keyBindings` | `KeyBinding[]` | `[]` | Additional key bindings |
| `onChange` | `(value: string) => void` | — | Content change callback |
| `onValidate` | `(errors: ValidationError[]) => void` | — | Validation callback |
| `onExecute` | `(sql: string, result: QueryResult) => void` | — | Execution callback |
| `onError` | `(error: Error, sql: string) => void` | — | Error callback |

**Instance Methods:**

| Method | Returns | Description |
|--------|---------|-------------|
| `run()` | `Promise<QueryResult \| undefined>` | Execute current query |
| `validate()` | `ValidationError[]` | Force validation |
| `getValue()` | `string` | Get current SQL |
| `setValue(sql)` | `void` | Set SQL content |
| `setSchema(schema)` | `void` | Update schema |
| `setDialect(dialect)` | `void` | Switch dialect |
| `setTheme(theme)` | `void` | Switch theme |
| `loadData(table, cols, rows)` | `Promise<void>` | Load data into local db |
| `execRaw(sql)` | `Promise<QueryResult>` | Execute raw SQL |
| `focus()` | `void` | Focus editor |
| `destroy()` | `void` | Cleanup |

#### SQL Dialects

```typescript
type SqlDialect = 'mysql' | 'postgresql' | 'sqlite' | 'mssql' | 'mariadb' | 'standard'
```

#### Schema Definition

```typescript
// Flat: table → columns
const schema = {
  users: ['id', 'name', 'email'],
  orders: ['id', 'user_id', 'total'],
}

// With column types (for future tooltip support)
const schema = {
  users: [
    { name: 'id', type: 'INTEGER' },
    { name: 'name', type: 'VARCHAR(255)' },
    { name: 'email', type: 'VARCHAR(255)' },
  ],
}

// Nested: schema → table → columns
const schema = {
  public: {
    users: ['id', 'name', 'email'],
    orders: ['id', 'user_id', 'total'],
  },
}
```

#### Custom Database Adapter

```typescript
import { createSqlEditor, type DatabaseAdapter } from '@vsql/core'

const myAdapter: DatabaseAdapter = {
  async execute(sql: string) {
    const response = await fetch('/api/query', {
      method: 'POST',
      body: JSON.stringify({ sql }),
    })
    return response.json()
  },
  async getSchema() {
    const response = await fetch('/api/schema')
    return response.json()
  },
}

const editor = createSqlEditor({
  container: document.getElementById('editor')!,
  executor: myAdapter,
})
```

#### Custom Theme

```typescript
const editor = createSqlEditor({
  container: el,
  theme: {
    background: '#1a1b26',
    foreground: '#c0caf5',
    caret: '#7aa2f7',
    selection: '#283457',
    lineHighlight: '#1e2030',
    gutterBackground: '#1a1b26',
    gutterForeground: '#3b4261',
    gutterBorder: '#292e42',
    accent: '#7aa2f7',
    errorForeground: '#f7768e',
    tokens: {
      keyword: '#bb9af7',
      string: '#9ece6a',
      number: '#ff9e64',
      comment: '#565f89',
      operator: '#89ddff',
      function: '#7aa2f7',
      type: '#2ac3de',
    },
  },
})
```

---

### `@vsql/react`

#### `<SqlEditor />` Component

All `@vsql/core` config properties are available as props, plus:

| Prop | Type | Description |
|------|------|-------------|
| `className` | `string` | CSS class for wrapper |
| `style` | `CSSProperties` | Inline styles |
| `defaultValue` | `string` | Uncontrolled initial value |
| `onRun` | `() => void` | Called on Ctrl/Cmd+Enter |

Supports `ref` for imperative access (`run()`, `getValue()`, `setValue()`, `focus()`).

#### `useSqlEditor(options)` Hook

Returns `{ containerRef, editor, sql, errors, results, isRunning, run, setSql, setSchema, setDialect, setTheme }`.

Attach `containerRef` to a `<div>` and the editor mounts automatically.

#### `<SqlResults />` Component

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `QueryResult \| null` | — | Result to display |
| `maxHeight` | `number` | `400` | Scrollable area height |
| `showRowCount` | `boolean` | `true` | Show row count badge |
| `showElapsed` | `boolean` | `true` | Show execution time |
| `emptyMessage` | `string` | `'Run a query...'` | Empty state text |

---

### `@vsql/vue`

#### `<SqlEditor />` Component

Supports `v-model` for two-way SQL binding. Props mirror the core config.

**Events:** `@update:modelValue`, `@validate`, `@execute`, `@error`, `@run`

#### `useSqlEditor(options)` Composable

Returns `{ containerRef, editor, sql, errors, results, isRunning, run, setSql, setSchema, setDialect, setTheme }`.

Bind `containerRef` with `ref="containerRef"` on a container element.

#### `<SqlResults />` Component

Same props as the React version.

---

## CSS Custom Properties

Override these variables to customize the results table styling:

```css
:root {
  --vsql-border: #e5e7eb;
  --vsql-muted: #9ca3af;
  --vsql-badge-bg: #eff6ff;
  --vsql-badge-fg: #2563eb;
  --vsql-th-bg: #f8f9fb;
  --vsql-th-fg: #6b7280;
  --vsql-row-alt: #f9fafb;
}
```

---

## Architecture

```
@vsql/core (framework-agnostic)
├── CodeMirror 6         → Editor, syntax highlighting, keybindings
├── @codemirror/lang-sql  → SQL language mode, dialect support, autocomplete
├── node-sql-parser      → SQL syntax validation, AST parsing
└── sql.js               → In-browser SQLite via WebAssembly

@vsql/react              → React components + hooks wrapping core
@vsql/vue                → Vue components + composables wrapping core
```

## Requirements

- Node.js >= 18
- React >= 18 (for `@vsql/react`)
- Vue >= 3.3 (for `@vsql/vue`)

## License

MIT
