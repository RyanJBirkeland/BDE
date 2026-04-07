/**
 * NotificationsSection — notification preferences for desktop and in-app alerts.
 * Master toggle + per-event-type delivery (desktop+in-app / in-app only / off).
 */
import { useCallback, useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { SettingsCard } from './SettingsCard'
import { toast } from '../../stores/toasts'
import type { NotificationType } from '../../stores/notifications'

type DeliveryMode = 'desktop' | 'in-app' | 'off'

interface NotificationPreferences {
  master: boolean
  agent_completed: DeliveryMode
  agent_failed: DeliveryMode
  pr_merged: DeliveryMode
  pr_closed: DeliveryMode
  merge_conflict: DeliveryMode
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  master: true,
  agent_completed: 'desktop',
  agent_failed: 'desktop',
  pr_merged: 'desktop',
  pr_closed: 'in-app',
  merge_conflict: 'desktop'
}

const EVENT_LABELS: Record<Exclude<keyof NotificationPreferences, 'master'>, string> = {
  agent_completed: 'Task Completed',
  agent_failed: 'Task Failed',
  pr_merged: 'PR Merged',
  pr_closed: 'PR Closed',
  merge_conflict: 'Merge Conflict'
}

export function NotificationsSection(): React.JSX.Element {
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_PREFERENCES)
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission>(() =>
    'Notification' in window ? Notification.permission : 'default'
  )

  // Load preferences on mount
  useEffect(() => {
    const loadPreferences = async (): Promise<void> => {
      const loaded: Partial<NotificationPreferences> = {}

      try {
        const master = await window.api.settings.get('notifications.master')
        loaded.master = master === 'false' ? false : true

        // Load per-event preferences
        const events: Array<Exclude<keyof NotificationPreferences, 'master'>> = [
          'agent_completed',
          'agent_failed',
          'pr_merged',
          'pr_closed',
          'merge_conflict'
        ]

        for (const event of events) {
          const value = await window.api.settings.get(`notifications.${event}`)
          if (value === 'desktop' || value === 'in-app' || value === 'off') {
            loaded[event] = value
          }
        }
      } catch {
        // Use defaults
      }

      setPrefs({ ...DEFAULT_PREFERENCES, ...loaded })
    }

    loadPreferences()
  }, [])

  const updateMaster = useCallback(async (enabled: boolean): Promise<void> => {
    try {
      await window.api.settings.set('notifications.master', String(enabled))
      setPrefs((prev) => ({ ...prev, master: enabled }))
      toast.success(enabled ? 'Notifications enabled' : 'Notifications disabled')
    } catch {
      toast.error('Failed to update master toggle')
    }
  }, [])

  const updateEventPreference = useCallback(
    async (event: NotificationType, mode: DeliveryMode): Promise<void> => {
      try {
        await window.api.settings.set(`notifications.${event}`, mode)
        setPrefs((prev) => ({ ...prev, [event]: mode }))
      } catch {
        toast.error(`Failed to update ${event} preference`)
      }
    },
    []
  )

  const requestPermission = useCallback(async (): Promise<void> => {
    if (!('Notification' in window)) {
      toast.error('Desktop notifications not supported in this environment')
      return
    }

    if (Notification.permission === 'granted') {
      toast.info('Permission already granted')
      return
    }

    if (Notification.permission === 'denied') {
      toast.error('Permission denied — enable notifications in system settings')
      return
    }

    try {
      const result = await Notification.requestPermission()
      setPermissionStatus(result)
      if (result === 'granted') {
        toast.success('Desktop notification permission granted')
      } else {
        toast.error('Desktop notification permission denied')
      }
    } catch {
      toast.error('Failed to request notification permission')
    }
  }, [])

  const eventTypes: Array<Exclude<keyof NotificationPreferences, 'master'>> = [
    'agent_completed',
    'agent_failed',
    'pr_merged',
    'pr_closed',
    'merge_conflict'
  ]

  return (
    <>
      <SettingsCard
        icon={<Bell size={20} />}
        title="Master Toggle"
        subtitle="Enable or disable all notifications"
      >
        <div className="settings-theme-buttons">
          <button
            className={`bde-btn bde-btn--sm ${prefs.master ? 'bde-btn--primary' : 'bde-btn--ghost'}`}
            onClick={() => updateMaster(true)}
            type="button"
            aria-pressed={prefs.master}
          >
            Enabled
          </button>
          <button
            className={`bde-btn bde-btn--sm ${!prefs.master ? 'bde-btn--primary' : 'bde-btn--ghost'}`}
            onClick={() => updateMaster(false)}
            type="button"
            aria-pressed={!prefs.master}
          >
            Disabled
          </button>
        </div>
      </SettingsCard>

      <SettingsCard title="Desktop Notifications" subtitle="Request system notification permission">
        <div className="settings-stack">
          <div className="settings-status-line">
            Status:{' '}
            <span
              className={`settings-status-line__value${
                permissionStatus === 'granted'
                  ? ' settings-status-line__value--granted'
                  : permissionStatus === 'denied'
                    ? ' settings-status-line__value--denied'
                    : ''
              }`}
            >
              {permissionStatus}
            </span>
          </div>
          <button
            className="bde-btn bde-btn--sm bde-btn--primary"
            onClick={requestPermission}
            type="button"
            disabled={permissionStatus === 'granted'}
          >
            {permissionStatus === 'granted' ? 'Permission Granted' : 'Request Permission'}
          </button>
        </div>
      </SettingsCard>

      <SettingsCard title="Event Preferences" subtitle="Configure delivery mode per event type">
        <div className="settings-stack settings-stack--lg">
          {eventTypes.map((event) => (
            <div key={event} className="settings-stack settings-stack--sm">
              <span className="settings-event-label">{EVENT_LABELS[event]}</span>
              <div className="settings-theme-buttons">
                <button
                  className={`bde-btn bde-btn--sm ${prefs[event] === 'desktop' ? 'bde-btn--primary' : 'bde-btn--ghost'}`}
                  onClick={() => updateEventPreference(event, 'desktop')}
                  type="button"
                  aria-pressed={prefs[event] === 'desktop'}
                  disabled={!prefs.master}
                >
                  Desktop + In-App
                </button>
                <button
                  className={`bde-btn bde-btn--sm ${prefs[event] === 'in-app' ? 'bde-btn--primary' : 'bde-btn--ghost'}`}
                  onClick={() => updateEventPreference(event, 'in-app')}
                  type="button"
                  aria-pressed={prefs[event] === 'in-app'}
                  disabled={!prefs.master}
                >
                  In-App Only
                </button>
                <button
                  className={`bde-btn bde-btn--sm ${prefs[event] === 'off' ? 'bde-btn--primary' : 'bde-btn--ghost'}`}
                  onClick={() => updateEventPreference(event, 'off')}
                  type="button"
                  aria-pressed={prefs[event] === 'off'}
                  disabled={!prefs.master}
                >
                  Off
                </button>
              </div>
            </div>
          ))}
        </div>
      </SettingsCard>
    </>
  )
}
