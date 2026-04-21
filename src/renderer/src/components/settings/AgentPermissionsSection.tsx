/**
 * AgentPermissionsSection — manage allow/deny tool permissions for BDE agents.
 * Reads/writes ~/.claude/settings.json via IPC. Includes a consent banner,
 * preset configurations, tool checkboxes, and a custom deny-rule editor.
 */
import './AgentPermissionsSection.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '../../stores/toasts'
import { Button } from '../ui/Button'
import { SettingsCard } from './SettingsCard'

const CONSENT_KEY = 'bde-permissions-consent'

const ALL_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'Bash',
  'Agent',
  'WebFetch',
  'WebSearch',
  'NotebookEdit'
] as const

const TOOL_DESCRIPTIONS: Record<string, string> = {
  Read: 'Read file contents',
  Write: 'Create new files',
  Edit: 'Modify existing files',
  Glob: 'Search for files by pattern',
  Grep: 'Search file contents',
  Bash: 'Run shell commands (npm, git, etc.)',
  Agent: 'Spawn sub-agents for parallel work',
  WebFetch: 'Fetch web URLs',
  WebSearch: 'Search the web',
  NotebookEdit: 'Edit Jupyter notebooks'
}

interface Preset {
  allow: string[]
  deny: string[]
}

const PRESETS: Record<string, Preset> = {
  recommended: {
    allow: [
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'Bash',
      'Agent',
      'WebFetch',
      'WebSearch',
      'NotebookEdit'
    ],
    deny: [
      'Bash(rm -rf /*)',
      'Bash(rm -rf ~*)',
      'Bash(sudo rm *)',
      'Bash(sudo dd *)',
      'Bash(mkfs*)',
      'Bash(chmod -R 777 /*)'
    ]
  },
  restrictive: {
    allow: ['Read', 'Glob', 'Grep'],
    deny: ['Bash(rm -rf /*)', 'Bash(rm -rf ~*)', 'Bash(sudo rm *)', 'Bash(sudo dd *)']
  },
  permissive: {
    allow: [
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'Bash',
      'Agent',
      'WebFetch',
      'WebSearch',
      'NotebookEdit'
    ],
    deny: []
  }
}

export function AgentPermissionsSection(): React.JSX.Element {
  const [allow, setAllow] = useState<string[]>([])
  const [deny, setDeny] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [consented, setConsented] = useState(() => localStorage.getItem(CONSENT_KEY) === 'true')
  const [newDenyRule, setNewDenyRule] = useState('')
  const denyInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    async function loadConfig(): Promise<void> {
      setLoading(true)
      try {
        const config = await window.api.claudeConfig.get()
        if (config && Array.isArray(config.permissions?.allow)) {
          setAllow(config.permissions.allow as string[])
        }
        if (config && Array.isArray(config.permissions?.deny)) {
          setDeny(config.permissions.deny as string[])
        }
      } catch {
        // Leave defaults empty if config can't be read
      } finally {
        setLoading(false)
      }
    }
    void loadConfig()
  }, [])

  const applyPreset = useCallback((presetName: keyof typeof PRESETS): void => {
    const preset = PRESETS[presetName]
    if (!preset) return
    setAllow([...preset.allow])
    setDeny([...preset.deny])
    setDirty(true)
  }, [])

  const handleAcceptRecommended = useCallback((): void => {
    applyPreset('recommended')
    localStorage.setItem(CONSENT_KEY, 'true')
    setConsented(true)
  }, [applyPreset])

  const handleConfigureManually = useCallback((): void => {
    localStorage.setItem(CONSENT_KEY, 'true')
    setConsented(true)
  }, [])

  const handleToolToggle = useCallback((tool: string, checked: boolean): void => {
    setAllow((prev) => {
      if (checked) {
        return prev.includes(tool) ? prev : [...prev, tool]
      } else {
        return prev.filter((t) => t !== tool)
      }
    })
    setDirty(true)
  }, [])

  const handleRemoveDeny = useCallback((rule: string): void => {
    setDeny((prev) => prev.filter((r) => r !== rule))
    setDirty(true)
  }, [])

  const handleAddDenyRule = useCallback((): void => {
    const rule = newDenyRule.trim()
    if (!rule) return
    setDeny((prev) => (prev.includes(rule) ? prev : [...prev, rule]))
    setNewDenyRule('')
    setDirty(true)
    denyInputRef.current?.focus()
  }, [newDenyRule])

  const handleDenyKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>): void => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleAddDenyRule()
      }
    },
    [handleAddDenyRule]
  )

  const handleSave = useCallback(async (): Promise<void> => {
    setSaving(true)
    try {
      await window.api.claudeConfig.setPermissions({ allow, deny })
      setDirty(false)
      toast.success('Agent permissions saved')
    } catch {
      toast.error('Failed to save agent permissions')
    } finally {
      setSaving(false)
    }
  }, [allow, deny])

  const saveFooter = (
    <div className="settings-field__row">
      <div className="settings-field__status">
        {dirty && (
          <span style={{ color: 'var(--bde-text-muted)', fontSize: 'var(--bde-size-sm)' }}>
            Unsaved changes
          </span>
        )}
      </div>
      <div className="settings-field__actions">
        <Button
          variant="primary"
          size="sm"
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          loading={saving}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  )

  return (
    <div>
      {!consented && (
        <div className="permissions-banner">
          <p className="permissions-banner__text">
            BDE agents need permission to use tools on your machine. Choose a preset to get started,
            or configure permissions manually.
          </p>
          <div className="permissions-banner__actions">
            <Button variant="primary" size="sm" type="button" onClick={handleAcceptRecommended}>
              Accept Recommended
            </Button>
            <Button variant="ghost" size="sm" type="button" onClick={handleConfigureManually}>
              I&apos;ll Configure Manually
            </Button>
          </div>
        </div>
      )}

      <SettingsCard title="Presets" subtitle="Quick-apply permission configurations">
        <div className="permissions-presets">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => applyPreset('recommended')}
          >
            Recommended
          </Button>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => applyPreset('restrictive')}
          >
            Restrictive
          </Button>
          <Button variant="ghost" size="sm" type="button" onClick={() => applyPreset('permissive')}>
            Permissive
          </Button>
        </div>
      </SettingsCard>

      <SettingsCard title="Tool Rules" footer={saveFooter}>
        <div className="permissions-tools" aria-label="Allowed tools">
          {loading ? (
            <span style={{ color: 'var(--bde-text-muted)', fontSize: 'var(--bde-size-sm)' }}>
              Loading...
            </span>
          ) : (
            ALL_TOOLS.map((tool) => (
              <label key={tool} className="permissions-tool">
                <input
                  type="checkbox"
                  checked={allow.includes(tool)}
                  onChange={(e) => handleToolToggle(tool, e.target.checked)}
                  aria-label={tool}
                />
                <span className="permissions-tool__name">{tool}</span>
                <span className="permissions-tool__desc">{TOOL_DESCRIPTIONS[tool]}</span>
              </label>
            ))
          )}
        </div>

        <p className="permissions-info">
          Pipeline agents automatically receive allow rules for their required tools. These settings
          apply as the default baseline.
        </p>
      </SettingsCard>

      <SettingsCard title="Deny Rules" subtitle="Custom tool deny patterns">
        <div className="permissions-deny-list" aria-label="Blocked commands">
          {deny.map((rule) => (
            <div key={rule} className="permissions-deny-rule">
              <code>{rule}</code>
              <button
                type="button"
                className="bde-btn bde-btn--ghost bde-btn--sm"
                onClick={() => handleRemoveDeny(rule)}
                aria-label={`Remove ${rule}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="permissions-deny-add">
          <input
            ref={denyInputRef}
            className="settings-field__input"
            type="text"
            value={newDenyRule}
            onChange={(e) => setNewDenyRule(e.target.value)}
            onKeyDown={handleDenyKeyDown}
            placeholder="e.g. Bash(curl *) — press Enter to add"
            aria-label="Add blocked command"
          />
        </div>
      </SettingsCard>
    </div>
  )
}
