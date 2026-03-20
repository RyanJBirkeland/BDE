/**
 * AppearanceSection — theme toggle and accent color picker.
 */
import { useCallback, useEffect, useState } from 'react'
import { useThemeStore } from '../../stores/theme'

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
    () => localStorage.getItem('bde-accent') ?? '#00D37F' /* intentional: default accent */
  )

  const setAccent = useCallback((color: string) => {
    localStorage.setItem('bde-accent', color)
    document.documentElement.style.setProperty('--bde-accent', color)
    setAccentState(color)
  }, [])

  useEffect(() => {
    const saved = localStorage.getItem('bde-accent')
    if (saved) {
      document.documentElement.style.setProperty('--bde-accent', saved)
    }
  }, [])

  return [accent, setAccent]
}

export function AppearanceSection(): React.JSX.Element {
  const [accent, setAccent] = useAccentColor()
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  return (
    <section className="settings-section">
      <h2 className="settings-section__title bde-section-title">Appearance</h2>
      <div className="settings-field">
        <span className="settings-field__label">Theme</span>
        <div className="settings-theme-buttons">
          <button
            className={`bde-btn bde-btn--sm ${theme === 'dark' ? 'bde-btn--primary' : 'bde-btn--ghost'}`}
            onClick={() => setTheme('dark')}
            type="button"
          >Dark</button>
          <button
            className={`bde-btn bde-btn--sm ${theme === 'light' ? 'bde-btn--primary' : 'bde-btn--ghost'}`}
            onClick={() => setTheme('light')}
            type="button"
          >Light</button>
        </div>
      </div>
      <div className="settings-field">
        <span className="settings-field__label">Accent Color</span>
        <div className="settings-colors">
          {ACCENT_PRESETS.map(({ color, label }) => (
            <button
              key={color}
              className={`settings-color ${accent === color ? 'settings-color--active' : ''}`}
              style={{ background: color }}
              onClick={() => setAccent(color)}
              title={label}
              type="button"
            />
          ))}
        </div>
      </div>
    </section>
  )
}
