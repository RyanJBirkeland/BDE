/**
 * AgentManagerSection — configure AgentManager: concurrency, model, worktree base,
 * max runtime, and auto-start. Changes take effect after app restart.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from '../../stores/toasts'
import { Button } from '../ui/Button'

const DEFAULT_MAX_CONCURRENT = 2
const DEFAULT_MODEL = 'claude-sonnet-4-5'
const DEFAULT_WORKTREE_BASE = '~/worktrees/bde'
const DEFAULT_MAX_RUNTIME_MINUTES = 60
const DEFAULT_AUTO_START = true

export function AgentManagerSection(): React.JSX.Element {
  const [maxConcurrent, setMaxConcurrent] = useState(DEFAULT_MAX_CONCURRENT)
  const [defaultModel, setDefaultModel] = useState(DEFAULT_MODEL)
  const [worktreeBase, setWorktreeBase] = useState(DEFAULT_WORKTREE_BASE)
  const [maxRuntimeMinutes, setMaxRuntimeMinutes] = useState(DEFAULT_MAX_RUNTIME_MINUTES)
  const [autoStart, setAutoStart] = useState(DEFAULT_AUTO_START)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function loadSettings(): Promise<void> {
      const [maxC, model, wtBase, maxRtMs, autoS] = await Promise.all([
        window.api.settings.getJson('agentManager.maxConcurrent'),
        window.api.settings.get('agentManager.defaultModel'),
        window.api.settings.get('agentManager.worktreeBase'),
        window.api.settings.getJson('agentManager.maxRuntimeMs'),
        window.api.settings.getJson('agentManager.autoStart')
      ])
      if (typeof maxC === 'number') setMaxConcurrent(maxC)
      if (typeof model === 'string' && model) setDefaultModel(model)
      if (typeof wtBase === 'string' && wtBase) setWorktreeBase(wtBase)
      if (typeof maxRtMs === 'number') setMaxRuntimeMinutes(maxRtMs / 60_000)
      if (typeof autoS === 'boolean') setAutoStart(autoS)
    }
    void loadSettings()
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await Promise.all([
        window.api.settings.setJson('agentManager.maxConcurrent', maxConcurrent),
        window.api.settings.set('agentManager.defaultModel', defaultModel),
        window.api.settings.set('agentManager.worktreeBase', worktreeBase),
        window.api.settings.setJson('agentManager.maxRuntimeMs', maxRuntimeMinutes * 60_000),
        window.api.settings.setJson('agentManager.autoStart', autoStart)
      ])
      setDirty(false)
      toast.success('Agent Manager settings saved')
    } catch {
      toast.error('Failed to save Agent Manager settings')
    } finally {
      setSaving(false)
    }
  }, [maxConcurrent, defaultModel, worktreeBase, maxRuntimeMinutes, autoStart])

  function markDirty(): void {
    setDirty(true)
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section__title bde-section-title">Agent Manager</h2>

      <label className="settings-field">
        <span className="settings-field__label">Max concurrent agents</span>
        <input
          className="settings-field__input"
          type="number"
          min={1}
          max={16}
          value={maxConcurrent}
          onChange={(e) => {
            setMaxConcurrent(Number(e.target.value))
            markDirty()
          }}
        />
      </label>

      <label className="settings-field">
        <span className="settings-field__label">Default model</span>
        <input
          className="settings-field__input"
          type="text"
          value={defaultModel}
          onChange={(e) => {
            setDefaultModel(e.target.value)
            markDirty()
          }}
          placeholder="claude-sonnet-4-5"
        />
      </label>

      <label className="settings-field">
        <span className="settings-field__label">Worktree base</span>
        <input
          className="settings-field__input"
          type="text"
          value={worktreeBase}
          onChange={(e) => {
            setWorktreeBase(e.target.value)
            markDirty()
          }}
          placeholder="~/worktrees/bde"
        />
      </label>

      <label className="settings-field">
        <span className="settings-field__label">Max runtime (minutes)</span>
        <input
          className="settings-field__input"
          type="number"
          min={1}
          value={maxRuntimeMinutes}
          onChange={(e) => {
            setMaxRuntimeMinutes(Number(e.target.value))
            markDirty()
          }}
        />
      </label>

      <label className="settings-field">
        <span className="settings-field__label">Auto-start</span>
        <input
          type="checkbox"
          checked={autoStart}
          onChange={(e) => {
            setAutoStart(e.target.checked)
            markDirty()
          }}
        />
      </label>

      <p className="settings-field__hint">Changes require app restart to take effect.</p>

      <div className="settings-field__row">
        <div className="settings-field__status" />
        <div className="settings-field__actions">
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={!dirty || saving}
            loading={saving}
            type="button"
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </section>
  )
}
