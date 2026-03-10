# @vsql/vue

Vue components and composables for the @vsql SQL editor.

See the [monorepo README](../../README.md) for full documentation.

## Install

```bash
npm install @vsql/vue
```

## Quick Example

```vue
<template>
  <SqlEditor v-model="query" dialect="postgresql" :schema="schema" executor="local" @execute="onExecute" />
  <SqlResults :data="results" />
</template>

<script setup>
import { SqlEditor, SqlResults, useSqlEditor } from '@vsql/vue'
const schema = { users: ['id', 'name', 'email'] }
const { sql: query, results, run } = useSqlEditor({ dialect: 'postgresql', schema, executor: 'local' })
const onExecute = (sql, result) => console.log(result)
</script>
```

## License

MIT
