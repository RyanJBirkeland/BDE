import { useState, useRef, useEffect } from 'react'

export interface EditableFieldProps {
  value: string
  onSave: (value: string) => Promise<void>
  multiline?: boolean
  placeholder?: string
  style?: React.CSSProperties
}

export function EditableField({
  value,
  onSave,
  multiline = false,
  placeholder,
  style
}: EditableFieldProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [committedValue, setCommittedValue] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Sync draft to the latest external value when the field is not being edited.
  // We use an intermediate "committedValue" state to detect upstream changes
  // without calling setDraft inside a useEffect body (which triggers cascading
  // renders per react-compiler rules). Instead we update during render —
  // React's recommended pattern for derived-state synchronization.
  if (!editing && value !== committedValue) {
    setCommittedValue(value)
    setDraft(value)
  }

  useEffect(() => {
    if (editing && !multiline) inputRef.current?.select()
  }, [editing, multiline])

  useEffect(() => {
    if (editing && multiline && textareaRef.current) {
      const el = textareaRef.current
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }, [editing, multiline, draft])

  function startEdit(): void {
    setDraft(value)
    setEditing(true)
  }

  async function commit(): Promise<void> {
    setEditing(false)
    if (draft.trim() === value.trim()) return
    await onSave(draft)
  }

  function cancel(): void {
    setDraft(value)
    setEditing(false)
  }

  if (editing && multiline) {
    return (
      <textarea
        ref={textareaRef}
        value={draft}
        autoFocus
        onChange={(e) => {
          setDraft(e.target.value)
          e.target.style.height = 'auto'
          e.target.style.height = `${e.target.scrollHeight}px`
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          }
        }}
        style={{
          ...style,
          display: 'block',
          width: '100%',
          background: 'transparent',
          border: 'none',
          borderBottom: '1px solid var(--accent)',
          outline: 'none',
          padding: '0 0 2px',
          fontFamily: 'inherit',
          resize: 'none',
          overflow: 'hidden'
        }}
      />
    )
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void commit()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          }
        }}
        style={{
          ...style,
          display: 'block',
          width: '100%',
          background: 'transparent',
          border: 'none',
          borderBottom: '1px solid var(--accent)',
          outline: 'none',
          padding: '0 0 2px',
          fontFamily: 'inherit'
        }}
      />
    )
  }

  return (
    <div
      onClick={startEdit}
      title="Click to edit"
      style={{
        ...style,
        cursor: 'text',
        borderBottom: '1px solid transparent',
        paddingBottom: 2,
        color: multiline && !value ? 'var(--fg-4)' : style?.color
      }}
    >
      {multiline ? value || placeholder : value}
    </div>
  )
}
