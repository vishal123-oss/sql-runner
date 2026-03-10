import {
  defineComponent,
  h,
  ref,
  onMounted,
  onBeforeUnmount,
  watch,
  type PropType,
} from 'vue'
import {
  createSqlEditor,
  type SqlEditorInstance,
  type SqlDialect,
  type SchemaDefinition,
  type ThemePreset,
  type ThemeConfig,
  type SqlEditorConfig,
} from '@vsql/core'

export const SqlEditor = defineComponent({
  name: 'SqlEditor',

  props: {
    dialect: {
      type: String as PropType<SqlDialect>,
      default: 'standard',
    },
    schema: {
      type: Object as PropType<SchemaDefinition>,
      default: () => ({}),
    },
    theme: {
      type: [String, Object] as PropType<ThemePreset | ThemeConfig>,
      default: 'light',
    },
    modelValue: {
      type: String,
      default: undefined,
    },
    defaultValue: {
      type: String,
      default: '',
    },
    placeholder: {
      type: String,
      default: undefined,
    },
    readOnly: {
      type: Boolean,
      default: false,
    },
    minHeight: {
      type: Number,
      default: 120,
    },
    maxHeight: {
      type: Number,
      default: undefined,
    },
    executor: {
      type: [String, Object] as PropType<SqlEditorConfig['executor']>,
      default: 'none',
    },
    validateDelay: {
      type: Number,
      default: 300,
    },
  },

  emits: ['update:modelValue', 'validate', 'execute', 'error', 'run'],

  setup(props, { emit, expose }) {
    const containerRef = ref<HTMLElement | null>(null)
    const editorRef = ref<SqlEditorInstance | null>(null)

    onMounted(() => {
      const el = containerRef.value
      if (!el) return

      const instance = createSqlEditor({
        container: el,
        dialect: props.dialect,
        schema: props.schema,
        theme: props.theme,
        placeholder: props.placeholder,
        value: props.modelValue ?? props.defaultValue,
        readOnly: props.readOnly,
        minHeight: props.minHeight,
        maxHeight: props.maxHeight,
        executor: props.executor,
        validateDelay: props.validateDelay,
        onChange: (value) => {
          emit('update:modelValue', value)
        },
        onValidate: (errors) => {
          emit('validate', errors)
        },
        onExecute: (sql, result) => {
          emit('execute', sql, result)
        },
        onError: (error, sql) => {
          emit('error', error, sql)
        },
        keyBindings: [
          {
            key: 'Mod-Enter',
            run: () => {
              emit('run')
              return true
            },
            preventDefault: true,
          },
        ],
      })

      editorRef.value = instance
    })

    onBeforeUnmount(() => {
      editorRef.value?.destroy()
      editorRef.value = null
    })

    // Watch for prop changes
    watch(
      () => props.modelValue,
      (newVal) => {
        if (newVal !== undefined && editorRef.value) {
          const current = editorRef.value.getValue()
          if (current !== newVal) {
            editorRef.value.setValue(newVal)
          }
        }
      },
    )

    watch(() => props.dialect, (d) => editorRef.value?.setDialect(d))
    watch(() => props.schema, (s) => editorRef.value?.setSchema(s), { deep: true })
    watch(() => props.theme, (t) => editorRef.value?.setTheme(t), { deep: true })

    expose({
      getInstance: () => editorRef.value,
      run: () => editorRef.value?.run(),
      getValue: () => editorRef.value?.getValue() ?? '',
      setValue: (sql: string) => editorRef.value?.setValue(sql),
      focus: () => editorRef.value?.focus(),
    })

    return () =>
      h('div', {
        ref: containerRef,
        class: 'vsql-editor',
        style: {
          border: '1px solid var(--vsql-border, #e5e7eb)',
          borderRadius: '8px',
          overflow: 'hidden',
        },
      })
  },
})
