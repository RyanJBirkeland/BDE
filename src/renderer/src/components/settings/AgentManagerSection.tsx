/**
 * AgentManagerSection — configure AgentManager: concurrency, model, worktree base,
 * max runtime, auto-start, and webhooks. Changes take effect after app restart.
 */
import { useCallback, useEffect, useState } from 'react'
import { Trash2, Plus, Send, Eye, EyeOff } from 'lucide-react'
import { toast } from '../../stores/toasts'
import { Button } from '../ui/Button'
import type { Webhook } from '../../../../shared/ipc-channels'
import { SettingsCard } from './SettingsCard'

const DEFAULT_MAX_CONCURRENT = 2
const DEFAULT_MODEL = 'claude-sonnet-4-5'
const DEFAULT_WORKTREE_BASE = '~/worktrees/bde'
const DEFAULT_MAX_RUNTIME_MINUTES = 60
const DEFAULT_AUTO_START = true

const EVENT_OPTIONS = [
  { value: 'task.created', label: 'Task Created' },
  { value: 'task.started', label: 'Task Started' },
  { value: 'task.completed', label: 'Task Completed' },
  { value: 'task.failed', label: 'Task Failed' },
  { value: 'task.review', label: 'Task Ready for Review' },
  { value: 'task.updated', label: 'Task Updated' },
  { value: 'task.deleted', label: 'Task Deleted' },
  { value: '*', label: 'All Events' }
]

export function AgentManagerSection(): React.JSX.Element {
  const [maxConcurrent, setMaxConcurrent] = useState(DEFAULT_MAX_CONCURRENT)
  const [defaultModel, setDefaultModel] = useState(DEFAULT_MODEL)
  const [worktreeBase, setWorktreeBase] = useState(DEFAULT_WORKTREE_BASE)
  const [maxRuntimeMinutes, setMaxRuntimeMinutes] = useState(DEFAULT_MAX_RUNTIME_MINUTES)
  const [autoStart, setAutoStart] = useState(DEFAULT_AUTO_START)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [webhooksLoaded, setWebhooksLoaded] = useState(false)
  const [visibleSecrets, setVisibleSecrets] = useState<Set<string>>(new Set())
  const [testing, setTesting] = useState<Set<string>>(new Set())

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

  const loadWebhooks = useCallback(async () => {
    const list = await window.api.webhooks.list()
    setWebhooks(list)
    setWebhooksLoaded(true)
  }, [])

  useEffect(() => {
    void loadWebhooks()
  }, [loadWebhooks])

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
      // Hot-reload safe fields in the running agent manager. worktreeBase and
      // autoStart still require restart; the helper tells us which changed.
      try {
        const result = await window.api.agentManager.reloadConfig()
        if (result.requiresRestart.length > 0) {
          toast.info(
            `Saved. Restart required for: ${result.requiresRestart.join(', ')}`
          )
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
  }, [maxConcurrent, defaultModel, worktreeBase, maxRuntimeMinutes, autoStart])

  function markDirty(): void {
    setDirty(true)
  }

  const handleAddWebhook = useCallback(async () => {
    try {
      const webhook = await window.api.webhooks.create({
        url: 'https://',
        events: []
      })
      setWebhooks((prev) => [webhook, ...prev])
      toast.success('Webhook created')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Failed to create webhook: ${msg}`)
    }
  }, [])

  const handleRemoveWebhook = useCallback(async (id: string) => {
    try {
      await window.api.webhooks.delete({ id })
      setWebhooks((prev) => prev.filter((w) => w.id !== id))
      toast.success('Webhook removed')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Failed to remove webhook: ${msg}`)
    }
  }, [])

  const handleUrlChange = useCallback(
    async (id: string, url: string) => {
      setWebhooks((prev) => prev.map((w) => (w.id === id ? { ...w, url } : w)))
      try {
        await window.api.webhooks.update({ id, url })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(`Failed to update URL: ${msg}`)
        void loadWebhooks()
      }
    },
    [loadWebhooks]
  )

  const handleEventToggle = useCallback(
    async (id: string, event: string, checked: boolean) => {
      const webhook = webhooks.find((w) => w.id === id)
      if (!webhook) return

      let newEvents: string[]
      if (event === '*') {
        // If "All Events" is toggled, clear all other events
        newEvents = checked ? ['*'] : []
      } else {
        // Remove "All Events" if specific event is selected
        newEvents = webhook.events.filter((e) => e !== '*')
        if (checked) {
          newEvents = [...newEvents, event]
        } else {
          newEvents = newEvents.filter((e) => e !== event)
        }
      }

      setWebhooks((prev) => prev.map((w) => (w.id === id ? { ...w, events: newEvents } : w)))

      try {
        await window.api.webhooks.update({ id, events: newEvents })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(`Failed to update events: ${msg}`)
        void loadWebhooks()
      }
    },
    [webhooks, loadWebhooks]
  )

  const handleSecretChange = useCallback(async (id: string, secret: string) => {
    setWebhooks((prev) => prev.map((w) => (w.id === id ? { ...w, secret } : w)))
  }, [])

  const handleSecretBlur = useCallback(
    async (id: string) => {
      const webhook = webhooks.find((w) => w.id === id)
      if (!webhook) return

      try {
        await window.api.webhooks.update({ id, secret: webhook.secret || null })
        toast.success('Secret saved')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(`Failed to save secret: ${msg}`)
        void loadWebhooks()
      }
    },
    [webhooks, loadWebhooks]
  )

  const handleToggleEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      setWebhooks((prev) => prev.map((w) => (w.id === id ? { ...w, enabled } : w)))
      try {
        await window.api.webhooks.update({ id, enabled })
        toast.success(enabled ? 'Webhook enabled' : 'Webhook disabled')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(`Failed to toggle webhook: ${msg}`)
        void loadWebhooks()
      }
    },
    [loadWebhooks]
  )

  const handleTestWebhook = useCallback(async (id: string) => {
    setTesting((prev) => new Set(prev).add(id))
    try {
      await window.api.webhooks.test({ id })
      toast.success('Test webhook delivered successfully')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Test failed: ${msg}`)
    } finally {
      setTesting((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [])

  const toggleSecretVisibility = useCallback((id: string) => {
    setVisibleSecrets((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

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
      </SettingsCard>

      {webhooksLoaded && webhooks.length === 0 && (
        <span className="settings-repos__empty">No webhooks configured</span>
      )}

      {webhooks.map((webhook) => (
        <SettingsCard
          key={webhook.id}
          title={webhook.url}
          status={
            webhook.enabled
              ? { label: 'Enabled', variant: 'success' }
              : { label: 'Disabled', variant: 'neutral' }
          }
          footer={
            <div className="settings-card-footer-actions">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleToggleEnabled(webhook.id, !webhook.enabled)}
                type="button"
                aria-label={webhook.enabled ? 'Disable webhook' : 'Enable webhook'}
              >
                {webhook.enabled ? 'Disable' : 'Enable'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleTestWebhook(webhook.id)}
                disabled={testing.has(webhook.id)}
                type="button"
                aria-label="Test webhook"
              >
                <Send size={14} />
                {testing.has(webhook.id) ? 'Sending...' : 'Test'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveWebhook(webhook.id)}
                type="button"
                aria-label="Remove webhook"
              >
                <Trash2 size={14} />
                Delete
              </Button>
            </div>
          }
        >
          <div className="settings-webhook-row">
            <label className="settings-field">
              <span className="settings-field__label">URL</span>
              <input
                className="settings-field__input"
                placeholder="https://example.com/webhook"
                value={webhook.url}
                onChange={(e) => handleUrlChange(webhook.id, e.target.value)}
              />
            </label>

            <label className="settings-field">
              <span className="settings-field__label">Secret (optional)</span>
              <div className="settings-secret-input">
                <input
                  className="settings-field__input"
                  type={visibleSecrets.has(webhook.id) ? 'text' : 'password'}
                  placeholder="Optional HMAC signing secret"
                  value={webhook.secret || ''}
                  onChange={(e) => handleSecretChange(webhook.id, e.target.value)}
                  onBlur={() => handleSecretBlur(webhook.id)}
                />
                {webhook.secret && (
                  <button
                    type="button"
                    className="settings-secret-input__toggle"
                    onClick={() => toggleSecretVisibility(webhook.id)}
                    aria-label={visibleSecrets.has(webhook.id) ? 'Hide secret' : 'Show secret'}
                  >
                    {visibleSecrets.has(webhook.id) ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                )}
              </div>
            </label>

            <fieldset className="settings-field settings-fieldset-bare">
              <legend className="settings-field__label">Events</legend>
              <div className="settings-event-grid">
                {EVENT_OPTIONS.map((option) => (
                  <label key={option.value} className="settings-event-option">
                    <input
                      type="checkbox"
                      checked={webhook.events.includes(option.value)}
                      onChange={(e) =>
                        handleEventToggle(webhook.id, option.value, e.target.checked)
                      }
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </SettingsCard>
      ))}

      <Button
        variant="ghost"
        size="sm"
        onClick={handleAddWebhook}
        type="button"
        className="settings-repos__add-btn"
      >
        <Plus size={14} /> Add Webhook
      </Button>
    </div>
  )
}
