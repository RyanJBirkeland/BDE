import { useState, useCallback, useRef, useEffect } from 'react'
import { CommandAutocomplete } from './CommandAutocomplete'

interface CommandBarProps {
  onSend: (message: string) => void
  onCommand: (cmd: string, args?: string) => void
  disabled?: boolean
  disabledReason?: string
}

export function CommandBar({
  onSend,
  onCommand,
  disabled = false,
  disabledReason
}: CommandBarProps): React.JSX.Element {
  const [value, setValue] = useState('')
  const [showAutocomplete, setShowAutocomplete] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Show autocomplete when typing /
  useEffect(() => {
    if (value.startsWith('/') && value.length > 0) {
      setShowAutocomplete(true)
    } else {
      setShowAutocomplete(false)
    }
  }, [value])

  const handleSubmit = useCallback((): void => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return

    // Check if it's a command
    if (trimmed.startsWith('/')) {
      const parts = trimmed.split(/\s+/)
      const command = parts[0]
      const args = parts.slice(1).join(' ')
      onCommand(command, args || undefined)
    } else {
      onSend(trimmed)
    }

    setValue('')
    setShowAutocomplete(false)
  }, [value, disabled, onCommand, onSend])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>): void => {
      // Let autocomplete handle these keys when shown
      if (showAutocomplete && ['ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) {
        return
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        // Don't prevent default if autocomplete is showing - let it handle Enter
        if (!showAutocomplete) {
          e.preventDefault()
          handleSubmit()
        }
      }
    },
    [showAutocomplete, handleSubmit]
  )

  const handleAutocompleteSelect = useCallback((command: string): void => {
    setValue(command + ' ')
    setShowAutocomplete(false)
    inputRef.current?.focus()
  }, [])

  const handleAutocompleteClose = useCallback((): void => {
    setShowAutocomplete(false)
    inputRef.current?.focus()
  }, [])

  return (
    <div className="command-bar" style={{ position: 'relative' }}>
      {showAutocomplete && (
        <CommandAutocomplete
          query={value}
          onSelect={handleAutocompleteSelect}
          onClose={handleAutocompleteClose}
        />
      )}
      <div className="command-bar__prompt">&gt;</div>
      <input
        ref={inputRef}
        type="text"
        className="command-bar__input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={
          disabled && disabledReason ? disabledReason : 'Type a message or / for commands...'
        }
        autoFocus
      />
    </div>
  )
}
