/**
 * AgentRuntimeSection — agent binary path and permission mode configuration.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from '../../stores/toasts'
import { Button } from '../ui/Button'

const PERMISSION_MODES = [
  { value: 'bypassPermissions', label: 'Bypass (no prompts)' },
  { value: 'default', label: 'Default (prompt for risky ops)' },
  { value: 'plan', label: 'Plan (read-only, no writes)' }
]

export function AgentRuntimeSection(): React.JSX.Element {
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
  )
}
