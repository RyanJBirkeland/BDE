/**
 * AgentManagerSection — configure AgentManager: concurrency, worktree base,
 * max runtime, and auto-start. Also embeds agent permission settings.
 * Changes to pipeline configuration take effect after app restart.
 *
 * Model selection lives in Settings → Models (per agent type) — not here.
 */
import './AgentManagerSection.css'
import { useCallback, useEffect, useState } from 'react'
import { toast } from '../../stores/toasts'
import { Button } from '../ui/Button'
import { SettingsCard } from './SettingsCard'
import { AgentPermissionsSection } from './AgentPermissionsSection'

const DEFAULT_MAX_CONCURRENT = 2
const DEFAULT_WORKTREE_BASE = '~/worktrees/bde'
const DEFAULT_MAX_RUNTIME_MINUTES = 60
const DEFAULT_AUTO_START = true

export function AgentManagerSection(): React.JSX.Element {
  const [maxConcurrent, setMaxConcurrent] = useState(DEFAULT_MAX_CONCURRENT)
  const [worktreeBase, setWorktreeBase] = useState(DEFAULT_WORKTREE_BASE)
  const [maxRuntimeMinutes, setMaxRuntimeMinutes] = useState(DEFAULT_MAX_RUNTIME_MINUTES)
  const [autoStart, setAutoStart] = useState(DEFAULT_AUTO_START)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function loadSettings(): Promise<void> {
      const [maxC, wtBase, maxRtMs, autoS] = await Promise.all([
        window.api.settings.getJson('agentManager.maxConcurrent'),
        window.api.settings.get('agentManager.worktreeBase'),
        window.api.settings.getJson('agentManager.maxRuntimeMs'),
        window.api.settings.getJson('agentManager.autoStart')
      ])
      if (typeof maxC === 'number') setMaxConcurrent(maxC)
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
        window.api.settings.set('agentManager.worktreeBase', worktreeBase),
        window.api.settings.setJson('agentManager.maxRuntimeMs', maxRuntimeMinutes * 60_000),
        window.api.settings.setJson('agentManager.autoStart', autoStart)
      ])
      setDirty(false)
      // Hot-reload safe fields in the running agent manager. worktreeBase and
      // autoStart still require restart; the helper tells us which changed.
      try {
        const result = await window.api.agentManager.reloadConfig()
        if (result.requiresRestart.length > 0) {
          toast.info(`Saved. Restart required for: ${result.requiresRestart.join(', ')}`)
        } else if (result.updated.length > 0) {
          toast.success(`Settings saved and applied: ${result.updated.join(', ')}`)
        } else {
          toast.success('Agent Manager settings saved')
        }
      } catch {
        toast.success('Agent Manager settings saved (restart to apply)')
      }
    } catch {
      toast.error('Failed to save Agent Manager settings')
    } finally {
      setSaving(false)
    }
  }, [maxConcurrent, worktreeBase, maxRuntimeMinutes, autoStart])

  function markDirty(): void {
    setDirty(true)
  }

  return (
    <div className="settings-cards-list">
      <SettingsCard
        title="Pipeline Configuration"
        subtitle="Most fields hot-reload instantly. Worktree base and Auto-start require a restart."
        footer={
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
        }
      >
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
          <span
            className="settings-field__hint"
            style={{
              fontSize: '11px',
              opacity: 0.7,
              marginTop: '4px',
              display: 'block',
              lineHeight: 1.4
            }}
          >
            Each agent runs its own `npm run test:coverage` during verification. Values above{' '}
            <strong>3</strong> on a typical laptop can oversaturate CPU and cause otherwise-passing
            tests to time out under load (load avg 140+ observed at 6 concurrent). Raise with
            caution.
          </span>
          {maxConcurrent > 3 && (
            <span
              role="alert"
              style={{
                display: 'block',
                marginTop: '6px',
                padding: '6px 10px',
                fontSize: '11px',
                color: 'var(--bde-warning)',
                border: '1px solid rgba(255, 159, 64, 0.4)',
                borderRadius: '4px',
                background: 'rgba(255, 159, 64, 0.08)'
              }}
            >
              ⚠ {maxConcurrent} concurrent agents may oversaturate this machine. Agents can misjudge
              load-induced test timeouts as &ldquo;pre-existing failures&rdquo; and push broken
              work. Recommended: 3 or lower.
            </span>
          )}
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
            max={120}
            value={maxRuntimeMinutes}
            aria-invalid={maxRuntimeMinutes > 120}
            onChange={(e) => {
              setMaxRuntimeMinutes(Number(e.target.value))
              markDirty()
            }}
          />
          {maxRuntimeMinutes > 60 && (
            <span className="settings-field__hint" role="note">
              Long watchdog values may oversaturate system resources
            </span>
          )}
        </label>

        <label className="settings-field settings-field--inline">
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
      </SettingsCard>

      <AgentPermissionsSection />
    </div>
  )
}
