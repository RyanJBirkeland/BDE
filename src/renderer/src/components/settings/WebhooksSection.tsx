/**
 * WebhooksSection — manage webhook endpoints for external task event notifications.
 */
import { useCallback, useEffect, useState } from 'react'
import { Trash2, Plus, Send, Eye, EyeOff } from 'lucide-react'
import { toast } from '../../stores/toasts'
import { Button } from '../ui/Button'
import type { Webhook } from '../../../../shared/ipc-channels'
import { SettingsCard } from './SettingsCard'

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

export function WebhooksSection(): React.JSX.Element {
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [loaded, setLoaded] = useState(false)
  const [visibleSecrets, setVisibleSecrets] = useState<Set<string>>(new Set())
  const [testing, setTesting] = useState<Set<string>>(new Set())

  const loadWebhooks = useCallback(async () => {
    const list = await window.api.webhooks.list()
    setWebhooks(list)
    setLoaded(true)
  }, [])

  useEffect(() => {
    void loadWebhooks()
  }, [loadWebhooks])

  const handleAdd = useCallback(async () => {
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

  const handleRemove = useCallback(async (id: string) => {
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

  const handleTest = useCallback(async (id: string) => {
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

  if (!loaded) return <div className="settings-cards-list" />

  return (
    <div className="settings-cards-list">
      {webhooks.length === 0 && (
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
                onClick={() => handleTest(webhook.id)}
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
                onClick={() => handleRemove(webhook.id)}
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
        onClick={handleAdd}
        type="button"
        className="settings-repos__add-btn"
      >
        <Plus size={14} /> Add Webhook
      </Button>
    </div>
  )
}
