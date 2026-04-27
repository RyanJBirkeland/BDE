/**
 * AppearanceSection — theme toggle, accent color picker, window behavior,
 * notification preferences, and keyboard shortcut customization.
 */
import './AppearanceSection.css'
import { useCallback, useEffect, useState } from 'react'
import { useThemeStore } from '../../stores/theme'
import { toast } from '../../stores/toasts'
import { SettingsCard } from './SettingsCard'
import { NotificationsSection } from './NotificationsSection'
import { KeybindingsSettings } from './KeybindingsSettings'

const ACCENT_PRESETS = [
  { color: '#00D37F', label: 'Green' },
  { color: '#3B82F6', label: 'Blue' },
  { color: '#8B5CF6', label: 'Purple' },
  { color: '#F97316', label: 'Orange' },
  { color: '#EF4444', label: 'Red' },
  { color: '#FFFFFF', label: 'White' }
]

function useAccentColor(): [string, (color: string) => void] {
  const [accent, setAccentState] = useState(
    () => localStorage.getItem('fleet-accent') ?? '#00D37F' /* intentional: default accent */
  )

  const setAccent = useCallback((color: string) => {
    localStorage.setItem('fleet-accent', color)
    document.documentElement.style.setProperty('--fleet-accent', color)
    setAccentState(color)
  }, [])

  useEffect(() => {
    const saved = localStorage.getItem('fleet-accent')
    if (saved) {
      document.documentElement.style.setProperty('--fleet-accent', saved)
    }
  }, [])

  return [accent, setAccent]
}

function useTearoffClosePreference(): [string | null, () => void] {
  const [pref, setPrefState] = useState<string | null>(null)

  useEffect(() => {
    window.api?.settings
      ?.get('tearoff.closeAction')
      .then((val) => {
        setPrefState(val ?? null)
      })
      .catch((err) => {
        console.error('Failed to load tear-off close action preference:', err)
      })
  }, [])

  const reset = useCallback(() => {
    window.api?.settings
      ?.delete('tearoff.closeAction')
      .then(() => {
        setPrefState(null)
        toast.success("Tear-off close preference reset — you'll be asked next time")
      })
      .catch((err) => {
        console.error('Failed to reset tear-off close action preference:', err)
      })
  }, [])

  return [pref, reset]
}

export function AppearanceSection(): React.JSX.Element {
  const [accent, setAccent] = useAccentColor()
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const [tearoffPref, resetTearoffPref] = useTearoffClosePreference()

  return (
    <>
      <SettingsCard title="Theme" subtitle="Choose your visual theme">
        <div className="settings-theme-buttons">
          <button
            className={`fleet-btn fleet-btn--sm ${theme === 'system' ? 'fleet-btn--primary' : 'fleet-btn--ghost'}`}
            onClick={() => setTheme('system')}
            type="button"
            aria-pressed={theme === 'system'}
            title="Follow the OS light/dark mode preference"
          >
            System
          </button>
          <button
            className={`fleet-btn fleet-btn--sm ${theme === 'dark' ? 'fleet-btn--primary' : 'fleet-btn--ghost'}`}
            onClick={() => setTheme('dark')}
            type="button"
            aria-pressed={theme === 'dark'}
          >
            Dark
          </button>
          <button
            className={`fleet-btn fleet-btn--sm ${theme === 'light' ? 'fleet-btn--primary' : 'fleet-btn--ghost'}`}
            onClick={() => setTheme('light')}
            type="button"
            aria-pressed={theme === 'light'}
          >
            Light
          </button>
        </div>
      </SettingsCard>

      <SettingsCard title="Accent Color">
        <div className="settings-colors">
          {ACCENT_PRESETS.map(({ color, label }) => (
            <button
              key={color}
              className={`settings-color ${accent === color ? 'settings-color--active' : ''}`}
              style={{ background: color }}
              onClick={() => setAccent(color)}
              title={label}
              aria-label={label}
              aria-pressed={accent === color}
              type="button"
            />
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="Tear-Off Windows" subtitle="Window close behavior">
        <div className="settings-theme-buttons">
          {tearoffPref ? (
            <>
              <span className="settings-help-text">
                Always {tearoffPref === 'return' ? 'return to main' : 'close'}
              </span>
              <button
                className="fleet-btn fleet-btn--sm fleet-btn--ghost"
                onClick={resetTearoffPref}
                type="button"
              >
                Reset
              </button>
            </>
          ) : (
            <span className="settings-help-text settings-help-text--dim">Ask each time</span>
          )}
        </div>
      </SettingsCard>

      <NotificationsSection />

      <SettingsCard title="Keyboard Shortcuts" subtitle="Customize keyboard shortcuts">
        <KeybindingsSettings />
      </SettingsCard>
    </>
  )
}
