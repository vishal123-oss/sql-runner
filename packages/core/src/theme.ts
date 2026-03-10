import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'
import type { ThemeConfig, ThemePreset } from './types'

// ---------------------------------------------------------------------------
// Default palettes
// ---------------------------------------------------------------------------

const LIGHT: Required<ThemeConfig> = {
  background: '#ffffff',
  foreground: '#1e1e1e',
  caret: '#528bff',
  selection: '#d7e4f7',
  lineHighlight: '#f5f7fa',
  gutterBackground: '#f8f9fb',
  gutterForeground: '#9ca3af',
  gutterBorder: '#e5e7eb',
  accent: '#2563eb',
  errorForeground: '#dc2626',
  tokens: {
    keyword: '#7c3aed',
    string: '#16a34a',
    number: '#d97706',
    comment: '#9ca3af',
    operator: '#e11d48',
    function: '#2563eb',
    type: '#0891b2',
  },
}

const DARK: Required<ThemeConfig> = {
  background: '#0f1117',
  foreground: '#e4e5e7',
  caret: '#528bff',
  selection: '#28344a',
  lineHighlight: '#151921',
  gutterBackground: '#0f1117',
  gutterForeground: '#4b5563',
  gutterBorder: '#1f2937',
  accent: '#60a5fa',
  errorForeground: '#f87171',
  tokens: {
    keyword: '#c084fc',
    string: '#4ade80',
    number: '#fbbf24',
    comment: '#6b7280',
    operator: '#fb7185',
    function: '#60a5fa',
    type: '#22d3ee',
  },
}

// ---------------------------------------------------------------------------
// Resolve config
// ---------------------------------------------------------------------------

function resolve(theme: ThemePreset | ThemeConfig): Required<ThemeConfig> {
  if (theme === 'light') return LIGHT
  if (theme === 'dark') return DARK

  const base = theme.background && isColorDark(theme.background) ? DARK : LIGHT
  return {
    ...base,
    ...theme,
    tokens: { ...base.tokens, ...theme.tokens },
  }
}

function isColorDark(hex: string): boolean {
  const c = hex.replace('#', '')
  const r = parseInt(c.substring(0, 2), 16)
  const g = parseInt(c.substring(2, 4), 16)
  const b = parseInt(c.substring(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 < 128
}

// ---------------------------------------------------------------------------
// Build CodeMirror theme extension
// ---------------------------------------------------------------------------

export function buildTheme(preset: ThemePreset | ThemeConfig): Extension {
  const t = resolve(preset)
  const isDark = isColorDark(t.background)

  const editorTheme = EditorView.theme(
    {
      '&': {
        backgroundColor: t.background,
        color: t.foreground,
        fontSize: '14px',
        fontFamily:
          "'JetBrains Mono', 'Fira Code', 'Source Code Pro', ui-monospace, SFMono-Regular, Menlo, monospace",
      },
      '.cm-content': {
        caretColor: t.caret,
        padding: '8px 0',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: t.caret,
        borderLeftWidth: '2px',
      },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: t.selection,
      },
      '.cm-activeLine': {
        backgroundColor: t.lineHighlight,
      },
      '.cm-gutters': {
        backgroundColor: t.gutterBackground,
        color: t.gutterForeground,
        borderRight: `1px solid ${t.gutterBorder}`,
        paddingLeft: '4px',
      },
      '.cm-activeLineGutter': {
        backgroundColor: t.lineHighlight,
        color: t.foreground,
      },
      '.cm-foldPlaceholder': {
        backgroundColor: 'transparent',
        border: 'none',
        color: t.accent,
      },
      '.cm-tooltip': {
        backgroundColor: t.background,
        border: `1px solid ${t.gutterBorder}`,
        borderRadius: '6px',
        boxShadow: '0 4px 12px rgba(0,0,0,.15)',
      },
      '.cm-tooltip-autocomplete': {
        '& > ul > li': {
          padding: '4px 8px',
        },
        '& > ul > li[aria-selected]': {
          backgroundColor: t.selection,
          color: t.foreground,
        },
      },
      '.cm-panels': {
        backgroundColor: t.gutterBackground,
        color: t.foreground,
      },
      '.cm-searchMatch': {
        backgroundColor: `${t.accent}33`,
        outline: `1px solid ${t.accent}66`,
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: `${t.accent}55`,
      },
      // Lint diagnostics
      '.cm-diagnostic-error': {
        borderLeft: `3px solid ${t.errorForeground}`,
      },
      '.cm-diagnostic-warning': {
        borderLeft: `3px solid ${t.tokens.number}`,
      },
      '.cm-lintRange-error': {
        backgroundImage: 'none',
        textDecoration: `wavy underline ${t.errorForeground}`,
        textDecorationSkipInk: 'none',
        textUnderlineOffset: '3px',
      },
      '.cm-lintRange-warning': {
        backgroundImage: 'none',
        textDecoration: `wavy underline ${t.tokens.number}`,
        textDecorationSkipInk: 'none',
        textUnderlineOffset: '3px',
      },
      // Placeholder
      '.cm-placeholder': {
        color: t.gutterForeground,
        fontStyle: 'italic',
      },
    },
    { dark: isDark },
  )

  const tok = t.tokens
  const highlightStyle = HighlightStyle.define([
    { tag: tags.keyword, color: tok.keyword, fontWeight: '600' },
    { tag: tags.string, color: tok.string },
    { tag: tags.number, color: tok.number },
    { tag: tags.comment, color: tok.comment, fontStyle: 'italic' },
    { tag: tags.operator, color: tok.operator },
    { tag: tags.function(tags.variableName), color: tok.function },
    { tag: tags.typeName, color: tok.type },
    { tag: tags.bool, color: tok.number },
    { tag: tags.null, color: tok.keyword },
    { tag: tags.special(tags.string), color: tok.string },
    { tag: tags.definition(tags.variableName), color: t.foreground },
    { tag: tags.punctuation, color: t.foreground },
    { tag: tags.bracket, color: t.foreground },
    { tag: tags.propertyName, color: tok.function },
  ])

  return [editorTheme, syntaxHighlighting(highlightStyle)]
}
