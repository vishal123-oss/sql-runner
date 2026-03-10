import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippetCompletion,
} from '@codemirror/autocomplete'

// ---------------------------------------------------------------------------
// SQL function completions (common across dialects)
// ---------------------------------------------------------------------------

const SQL_FUNCTIONS: Completion[] = [
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  'COALESCE', 'NULLIF', 'IFNULL',
  'CAST', 'CONVERT',
  'UPPER', 'LOWER', 'TRIM', 'LTRIM', 'RTRIM',
  'LENGTH', 'SUBSTRING', 'REPLACE', 'CONCAT',
  'ABS', 'CEIL', 'FLOOR', 'ROUND', 'MOD', 'POWER',
  'NOW', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP',
  'DATE', 'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND',
  'GROUP_CONCAT', 'STRING_AGG',
  'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'NTILE',
  'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE',
  'EXISTS', 'IN', 'BETWEEN', 'LIKE', 'CASE',
].map((name) => ({
  label: name,
  type: 'function',
  boost: -1,
}))

// ---------------------------------------------------------------------------
// SQL snippet templates
// ---------------------------------------------------------------------------

const SQL_SNIPPETS: Completion[] = [
  snippetCompletion('SELECT ${columns} FROM ${table}', {
    label: 'SELECT ... FROM',
    type: 'keyword',
    detail: 'Select statement',
    boost: 2,
  }),
  snippetCompletion('SELECT * FROM ${table} WHERE ${condition}', {
    label: 'SELECT ... WHERE',
    type: 'keyword',
    detail: 'Select with filter',
    boost: 2,
  }),
  snippetCompletion(
    'SELECT ${columns} FROM ${table} ORDER BY ${column} ${ASC}',
    {
      label: 'SELECT ... ORDER BY',
      type: 'keyword',
      detail: 'Select with ordering',
      boost: 1,
    },
  ),
  snippetCompletion(
    'SELECT ${column}, COUNT(*) FROM ${table} GROUP BY ${column}',
    {
      label: 'SELECT ... GROUP BY',
      type: 'keyword',
      detail: 'Aggregate query',
      boost: 1,
    },
  ),
  snippetCompletion(
    'SELECT ${a}.*, ${b}.* FROM ${table1} ${a}\nJOIN ${table2} ${b} ON ${a}.${id} = ${b}.${id}',
    {
      label: 'JOIN',
      type: 'keyword',
      detail: 'Join two tables',
      boost: 1,
    },
  ),
  snippetCompletion(
    'INSERT INTO ${table} (${columns}) VALUES (${values})',
    {
      label: 'INSERT INTO',
      type: 'keyword',
      detail: 'Insert statement',
      boost: 1,
    },
  ),
  snippetCompletion('UPDATE ${table} SET ${column} = ${value} WHERE ${condition}', {
    label: 'UPDATE ... SET',
    type: 'keyword',
    detail: 'Update statement',
    boost: 1,
  }),
  snippetCompletion('DELETE FROM ${table} WHERE ${condition}', {
    label: 'DELETE FROM',
    type: 'keyword',
    detail: 'Delete statement',
    boost: 1,
  }),
  snippetCompletion(
    'CREATE TABLE ${name} (\n  ${column} ${type}\n)',
    {
      label: 'CREATE TABLE',
      type: 'keyword',
      detail: 'Create table',
      boost: 1,
    },
  ),
  snippetCompletion('ALTER TABLE ${table} ADD COLUMN ${column} ${type}', {
    label: 'ALTER TABLE',
    type: 'keyword',
    detail: 'Alter table',
    boost: 0,
  }),
  snippetCompletion(
    'CASE\n  WHEN ${condition} THEN ${result}\n  ELSE ${default}\nEND',
    {
      label: 'CASE ... WHEN',
      type: 'keyword',
      detail: 'Case expression',
      boost: 0,
    },
  ),
]

// ---------------------------------------------------------------------------
// Custom completion source (supplements CodeMirror's built-in SQL completions)
// ---------------------------------------------------------------------------

export function sqlFunctionCompletions(
  context: CompletionContext,
): CompletionResult | null {
  const word = context.matchBefore(/\w+/)
  if (!word) return null
  if (word.from === word.to && !context.explicit) return null

  return {
    from: word.from,
    options: [...SQL_FUNCTIONS, ...SQL_SNIPPETS],
    validFor: /^\w*$/,
  }
}
