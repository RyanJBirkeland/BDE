import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { X } from 'lucide-react'
import { CommandAutocomplete } from './CommandAutocomplete'
import { AGENT_COMMANDS } from './commands'
import { toast } from '../../stores/toasts'
import type { Attachment } from '../../../../shared/types'

interface CommandBarProps {
  onSend: (message: string, attachment?: Attachment) => void
  onCommand: (cmd: string, args?: string) => void
  disabled?: boolean
  disabledReason?: string
}

const COMMANDS = AGENT_COMMANDS

export function CommandBar({
  onSend,
  onCommand,
  disabled = false,
  disabledReason
}: CommandBarProps): React.JSX.Element {
  const [value, setValue] = useState('')
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const [autocompleteHidden, setAutocompleteHidden] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Compute filtered commands synchronously to avoid stale state races
  const filteredCommands =
    value.startsWith('/') && value.length > 0
      ? COMMANDS.filter((cmd) => cmd.name.toLowerCase().startsWith(value.toLowerCase()))
      : []

  // Show autocomplete when there are matches AND it hasn't been manually dismissed
  const showAutocomplete = filteredCommands.length > 0 && !autocompleteHidden

  // Reset hidden state when value changes (user is typing again)
  useEffect(() => {
    if (autocompleteHidden) {
      setAutocompleteHidden(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // Auto-grow textarea with max 6 rows (~120px)
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const newHeight = Math.min(el.scrollHeight, 120)
    el.style.height = `${newHeight}px`
  }, [value])

  const handleSubmit = useCallback((): void => {
    const trimmed = value.trim()
    if ((!trimmed && !attachment) || disabled) return

    // Check if it's a command
    if (trimmed.startsWith('/')) {
      const parts = trimmed.split(/\s+/)
      const command = parts[0]
      const args = parts.slice(1).join(' ')
      onCommand(command, args || undefined)
    } else {
      onSend(trimmed, attachment ?? undefined)
    }

    setValue('')
    setAttachment(null)
  }, [value, attachment, disabled, onCommand, onSend])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      // Let autocomplete handle these keys when shown
      if (showAutocomplete && ['ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) {
        return
      }

      // Cmd+Enter submits
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSubmit()
        return
      }

      // Enter (without Shift) submits, unless autocomplete is handling it
      if (e.key === 'Enter' && !e.shiftKey) {
        if (!showAutocomplete) {
          e.preventDefault()
          handleSubmit()
        }
      }
      // Shift+Enter allows default behavior (newline insertion)
    },
    [showAutocomplete, handleSubmit]
  )

  const handleAutocompleteSelect = useCallback((command: string): void => {
    setValue(command + ' ')
    inputRef.current?.focus()
  }, [])

  const handleAutocompleteClose = useCallback((): void => {
    setAutocompleteHidden(true)
    inputRef.current?.focus()
  }, [])

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const items = e.clipboardData.items
    let imageItem: DataTransferItem | null = null

    // Find the first image item
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        imageItem = items[i]
        break
      }
    }

    // If no image, let the default paste behavior happen
    if (!imageItem) return

    e.preventDefault()

    const blob = imageItem.getAsFile()
    if (!blob) return

    // Check file size (5MB limit)
    const MAX_SIZE = 5 * 1024 * 1024
    if (blob.size > MAX_SIZE) {
      toast.error('Image too large (max 5MB)')
      return
    }

    const reader = new FileReader()
    reader.onerror = () => {
      toast.error('Failed to read image')
    }
    reader.onload = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(',')[1]
      setAttachment({
        path: '',
        name: `paste-${Date.now()}.png`,
        type: 'image',
        mimeType: blob.type,
        data: base64,
        preview: dataUrl
      })
    }
    reader.readAsDataURL(blob)
  }, [])

  return (
    <div
      className={`command-bar${disabled ? ' command-bar--disabled' : ''}`}
      style={{ position: 'relative' }}
    >
      {showAutocomplete && (
        <CommandAutocomplete
          query={value}
          onSelect={handleAutocompleteSelect}
          onClose={handleAutocompleteClose}
        />
      )}
      {attachment && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            right: 0,
            padding: '8px',
            background: 'var(--neon-bg)',
            borderTop: '1px solid var(--neon-purple-border)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <img
            src={attachment.preview}
            alt={attachment.name}
            style={{
              height: 64,
              width: 'auto',
              borderRadius: 4,
              border: '1px solid var(--neon-cyan-border)',
              objectFit: 'contain'
            }}
          />
          <span
            style={{
              fontSize: '11px',
              color: 'var(--neon-text-dim)',
              flex: 1,
              fontFamily: 'var(--bde-font-code)'
            }}
          >
            {attachment.name}
          </span>
          <button
            onClick={() => setAttachment(null)}
            title="Remove attachment"
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              border: '1px solid var(--neon-red-border)',
              background: 'var(--neon-red-surface)',
              color: 'var(--neon-red)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              padding: 0
            }}
          >
            <X size={12} />
          </button>
        </div>
      )}
      <div className="command-bar__prompt">&gt;</div>
      <textarea
        ref={inputRef}
        className="command-bar__input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        disabled={disabled}
        placeholder={
          disabled && disabledReason
            ? disabledReason
            : 'Message the agent… (Shift+Enter for newline)'
        }
        aria-label="Agent command input"
        autoFocus
        rows={1}
        style={{ resize: 'none', overflow: 'hidden' }}
      />
    </div>
  )
}
