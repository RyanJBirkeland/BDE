/**
 * AboutSection — app version, update check, source link, and API usage stats.
 */
import { useState, useEffect, useRef } from 'react'
import './AboutSection.css'
import { ExternalLink, Keyboard } from 'lucide-react'
import { Button } from '../ui/Button'
import { SettingsCard } from './SettingsCard'
import { CostSection } from './CostSection'

const APP_VERSION = __APP_VERSION__
const GITHUB_URL = 'https://github.com/RyanJBirkeland/FLEET/releases'
const LOG_PATH = '~/.fleet/fleet.log'

type UpdateStatus = {
  status: 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error'
  version?: string | undefined
  percent?: number | undefined
  error?: string | undefined
}

function updateButtonLabel(status: UpdateStatus['status']): string {
  switch (status) {
    case 'checking':    return 'Checking…'
    case 'available':
    case 'downloading': return 'Downloading…'
    case 'ready':       return 'Restart to Update'
    default:            return 'Check for Updates'
  }
}

function updateStatusText(update: UpdateStatus | null): string | null {
  if (!update) return null
  switch (update.status) {
    case 'checking': return null
    case 'up-to-date': return "You're up to date."
    case 'available': return `v${update.version ?? ''} available — downloading…`
    case 'downloading': return `Downloading… ${Math.round(update.percent ?? 0)}%`
    case 'ready': return `v${update.version ?? ''} ready to install. Restart to apply.`
    case 'error': return `Update check failed: ${update.error ?? 'unknown error'}`
    default: return null
  }
}

export function AboutSection(): React.JSX.Element {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const unsub = window.api.updates.onStatus((payload) => {
      setUpdateStatus(payload)
      // Auto-clear "up-to-date" after 4 seconds
      if (payload.status === 'up-to-date') {
        if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
        clearTimerRef.current = setTimeout(() => setUpdateStatus(null), 4000)
      }
    })
    return () => {
      unsub()
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
    }
  }, [])

  const handleShowShortcuts = (): void => {
    window.dispatchEvent(new CustomEvent('fleet:show-shortcuts'))
  }

  const handleUpdateClick = (): void => {
    if (updateStatus?.status === 'ready') {
      void window.api.updates.install()
    } else {
      void window.api.updates.checkForUpdates()
    }
  }

  const isUpdateBusy =
    updateStatus?.status === 'checking' ||
    updateStatus?.status === 'available' ||
    updateStatus?.status === 'downloading'
  const buttonLabel = updateStatus ? updateButtonLabel(updateStatus.status) : 'Check for Updates'
  const statusText = updateStatusText(updateStatus)

  return (
    <section className="settings-section">
      <h2 className="settings-section__title fleet-section-title">About</h2>
      <SettingsCard title="About FLEET">
        <div className="settings-about">
          <div className="settings-about__row">
            <span className="settings-about__label">Version</span>
            <span className="settings-about__value">{APP_VERSION}</span>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              disabled={isUpdateBusy}
              onClick={handleUpdateClick}
              className="settings-about__update-btn"
            >
              {buttonLabel}
            </Button>
          </div>
          {statusText && (
            <div
              className={`settings-about__update-status${updateStatus?.status === 'error' ? ' settings-about__update-status--error' : ''}`}
            >
              {statusText}
            </div>
          )}
          <div className="settings-about__row">
            <span className="settings-about__label">Log Path</span>
            <span className="settings-about__value">{LOG_PATH}</span>
          </div>
          <div className="settings-about__row">
            <span className="settings-about__label">Source</span>
            <Button
              variant="ghost"
              size="sm"
              className="settings-about__link"
              onClick={() => window.api.window.openExternal(GITHUB_URL)}
              type="button"
            >
              GitHub <ExternalLink size={12} />
            </Button>
          </div>
          <div className="settings-about__row">
            <span className="settings-about__label">Shortcuts</span>
            <Button
              variant="ghost"
              size="sm"
              className="settings-about__link"
              onClick={handleShowShortcuts}
              type="button"
            >
              Keyboard Shortcuts <Keyboard size={12} />
            </Button>
          </div>
        </div>
      </SettingsCard>

      <CostSection />
    </section>
  )
}
