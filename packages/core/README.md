# @vsql/core

Framework-agnostic SQL editor, validator, and runner. Powered by CodeMirror 6, node-sql-parser, and sql.js.

See the [monorepo README](../../README.md) for full documentation.

## Install

```bash
npm install @vsql/core
```

## Quick Example

```typescript
import { createSqlEditor } from '@vsql/core'

const editor = createSqlEditor({
  container: document.getElementById('editor')!,
  dialect: 'postgresql',
  schema: { users: ['id', 'name', 'email'] },
  theme: 'dark',
  executor: 'local',
  onExecute: (sql, result) => console.log(result),
})
```

## License

MIT
