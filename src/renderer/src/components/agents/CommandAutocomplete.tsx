import { useState, useEffect } from 'react'

interface Command {
  name: string
  description: string
}

const COMMANDS: Command[] = [
  { name: '/stop', description: 'Kill the running agent' },
  { name: '/retry', description: 'Requeue the sprint task' },
  { name: '/focus', description: 'Steer to focus on a topic' }
]

interface CommandAutocompleteProps {
  query: string
  onSelect: (command: string) => void
  onClose: () => void
}

export function CommandAutocomplete({
  query,
  onSelect,
  onClose
}: CommandAutocompleteProps): React.JSX.Element | null {
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Filter commands by query (prefix match after /)
  const filteredCommands = COMMANDS.filter((cmd) =>
    cmd.name.toLowerCase().startsWith(query.toLowerCase())
  )

  // Reset selection when filtered commands change
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => Math.max(prev - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (filteredCommands[selectedIndex]) {
            onSelect(filteredCommands[selectedIndex].name)
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [filteredCommands, selectedIndex, onSelect, onClose])

  if (filteredCommands.length === 0) {
    return null
  }

  return (
    <div className="command-autocomplete">
      {filteredCommands.map((cmd, index) => (
        <div
          key={cmd.name}
          className={`command-autocomplete__item ${
            index === selectedIndex ? 'command-autocomplete__item--active' : ''
          }`}
          onClick={() => onSelect(cmd.name)}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <span className="command-autocomplete__item-command">{cmd.name}</span>
          <span className="command-autocomplete__item-description">— {cmd.description}</span>
        </div>
      ))}
    </div>
  )
}
