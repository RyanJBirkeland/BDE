/**
 * AboutSection — app version and source link.
 */
import { ExternalLink } from 'lucide-react'
import { Button } from '../ui/Button'

const APP_VERSION = __APP_VERSION__
const GITHUB_URL = 'https://github.com/RyanJBirkeland/BDE'

export function AboutSection(): React.JSX.Element {
  return (
    <section className="settings-section">
      <h2 className="settings-section__title bde-section-title">About</h2>
      <div className="settings-about">
        <div className="settings-about__row">
          <span className="settings-about__label">Version</span>
          <span className="settings-about__value">{APP_VERSION}</span>
        </div>
        <div className="settings-about__row">
          <span className="settings-about__label">Source</span>
          <Button
            variant="ghost"
            size="sm"
            className="settings-about__link"
            onClick={() => window.api.openExternal(GITHUB_URL)}
            type="button"
          >
            GitHub <ExternalLink size={12} />
          </Button>
        </div>
      </div>
    </section>
  )
}
