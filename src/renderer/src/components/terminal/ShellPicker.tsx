import { useCallback, useEffect, useRef, useState } from 'react'

interface ShellPickerProps {
  onSelect: (shell: string) => void
  onClose: () => void
}

const SHELL_GROUPS = [
  { items: [{ label: 'Default Shell', shortcut: '⌘T', value: '' }] },
  {
    items: [
      { label: 'zsh', value: '/bin/zsh' },
      { label: 'bash', value: '/bin/bash' },
      { label: 'fish', value: '/usr/local/bin/fish' }
    ]
  },
  {
    items: [
      { label: 'node', value: 'node' },
      { label: 'python3', value: 'python3' }
    ]
  }
]

export function ShellPicker({ onSelect, onClose }: ShellPickerProps): React.JSX.Element {
  const [showCustom, setShowCustom] = useState(false)
  const [customValue, setCustomValue] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const customInputRef = useRef<HTMLInputElement>(null)

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Focus custom input when shown
  useEffect(() => {
    if (showCustom) customInputRef.current?.focus()
  }, [showCustom])

  const handleCustomSubmit = useCallback(() => {
    const val = customValue.trim()
    if (val) {
      onSelect(val)
    }
  }, [customValue, onSelect])

  return (
    <div ref={ref} className="shell-picker">
      {SHELL_GROUPS.map((group, gi) => (
        <div key={gi}>
          {gi > 0 && <div className="shell-picker__divider" />}
          {group.items.map((item) => (
            <button
              key={item.label}
              className={`shell-picker__item${item.shortcut ? ' shell-picker__item--header' : ''}`}
              onClick={() => onSelect(item.value)}
            >
              <span>{item.label}</span>
              {item.shortcut && <span className="shell-picker__shortcut">{item.shortcut}</span>}
            </button>
          ))}
        </div>
      ))}
      <div className="shell-picker__divider" />
      {showCustom ? (
        <div className="shell-picker__custom-row">
          <input
            ref={customInputRef}
            className="shell-picker__custom-input"
            type="text"
            placeholder="/path/to/shell"
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleCustomSubmit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setShowCustom(false)
                setCustomValue('')
              }
            }}
          />
        </div>
      ) : (
        <button className="shell-picker__item" onClick={() => setShowCustom(true)}>
          Custom…
        </button>
      )}
    </div>
  )
}
