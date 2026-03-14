import { useCallback, useEffect, useState } from 'react'
import { Eye, EyeOff, ExternalLink } from 'lucide-react'
import { useGatewayStore } from '../stores/gateway'
import { toast } from '../stores/toasts'

const ACCENT_PRESETS = [
  { color: '#00D37F', label: 'Green' },
  { color: '#3B82F6', label: 'Blue' },
  { color: '#8B5CF6', label: 'Purple' },
  { color: '#F97316', label: 'Orange' },
  { color: '#EF4444', label: 'Red' },
  { color: '#FFFFFF', label: 'White' }
]

const APP_VERSION = '0.1.0'
const GITHUB_URL = 'https://github.com/RyanJBirkeland/BDE'

function useAccentColor(): [string, (color: string) => void] {
  const [accent, setAccentState] = useState(
    () => localStorage.getItem('bde-accent') ?? '#00D37F'
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

export default function SettingsView(): React.JSX.Element {
  const status = useGatewayStore((s) => s.status)
  const reconnect = useGatewayStore((s) => s.reconnect)

  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null)
  const [repos, setRepos] = useState<Record<string, string>>({})
  const [accent, setAccent] = useAccentColor()

  // Load initial config
  useEffect(() => {
    window.api.getGatewayConfig().then(({ url: u, token: t }) => {
      setUrl(u)
      setToken(t)
    })
    window.api.getRepoPaths().then(setRepos)
  }, [])

  const handleUrlChange = useCallback((value: string) => {
    setUrl(value)
    setDirty(true)
    setTestResult(null)
  }, [])

  const handleTokenChange = useCallback((value: string) => {
    setToken(value)
    setDirty(true)
    setTestResult(null)
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await window.api.saveGatewayConfig(url, token)
      setDirty(false)
      toast.success('Gateway config saved')
      await reconnect()
    } catch {
      toast.error('Failed to save config')
    } finally {
      setSaving(false)
    }
  }, [url, token, reconnect])

  const handleTest = useCallback(async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const wsUrl = new URL(url)
      wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(wsUrl.toString(), ['openclaw', token])

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close()
          reject(new Error('timeout'))
        }, 5000)
        ws.onopen = (): void => {
          clearTimeout(timeout)
          ws.close()
          resolve()
        }
        ws.onerror = (): void => {
          clearTimeout(timeout)
          reject(new Error('connection failed'))
        }
      })

      setTestResult('success')
      toast.success('Connection successful')
    } catch {
      setTestResult('error')
      toast.error('Connection failed')
    } finally {
      setTesting(false)
    }
  }, [url, token])

  return (
    <div className="settings-view">
      <div className="settings-view__scroll">
        <h1 className="settings-view__title">Settings</h1>

        {/* Gateway */}
        <section className="settings-section">
          <h2 className="settings-section__title">Gateway</h2>

          <label className="settings-field">
            <span className="settings-field__label">Gateway URL</span>
            <input
              className="settings-field__input"
              type="text"
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="ws://127.0.0.1:18789"
            />
          </label>

          <label className="settings-field">
            <span className="settings-field__label">Gateway Token</span>
            <div className="settings-field__password">
              <input
                className="settings-field__input"
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => handleTokenChange(e.target.value)}
                placeholder="Token from openclaw.json"
              />
              <button
                className="settings-field__toggle"
                onClick={() => setShowToken((v) => !v)}
                title={showToken ? 'Hide token' : 'Show token'}
                type="button"
              >
                {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </label>

          <div className="settings-field__row">
            <div className="settings-field__status">
              <div
                className={`settings-field__dot settings-field__dot--${status}`}
              />
              <span className="settings-field__status-text">
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </span>
            </div>

            <div className="settings-field__actions">
              <button
                className="settings-btn settings-btn--secondary"
                onClick={handleTest}
                disabled={testing || !url || !token}
                type="button"
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              {testResult && (
                <span
                  className={`settings-field__test-result settings-field__test-result--${testResult}`}
                >
                  {testResult === 'success' ? 'OK' : 'Failed'}
                </span>
              )}
              <button
                className="settings-btn settings-btn--primary"
                onClick={handleSave}
                disabled={!dirty || saving || !url || !token}
                type="button"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </section>

        {/* Repositories */}
        <section className="settings-section">
          <h2 className="settings-section__title">Repositories</h2>
          <div className="settings-repos">
            {Object.entries(repos).map(([name, path]) => (
              <div key={name} className="settings-repo">
                <span className="settings-repo__name">{name}</span>
                <span className="settings-repo__path">{path}</span>
              </div>
            ))}
            {Object.keys(repos).length === 0 && (
              <span className="settings-repos__empty">No repositories configured</span>
            )}
          </div>
        </section>

        {/* Appearance */}
        <section className="settings-section">
          <h2 className="settings-section__title">Appearance</h2>
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

        {/* About */}
        <section className="settings-section">
          <h2 className="settings-section__title">About</h2>
          <div className="settings-about">
            <div className="settings-about__row">
              <span className="settings-about__label">Version</span>
              <span className="settings-about__value">{APP_VERSION}</span>
            </div>
            <div className="settings-about__row">
              <span className="settings-about__label">Source</span>
              <button
                className="settings-about__link"
                onClick={() => window.api.openExternal(GITHUB_URL)}
                type="button"
              >
                GitHub <ExternalLink size={12} />
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
