/**
 * AboutSection — app version, source link, and API usage stats.
 */
import './AboutSection.css'
import { ExternalLink, Keyboard } from 'lucide-react'
import { Button } from '../ui/Button'
import { SettingsCard } from './SettingsCard'
import { CostSection } from './CostSection'

const APP_VERSION = __APP_VERSION__
const GITHUB_URL = 'https://github.com/RyanJBirkeland/BDE/releases'
const LOG_PATH = '~/.bde/bde.log'

export function AboutSection(): React.JSX.Element {
  const handleShowShortcuts = (): void => {
    window.dispatchEvent(new CustomEvent('bde:show-shortcuts'))
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section__title bde-section-title">About</h2>
      <SettingsCard title="About BDE">
        <div className="settings-about">
          <div className="settings-about__row">
            <span className="settings-about__label">Version</span>
            <span className="settings-about__value">{APP_VERSION}</span>
          </div>
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
