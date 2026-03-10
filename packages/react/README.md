# @vsql/react

React components and hooks for the @vsql SQL editor.

See the [monorepo README](../../README.md) for full documentation.

## Install

```bash
npm install @vsql/react
```

## Quick Example

```tsx
import { SqlEditor, SqlResults, useSqlEditor } from '@vsql/react'

function App() {
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

## License

MIT
