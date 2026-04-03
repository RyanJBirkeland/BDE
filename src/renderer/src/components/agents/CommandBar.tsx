import { useState, useCallback, useRef, useEffect } from 'react'
import { CommandAutocomplete } from './CommandAutocomplete'

interface CommandBarProps {
  onSend: (message: string) => void
  onCommand: (cmd: string, args?: string) => void
  disabled?: boolean
  disabledReason?: string
}

const COMMANDS = [
  { name: '/stop', description: 'Kill the running agent' },
  { name: '/retry', description: 'Requeue the sprint task' },
  { name: '/focus', description: 'Steer to focus on a topic' }
]

export function CommandBar({
  onSend,
  onCommand,
  disabled = false,
  disabledReason
}: CommandBarProps): React.JSX.Element {
  const [value, setValue] = useState('')
  const [autocompleteHidden, setAutocompleteHidden] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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
    inputRef.current?.focus()
  }, [])

  const handleAutocompleteClose = useCallback((): void => {
    setAutocompleteHidden(true)
    inputRef.current?.focus()
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
        aria-label="Agent command input"
        autoFocus
      />
    </div>
  )
}
