import { useState, useEffect, useMemo } from 'react'
import {
  useKeybindingsStore,
  ACTION_LABELS,
  DEFAULT_KEYBINDINGS,
  type ActionId
} from '../../stores/keybindings'
import { Button } from '../ui/Button'
import { AlertTriangle } from 'lucide-react'

/**
 * KeybindingsSettings — table UI for customizing keyboard shortcuts.
 * Features:
 * - Click-to-record mode for capturing key combos
 * - Per-row reset to default
 * - Duplicate detection warnings
 * - Global reset-all button
 */

const ACTION_ORDER: ActionId[] = [
  'view.dashboard',
  'view.agents',
  'view.ide',
  'view.sprint',
  'view.codeReview',
  'view.git',
  'view.settings',
  'view.planner',
  'palette.toggle',
  'quickCreate.toggle',
  'refresh',
  'panel.splitRight',
  'panel.closeTab',
  'panel.nextTab',
  'panel.prevTab',
  'shortcuts.show'
]

function formatKeyEvent(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.metaKey) parts.push('⌘')
  if (e.ctrlKey && !e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('⌥')
  if (e.shiftKey) parts.push('⇧')

  // Special key names
  const keyMap: Record<string, string> = {
    ' ': 'Space',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Escape: 'Esc',
    Backspace: '⌫',
    Delete: '⌦',
    Enter: '↵',
    Tab: '⇥'
  }

  const key = keyMap[e.key] ?? e.key.toUpperCase()

  // Skip modifier-only combos
  if (['META', 'CONTROL', 'ALT', 'SHIFT'].includes(key.toUpperCase())) {
    return ''
  }

  parts.push(key)
  return parts.join('')
}

export function KeybindingsSettings(): React.JSX.Element {
  const bindings = useKeybindingsStore((s) => s.bindings)
  const setBinding = useKeybindingsStore((s) => s.setBinding)
  const resetToDefaults = useKeybindingsStore((s) => s.resetToDefaults)
  const findDuplicates = useKeybindingsStore((s) => s.findDuplicates)

  const [recording, setRecording] = useState<ActionId | null>(null)

  const duplicates = useMemo(() => findDuplicates(), [findDuplicates])

  useEffect(() => {
    if (!recording) return

    const handler = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        setRecording(null)
        return
      }

      const combo = formatKeyEvent(e)
      if (combo) {
        setBinding(recording, combo)
        setRecording(null)
      }
    }

    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [recording, setBinding])

  const isDuplicate = (actionId: ActionId): boolean => {
    return duplicates.some((d) => d.actions.includes(actionId) && d.actions.length > 1)
  }

  const getDuplicateWarning = (actionId: ActionId): string | null => {
    const dup = duplicates.find((d) => d.actions.includes(actionId) && d.actions.length > 1)
    if (!dup) return null
    const others = dup.actions.filter((a) => a !== actionId)
    return `Also assigned to: ${others.map((a) => ACTION_LABELS[a]).join(', ')}`
  }

  const handleReset = (actionId: ActionId): void => {
    setBinding(actionId, DEFAULT_KEYBINDINGS[actionId])
  }

  const handleResetAll = (): void => {
    if (confirm('Reset all keybindings to defaults?')) {
      resetToDefaults()
    }
  }

  return (
    <div className="stg-section">
      <div className="stg-section__header">
        <p className="stg-section__description">
          Click any keybinding to record a new shortcut. Press <kbd>Esc</kbd> to cancel.
        </p>
        <Button onClick={handleResetAll} variant="ghost" size="sm">
          Reset All to Defaults
        </Button>
      </div>

      <div className="stg-keybindings">
        <table className="stg-keybindings__table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Keybinding</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ACTION_ORDER.map((actionId) => {
              const current = bindings[actionId]
              const isRecordingThis = recording === actionId
              const hasDuplicate = isDuplicate(actionId)
              const dupWarning = getDuplicateWarning(actionId)

              return (
                <tr key={actionId} className={hasDuplicate ? 'stg-keybindings__row--warning' : ''}>
                  <td className="stg-keybindings__label">{ACTION_LABELS[actionId]}</td>
                  <td className="stg-keybindings__value">
                    <button
                      className={`stg-keybindings__recorder ${isRecordingThis ? 'stg-keybindings__recorder--active' : ''}`}
                      onClick={() => setRecording(actionId)}
                      aria-label={`Record keybinding for ${ACTION_LABELS[actionId]}`}
                    >
                      {isRecordingThis ? 'Press a key…' : current}
                    </button>
                    {hasDuplicate && (
                      <span className="stg-keybindings__warning" title={dupWarning ?? ''}>
                        <AlertTriangle size={14} />
                      </span>
                    )}
                  </td>
                  <td className="stg-keybindings__actions">
                    {current !== DEFAULT_KEYBINDINGS[actionId] && (
                      <Button onClick={() => handleReset(actionId)} variant="ghost" size="sm">
                        Reset
                      </Button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {duplicates.length > 0 && (
        <div className="stg-keybindings__duplicates">
          <AlertTriangle size={16} />
          <span>
            Warning: {duplicates.length} duplicate keybinding{duplicates.length > 1 ? 's' : ''}{' '}
            detected
          </span>
        </div>
      )}
    </div>
  )
}
