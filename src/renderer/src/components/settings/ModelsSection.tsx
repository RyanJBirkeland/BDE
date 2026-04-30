/**
 * ModelsSection — per-agent-type backend + model routing.
 *
 * Loads the composite `agents.backendConfig` setting on mount, renders:
 *   1. a shared Opencode backend card (executable path),
 *   2. an Active routing card with one row per agent type. The model
 *      picker is always interactive; the Opencode backend radio is disabled
 *      on agent types whose spawn path does not yet support it.
 *
 * Saves the entire BackendSettings object in one atomic setJson call.
 */
import './ModelsSection.css'
import React, { useCallback, useEffect, useState } from 'react'
import { SettingsCard } from './SettingsCard'
import { Button } from '../ui/Button'
import { toast } from '../../stores/toasts'
import type {
  BackendKind,
  AgentBackendConfig,
  BackendSettings
} from '../../../../shared/types/backend-settings'
import { CLAUDE_MODELS, DEFAULT_MODEL } from '../../../../shared/models'

const DEFAULT_CLAUDE_MODEL = DEFAULT_MODEL.modelId

type AgentTypeId = 'pipeline' | 'synthesizer' | 'copilot' | 'assistant' | 'adhoc' | 'reviewer'

interface AgentTypeMeta {
  id: AgentTypeId
  label: string
  description: string
  supportsOpencode: boolean
}

const AGENT_TYPES: AgentTypeMeta[] = [
  {
    id: 'pipeline',
    label: 'Pipeline',
    description: 'Executes sprint tasks end-to-end.',
    supportsOpencode: true
  },
  {
    id: 'synthesizer',
    label: 'Synthesizer',
    description: 'Drafts spec documents from task titles.',
    supportsOpencode: false
  },
  {
    id: 'copilot',
    label: 'Copilot',
    description: 'Interactive pair-programming agent.',
    supportsOpencode: false
  },
  {
    id: 'assistant',
    label: 'Assistant',
    description: 'One-shot Q&A over the repo.',
    supportsOpencode: true
  },
  {
    id: 'adhoc',
    label: 'Adhoc',
    description: 'Freeform agent runs outside the sprint pipeline.',
    supportsOpencode: true
  },
  {
    id: 'reviewer',
    label: 'Reviewer',
    description: 'Reviews PRs before merge.',
    supportsOpencode: false
  }
]

const DEFAULT_ROW: AgentBackendConfig = { backend: 'claude', model: DEFAULT_CLAUDE_MODEL }

function defaultBackendSettings(): BackendSettings {
  return {
    pipeline: { ...DEFAULT_ROW },
    synthesizer: { ...DEFAULT_ROW },
    copilot: { ...DEFAULT_ROW },
    assistant: { ...DEFAULT_ROW },
    adhoc: { ...DEFAULT_ROW },
    reviewer: { ...DEFAULT_ROW },
    opencodeExecutable: 'opencode'
  }
}

export function ModelsSection(): React.JSX.Element {
  const [settings, setSettings] = useState<BackendSettings>(defaultBackendSettings)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function load(): Promise<void> {
      const stored = (await window.api.settings.getJson(
        'agents.backendConfig'
      )) as Partial<BackendSettings> | null
      if (!stored) return
      setSettings((prev) => ({ ...prev, ...stored }))
    }
    void load()
  }, [])

  function updateSettings(next: BackendSettings): void {
    setSettings(next)
    setDirty(true)
  }

  function updateRow(id: AgentTypeId, next: AgentBackendConfig): void {
    updateSettings({ ...settings, [id]: next })
  }

  const handleSave = useCallback(async (): Promise<void> => {
    setSaving(true)
    try {
      await window.api.settings.setJson('agents.backendConfig', settings)
      setDirty(false)
      toast.success('Model routing saved')
    } catch {
      toast.error('Failed to save model routing')
    } finally {
      setSaving(false)
    }
  }, [settings])

  return (
    <div className="settings-cards-list">
      <SettingsCard
        title="Opencode backend"
        subtitle="Path to the opencode binary. Defaults to 'opencode' (PATH lookup)."
      >
        <label className="settings-field">
          <span className="settings-field__label">Executable path</span>
          <input
            className="settings-field__input"
            type="text"
            value={settings.opencodeExecutable ?? 'opencode'}
            onChange={(e) => updateSettings({ ...settings, opencodeExecutable: e.target.value })}
            placeholder="opencode"
          />
        </label>
      </SettingsCard>

      <SettingsCard
        title="Active routing"
        subtitle="Route each agent type to Claude or opencode. Opencode is not available for Synthesizer, Copilot, and Reviewer."
      >
        {AGENT_TYPES.map((type) => (
          <AgentTypeRow
            key={type.id}
            type={type}
            value={settings[type.id]}
            onChange={(next) => updateRow(type.id, next)}
            canUseOpencode={type.supportsOpencode}
          />
        ))}
      </SettingsCard>

      <div className="models-save-row">
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={!dirty || saving}
          loading={saving}
          type="button"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  )
}

interface AgentTypeRowProps {
  type: AgentTypeMeta
  value: AgentBackendConfig
  onChange: (next: AgentBackendConfig) => void
  canUseOpencode: boolean
}

function AgentTypeRow({
  type,
  value,
  onChange,
  canUseOpencode
}: AgentTypeRowProps): React.JSX.Element {
  function toggleBackend(next: BackendKind): void {
    if (next === value.backend) return
    const defaultModel = next === 'claude' ? DEFAULT_CLAUDE_MODEL : ''
    onChange({ backend: next, model: defaultModel })
  }

  return (
    <div className="models-row" data-testid={`models-row-${type.id}`}>
      <div className="models-row__label">{type.label}</div>
      <div className="models-row__desc">{type.description}</div>
      <div className="models-row__controls">
        <BackendToggle
          value={value.backend}
          onChange={toggleBackend}
          canUseOpencode={canUseOpencode}
          rowId={type.id}
        />
        <ModelPicker
          backend={value.backend}
          model={value.model}
          onChange={(model) => onChange({ ...value, model })}
        />
      </div>
    </div>
  )
}

interface BackendToggleProps {
  value: BackendKind
  onChange: (next: BackendKind) => void
  canUseOpencode: boolean
  rowId: string
}

const OPENCODE_UNSUPPORTED_TOOLTIP =
  'Opencode support for this agent type is coming in a future update'

function BackendToggle({
  value,
  onChange,
  canUseOpencode,
  rowId
}: BackendToggleProps): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={`${rowId} backend`} className="models-seg">
      <button
        type="button"
        role="radio"
        aria-checked={value === 'claude'}
        data-value="claude"
        onClick={() => onChange('claude')}
        className="models-seg__btn"
      >
        Claude
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === 'opencode'}
        data-value="opencode"
        disabled={!canUseOpencode}
        title={canUseOpencode ? undefined : OPENCODE_UNSUPPORTED_TOOLTIP}
        onClick={() => onChange('opencode')}
        className="models-seg__btn"
      >
        Opencode
      </button>
    </div>
  )
}

interface ModelPickerProps {
  backend: BackendKind
  model: string
  onChange: (next: string) => void
}

function ModelPicker({ backend, model, onChange }: ModelPickerProps): React.JSX.Element {
  if (backend === 'claude') {
    return (
      <select
        className="settings-field__input"
        value={model || DEFAULT_CLAUDE_MODEL}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Claude model"
      >
        {CLAUDE_MODELS.map((m) => (
          <option key={m.id} value={m.modelId}>
            {m.label}
          </option>
        ))}
      </select>
    )
  }
  const placeholder = 'opencode/gpt-5-nano'
  const label = 'Opencode model'
  return (
    <input
      className="settings-field__input"
      type="text"
      value={model}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
    />
  )
}
