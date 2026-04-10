import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { X } from 'lucide-react'
import './CommandBar.css'
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

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>): Promise<void> => {
    const items = e.clipboardData.items
    let imageBlob: Blob | null = null

    // Try the web clipboard API first (works for images dragged from browser, etc.)
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        imageBlob = items[i].getAsFile()
        break
      }
    }

    if (imageBlob) {
      // Web API path — blob already in hand
      e.preventDefault()
      const MAX_SIZE = 5 * 1024 * 1024
      if (imageBlob.size > MAX_SIZE) {
        toast.error('Image too large (max 5MB)')
        return
      }
      const reader = new FileReader()
      reader.onerror = () => toast.error('Failed to read image')
      reader.onload = () => {
        const dataUrl = reader.result as string
        setAttachment({
          path: '',
          name: `paste-${Date.now()}.png`,
          type: 'image',
          mimeType: imageBlob!.type || 'image/png',
          data: dataUrl.split(',')[1],
          preview: dataUrl
        })
      }
      reader.readAsDataURL(imageBlob)
      return
    }

    // Fallback: ask the main process to read via Electron's native clipboard API.
    // macOS screenshots (Cmd+Shift+4, Cmd+Shift+3, screencap) and images copied
    // from native apps are often only available via nativeImage, not clipboardData.
    //
    // Because the paste event handler goes async here, e.preventDefault() would
    // have no effect after the await — the browser processes the event synchronously.
    // Instead: capture the text content now, prevent default immediately, then
    // re-insert the text manually if we end up finding no image.
    const pastedText = e.clipboardData.getData('text/plain')
    e.preventDefault()

    try {
      const result = await window.api.readClipboardImage()
      if (result) {
        setAttachment({
          path: '',
          name: `paste-${Date.now()}.png`,
          type: 'image',
          mimeType: result.mimeType,
          data: result.data,
          preview: `data:${result.mimeType};base64,${result.data}`
        })
        return
      }
    } catch {
      // Clipboard read failed — fall through to text insertion
    }

    // No image found — manually insert the pasted text at the cursor position
    if (pastedText) {
      const el = inputRef.current
      const start = el?.selectionStart ?? value.length
      const end = el?.selectionEnd ?? value.length
      const newValue = value.slice(0, start) + pastedText + value.slice(end)
      setValue(newValue)
      if (el) {
        requestAnimationFrame(() => {
          el.setSelectionRange(start + pastedText.length, start + pastedText.length)
        })
      }
    }
  }, [value])

  return (
    <div
      className={`command-bar${disabled ? ' command-bar--disabled' : ''}`}
      style={{ position: 'relative', flexDirection: 'column', alignItems: 'stretch', gap: 0 }}
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
            padding: '8px 12px',
            borderBottom: '1px solid var(--bde-accent-border)',
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
              border: '1px solid var(--bde-accent-border)',
              objectFit: 'contain'
            }}
          />
          <span
            style={{
              fontSize: '11px',
              color: 'var(--bde-text-muted)',
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
              border: '1px solid var(--bde-danger-border)',
              background: 'var(--bde-danger-surface)',
              color: 'var(--bde-danger)',
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px' }}>
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
    </div>
  )
}
