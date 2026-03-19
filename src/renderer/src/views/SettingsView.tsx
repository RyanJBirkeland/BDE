/**
 * SettingsView -- application configuration panel.
 * Manages gateway URL/token, GitHub token, task runner config,
 * repositories (add/remove with path picker, GitHub owner/repo fields),
 * theme switching, accent color presets, agent runtime config, and about info.
 */
import { useCallback, useEffect, useState } from 'react'
import { Eye, EyeOff, ExternalLink, Trash2, Plus, FolderOpen } from 'lucide-react'
import { useGatewayStore } from '../stores/gateway'
import { useThemeStore } from '../stores/theme'
import { toast } from '../stores/toasts'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'

/* intentional: literal color values for accent color picker swatches */
const ACCENT_PRESETS = [
  { color: '#00D37F', label: 'Green' },
  { color: '#3B82F6', label: 'Blue' },
  { color: '#8B5CF6', label: 'Purple' },
  { color: '#F97316', label: 'Orange' },
  { color: '#EF4444', label: 'Red' },
  { color: '#FFFFFF', label: 'White' }
]

const REPO_COLOR_PALETTE = [
  '#6C8EEF', '#00D37F', '#FF8A00', '#EF4444', '#8B5CF6',
  '#3B82F6', '#F97316', '#06B6D4',
]

const PERMISSION_MODES = [
  { value: 'bypassPermissions', label: 'Bypass (no prompts)' },
  { value: 'default', label: 'Default (prompt for risky ops)' },
  { value: 'plan', label: 'Plan (read-only, no writes)' }
]

const APP_VERSION = __APP_VERSION__
const GITHUB_URL = 'https://github.com/RyanJBirkeland/BDE'

interface RepoConfig {
  name: string
  localPath: string
  githubOwner?: string
  githubRepo?: string
  color?: string
}

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

// ---- Repositories Section ----

function RepositoriesSection(): React.JSX.Element {
  const [repos, setRepos] = useState<RepoConfig[]>([])
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPath, setNewPath] = useState('')
  const [newOwner, setNewOwner] = useState('')
  const [newRepo, setNewRepo] = useState('')
  const [newColor, setNewColor] = useState(REPO_COLOR_PALETTE[0])

  useEffect(() => {
    window.api.settings.getJson('repos').then((raw) => {
      if (Array.isArray(raw)) setRepos(raw as RepoConfig[])
    })
  }, [])

  const saveRepos = useCallback(async (updated: RepoConfig[]) => {
    await window.api.settings.setJson('repos', updated)
    setRepos(updated)
  }, [])

  const handleRemove = useCallback(
    (name: string) => {
      const updated = repos.filter((r) => r.name !== name)
      saveRepos(updated)
      toast.success(`Removed "${name}"`)
    },
    [repos, saveRepos]
  )

  const handleAdd = useCallback(async () => {
    if (!newName.trim() || !newPath.trim()) return
    const updated = [
      ...repos,
      {
        name: newName.trim(),
        localPath: newPath.trim(),
        githubOwner: newOwner.trim() || undefined,
        githubRepo: newRepo.trim() || undefined,
        color: newColor,
      },
    ]
    await saveRepos(updated)
    setAdding(false)
    setNewName('')
    setNewPath('')
    setNewOwner('')
    setNewRepo('')
    setNewColor(REPO_COLOR_PALETTE[0])
    toast.success(`Added "${newName.trim()}"`)
  }, [repos, newName, newPath, newOwner, newRepo, newColor, saveRepos])

  const handleBrowse = useCallback(async () => {
    const dir = await window.api.openDirectoryDialog()
    if (dir) setNewPath(dir)
  }, [])

  return (
    <section className="settings-section">
      <h2 className="settings-section__title bde-section-title">Repositories</h2>
      <div className="settings-repos">
        {repos.map((r) => (
          <div key={r.name} className="settings-repo">
            <span
              className="settings-repo__dot"
              style={{ background: r.color ?? 'var(--bde-text-dim)' }}
            />
            <span className="settings-repo__name">{r.name}</span>
            <span className="settings-repo__path">{r.localPath}</span>
            {r.githubOwner && r.githubRepo && (
              <span className="settings-repo__github">
                {r.githubOwner}/{r.githubRepo}
              </span>
            )}
            <Button
              variant="icon"
              size="sm"
              onClick={() => handleRemove(r.name)}
              title="Remove repository"
              type="button"
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
        {repos.length === 0 && !adding && (
          <span className="settings-repos__empty">No repositories configured</span>
        )}
      </div>

      {adding ? (
        <div className="settings-repo-form">
          <div className="settings-repo-form__row">
            <input
              className="settings-field__input"
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <div className="settings-repo-form__path-row">
              <input
                className="settings-field__input"
                placeholder="Local path"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
              />
              <Button variant="ghost" size="sm" onClick={handleBrowse} title="Browse" type="button">
                <FolderOpen size={14} />
              </Button>
            </div>
          </div>
          <div className="settings-repo-form__row">
            <input
              className="settings-field__input"
              placeholder="GitHub owner (optional)"
              value={newOwner}
              onChange={(e) => setNewOwner(e.target.value)}
            />
            <input
              className="settings-field__input"
              placeholder="GitHub repo (optional)"
              value={newRepo}
              onChange={(e) => setNewRepo(e.target.value)}
            />
          </div>
          <div className="settings-repo-form__row">
            <div className="settings-colors">
              {REPO_COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  className={`settings-color ${newColor === c ? 'settings-color--active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setNewColor(c)}
                  type="button"
                />
              ))}
            </div>
            <div className="settings-repo-form__actions">
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)} type="button">
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleAdd}
                disabled={!newName.trim() || !newPath.trim()}
                type="button"
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAdding(true)}
          type="button"
          className="settings-repos__add-btn"
        >
          <Plus size={14} /> Add Repository
        </Button>
      )}
    </section>
  )
}

// ---- Connections Section ----

function ConnectionsSection(): React.JSX.Element {
  const status = useGatewayStore((s) => s.status)
  const reconnect = useGatewayStore((s) => s.reconnect)

  const [gwUrl, setGwUrl] = useState('')
  const [gwToken, setGwToken] = useState('')
  const [showGwToken, setShowGwToken] = useState(false)
  const [hasExistingGwToken, setHasExistingGwToken] = useState(false)
  const [gwDirty, setGwDirty] = useState(false)
  const [gwSaving, setGwSaving] = useState(false)
  const [gwTesting, setGwTesting] = useState(false)
  const [gwTestResult, setGwTestResult] = useState<'success' | 'error' | null>(null)

  const [ghToken, setGhToken] = useState('')
  const [showGhToken, setShowGhToken] = useState(false)
  const [hasExistingGhToken, setHasExistingGhToken] = useState(false)
  const [ghDirty, setGhDirty] = useState(false)
  const [ghTesting, setGhTesting] = useState(false)
  const [ghTestResult, setGhTestResult] = useState<'success' | 'error' | null>(null)

  const [trUrl, setTrUrl] = useState('')
  const [trKey, setTrKey] = useState('')
  const [showTrKey, setShowTrKey] = useState(false)
  const [hasExistingTrKey, setHasExistingTrKey] = useState(false)
  const [trDirty, setTrDirty] = useState(false)
  const [trTesting, setTrTesting] = useState(false)
  const [trTestResult, setTrTestResult] = useState<'success' | 'error' | null>(null)

  // Load initial values
  useEffect(() => {
    window.api.getGatewayUrl().then(({ url, hasToken }) => {
      setGwUrl(url)
      setHasExistingGwToken(hasToken)
    })
    window.api.settings.get('github.token').then((v) => {
      setHasExistingGhToken(!!v)
    })
    window.api.settings.get('taskRunner.url').then((v) => {
      setTrUrl(v ?? 'http://127.0.0.1:18799')
    })
    window.api.settings.get('taskRunner.apiKey').then((v) => {
      setHasExistingTrKey(!!v)
    })
  }, [])

  // Gateway handlers
  const handleGwSave = useCallback(async () => {
    setGwSaving(true)
    try {
      await window.api.saveGatewayConfig(gwUrl, gwToken || undefined)
      setGwDirty(false)
      if (gwToken) setHasExistingGwToken(true)
      setGwToken('')
      toast.success('Gateway config saved')
      await reconnect()
    } catch {
      toast.error('Failed to save gateway config')
    } finally {
      setGwSaving(false)
    }
  }, [gwUrl, gwToken, reconnect])

  const handleGwTest = useCallback(async () => {
    setGwTesting(true)
    setGwTestResult(null)
    try {
      await window.api.testGatewayConnection(gwUrl, gwToken || undefined)
      setGwTestResult('success')
      toast.success('Gateway connection OK')
    } catch {
      setGwTestResult('error')
      toast.error('Gateway connection failed')
    } finally {
      setGwTesting(false)
    }
  }, [gwUrl, gwToken])

  // GitHub handlers
  const handleGhSave = useCallback(async () => {
    if (!ghToken) return
    await window.api.settings.set('github.token', ghToken)
    setHasExistingGhToken(true)
    setGhToken('')
    setGhDirty(false)
    toast.success('GitHub token saved')
  }, [ghToken])

  const handleGhTest = useCallback(async () => {
    setGhTesting(true)
    setGhTestResult(null)
    try {
      const result = await window.api.github.fetch('/user')
      setGhTestResult(result.ok ? 'success' : 'error')
      if (result.ok) {
        toast.success('GitHub token valid')
      } else {
        toast.error('GitHub token invalid')
      }
    } catch {
      setGhTestResult('error')
      toast.error('GitHub test failed')
    } finally {
      setGhTesting(false)
    }
  }, [])

  // Task Runner handlers
  const handleTrSave = useCallback(async () => {
    await window.api.settings.set('taskRunner.url', trUrl)
    if (trKey) {
      await window.api.settings.set('taskRunner.apiKey', trKey)
      setHasExistingTrKey(true)
      setTrKey('')
    }
    setTrDirty(false)
    toast.success('Task runner config saved')
  }, [trUrl, trKey])

  const handleTrTest = useCallback(async () => {
    setTrTesting(true)
    setTrTestResult(null)
    try {
      await window.api.sprint.healthCheck()
      setTrTestResult('success')
      toast.success('Task runner reachable')
    } catch {
      setTrTestResult('error')
      toast.error('Task runner unreachable')
    } finally {
      setTrTesting(false)
    }
  }, [])

  return (
    <section className="settings-section">
      <h2 className="settings-section__title bde-section-title">Connections</h2>

      {/* Gateway */}
      <div className="settings-connection">
        <span className="settings-connection__label">Gateway</span>

        <label className="settings-field">
          <span className="settings-field__label">URL</span>
          <input
            className="settings-field__input"
            type="text"
            value={gwUrl}
            onChange={(e) => { setGwUrl(e.target.value); setGwDirty(true); setGwTestResult(null) }}
            placeholder="ws://127.0.0.1:18789"
          />
        </label>

        <label className="settings-field">
          <span className="settings-field__label">Token</span>
          <div className="settings-field__password">
            <input
              className="settings-field__input"
              type={showGwToken ? 'text' : 'password'}
              value={gwToken}
              onChange={(e) => { setGwToken(e.target.value); setGwDirty(true); setGwTestResult(null) }}
              placeholder={hasExistingGwToken ? 'Token saved — enter new value to change' : 'Paste gateway token'}
            />
            <Button
              variant="icon"
              size="sm"
              className="settings-field__toggle"
              onClick={() => setShowGwToken((v) => !v)}
              title={showGwToken ? 'Hide' : 'Show'}
              type="button"
            >
              {showGwToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </Button>
          </div>
        </label>

        <div className="settings-field__row">
          <div className="settings-field__status">
            <Badge
              variant={status === 'connected' ? 'success' : status === 'error' ? 'danger' : status === 'connecting' ? 'warning' : 'muted'}
              size="sm"
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Badge>
          </div>
          <div className="settings-field__actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleGwTest}
              disabled={gwTesting || !gwUrl || (!gwToken && !hasExistingGwToken)}
              loading={gwTesting}
              type="button"
            >
              Test
            </Button>
            {gwTestResult && (
              <Badge variant={gwTestResult === 'success' ? 'success' : 'danger'} size="sm">
                {gwTestResult === 'success' ? 'OK' : 'Failed'}
              </Badge>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={handleGwSave}
              disabled={!gwDirty || gwSaving || !gwUrl || (!gwToken && !hasExistingGwToken)}
              loading={gwSaving}
              type="button"
            >
              Save
            </Button>
          </div>
        </div>
      </div>

      {/* GitHub Token */}
      <div className="settings-connection">
        <span className="settings-connection__label">GitHub</span>
        <label className="settings-field">
          <span className="settings-field__label">Personal Access Token</span>
          <div className="settings-field__password">
            <input
              className="settings-field__input"
              type={showGhToken ? 'text' : 'password'}
              value={ghToken}
              onChange={(e) => { setGhToken(e.target.value); setGhDirty(true); setGhTestResult(null) }}
              placeholder={hasExistingGhToken ? 'Token saved — enter new value to change' : 'ghp_...'}
            />
            <Button
              variant="icon"
              size="sm"
              className="settings-field__toggle"
              onClick={() => setShowGhToken((v) => !v)}
              title={showGhToken ? 'Hide' : 'Show'}
              type="button"
            >
              {showGhToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </Button>
          </div>
        </label>
        <div className="settings-field__row">
          <div className="settings-field__actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleGhTest}
              disabled={ghTesting || (!ghToken && !hasExistingGhToken)}
              loading={ghTesting}
              type="button"
            >
              Test
            </Button>
            {ghTestResult && (
              <Badge variant={ghTestResult === 'success' ? 'success' : 'danger'} size="sm">
                {ghTestResult === 'success' ? 'OK' : 'Failed'}
              </Badge>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={handleGhSave}
              disabled={!ghDirty || !ghToken}
              type="button"
            >
              Save
            </Button>
          </div>
        </div>
      </div>

      {/* Task Runner */}
      <div className="settings-connection">
        <span className="settings-connection__label">Task Runner</span>
        <label className="settings-field">
          <span className="settings-field__label">URL</span>
          <input
            className="settings-field__input"
            type="text"
            value={trUrl}
            onChange={(e) => { setTrUrl(e.target.value); setTrDirty(true); setTrTestResult(null) }}
            placeholder="http://127.0.0.1:18799"
          />
        </label>
        <label className="settings-field">
          <span className="settings-field__label">API Key</span>
          <div className="settings-field__password">
            <input
              className="settings-field__input"
              type={showTrKey ? 'text' : 'password'}
              value={trKey}
              onChange={(e) => { setTrKey(e.target.value); setTrDirty(true); setTrTestResult(null) }}
              placeholder={hasExistingTrKey ? 'Key saved — enter new value to change' : 'Paste API key'}
            />
            <Button
              variant="icon"
              size="sm"
              className="settings-field__toggle"
              onClick={() => setShowTrKey((v) => !v)}
              title={showTrKey ? 'Hide' : 'Show'}
              type="button"
            >
              {showTrKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </Button>
          </div>
        </label>
        <div className="settings-field__row">
          <div className="settings-field__actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleTrTest}
              disabled={trTesting || !hasExistingTrKey}
              loading={trTesting}
              type="button"
            >
              Test
            </Button>
            {trTestResult && (
              <Badge variant={trTestResult === 'success' ? 'success' : 'danger'} size="sm">
                {trTestResult === 'success' ? 'OK' : 'Failed'}
              </Badge>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={handleTrSave}
              disabled={!trDirty}
              type="button"
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

// ---- Main Settings View ----

export default function SettingsView(): React.JSX.Element {
  const [accent, setAccent] = useAccentColor()
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  // Agent runtime config
  const [agentBinary, setAgentBinary] = useState('claude')
  const [agentPermissionMode, setAgentPermissionMode] = useState('bypassPermissions')
  const [agentDirty, setAgentDirty] = useState(false)
  const [agentSaving, setAgentSaving] = useState(false)

  useEffect(() => {
    window.api.getAgentConfig().then((config) => {
      setAgentBinary(config.binary)
      setAgentPermissionMode(config.permissionMode)
    })
  }, [])

  const handleAgentSave = useCallback(async () => {
    setAgentSaving(true)
    try {
      await window.api.saveAgentConfig({
        binary: agentBinary,
        permissionMode: agentPermissionMode
      })
      setAgentDirty(false)
      toast.success('Agent config saved')
    } catch {
      toast.error('Failed to save agent config')
    } finally {
      setAgentSaving(false)
    }
  }, [agentBinary, agentPermissionMode])

  return (
    <div className="settings-view" style={{ flexDirection: 'column' }}>
      <div className="settings-view__header">
        <span className="settings-view__header-title">Settings</span>
      </div>
      <div className="settings-view__scroll">

        <ConnectionsSection />
        <RepositoriesSection />

        {/* Agent Runtime */}
        <section className="settings-section">
          <h2 className="settings-section__title bde-section-title">Agent Runtime</h2>

          <label className="settings-field">
            <span className="settings-field__label">Binary Name</span>
            <input
              className="settings-field__input"
              type="text"
              value={agentBinary}
              onChange={(e) => { setAgentBinary(e.target.value); setAgentDirty(true) }}
              placeholder="claude"
            />
          </label>

          <label className="settings-field">
            <span className="settings-field__label">Permission Mode</span>
            <select
              className="settings-field__input"
              value={agentPermissionMode}
              onChange={(e) => { setAgentPermissionMode(e.target.value); setAgentDirty(true) }}
            >
              {PERMISSION_MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>

          <div className="settings-field__row">
            <div className="settings-field__status" />
            <div className="settings-field__actions">
              <Button
                variant="primary"
                size="sm"
                onClick={handleAgentSave}
                disabled={!agentDirty || agentSaving || !agentBinary.trim()}
                loading={agentSaving}
                type="button"
              >
                {agentSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </section>

        {/* Appearance */}
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

        {/* About */}
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
      </div>
    </div>
  )
}
