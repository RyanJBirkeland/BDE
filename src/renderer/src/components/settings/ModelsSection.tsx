/**
 * ModelsSection — per-agent-type backend + model routing.
 *
 * Loads the composite `agents.backendConfig` setting on mount, renders:
 *   1. a shared Local backend card (endpoint URL + test connection),
 *   2. an Active routing card (Pipeline row — the only type wired today),
 *   3. a Not yet routed card (five disabled rows for future types).
 *
 * Saves the entire BackendSettings object in one atomic setJson call.
 */
import './ModelsSection.css'
import { useCallback, useEffect, useState } from 'react'
import { SettingsCard } from './SettingsCard'
import { Button } from '../ui/Button'
import { toast } from '../../stores/toasts'

const DEFAULT_LOCAL_ENDPOINT = 'http://localhost:1234/v1'
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5'
const DEFAULT_LOCAL_MODEL = ''
const LOCAL_MODEL_PLACEHOLDER = 'openai/qwen/qwen3.6-35b-a3b'
const CLAUDE_MODELS = ['claude-sonnet-4-5', 'claude-opus-4-7', 'claude-haiku-4-5'] as const

type AgentTypeId =
  | 'pipeline'
  | 'synthesizer'
  | 'copilot'
  | 'assistant'
  | 'adhoc'
  | 'reviewer'

type BackendKind = 'claude' | 'local'

interface AgentTypeMeta {
  id: AgentTypeId
  label: string
  description: string
}

const ACTIVE_TYPES: AgentTypeMeta[] = [
  { id: 'pipeline', label: 'Pipeline', description: 'Executes sprint tasks end-to-end.' }
]

const NOT_YET_ROUTED_TYPES: AgentTypeMeta[] = [
  { id: 'synthesizer', label: 'Synthesizer', description: 'Drafts spec documents from task titles.' },
  { id: 'copilot', label: 'Copilot', description: 'Interactive pair-programming agent.' },
  { id: 'assistant', label: 'Assistant', description: 'One-shot Q&A over the repo.' },
  { id: 'adhoc', label: 'Adhoc', description: 'Freeform agent runs outside the sprint pipeline.' },
  { id: 'reviewer', label: 'Reviewer', description: 'Reviews PRs before merge.' }
]

interface AgentBackendConfig {
  backend: BackendKind
  model: string
}

interface BackendSettings {
  pipeline: AgentBackendConfig
  synthesizer: AgentBackendConfig
  copilot: AgentBackendConfig
  assistant: AgentBackendConfig
  adhoc: AgentBackendConfig
  reviewer: AgentBackendConfig
  localEndpoint: string
}

const DEFAULT_ROW: AgentBackendConfig = { backend: 'claude', model: DEFAULT_CLAUDE_MODEL }

function defaultBackendSettings(): BackendSettings {
  return {
    pipeline: { ...DEFAULT_ROW },
    synthesizer: { ...DEFAULT_ROW },
    copilot: { ...DEFAULT_ROW },
    assistant: { ...DEFAULT_ROW },
    adhoc: { ...DEFAULT_ROW },
    reviewer: { ...DEFAULT_ROW },
    localEndpoint: DEFAULT_LOCAL_ENDPOINT
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

  function updateEndpoint(next: string): void {
    updateSettings({ ...settings, localEndpoint: next })
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
        title="Local backend"
        subtitle="LM Studio, Ollama, or any OpenAI-compatible server."
      >
        <label className="settings-field">
          <span className="settings-field__label">Endpoint URL</span>
          <input
            className="settings-field__input"
            type="text"
            value={settings.localEndpoint}
            onChange={(e) => updateEndpoint(e.target.value)}
            placeholder={DEFAULT_LOCAL_ENDPOINT}
          />
        </label>
      </SettingsCard>

      <SettingsCard title="Active routing" subtitle="Types wired through spawnAgent today.">
        {ACTIVE_TYPES.map((type) => (
          <AgentTypeRow
            key={type.id}
            type={type}
            value={settings[type.id]}
            onChange={(next) => updateRow(type.id, next)}
            disabled={false}
          />
        ))}
      </SettingsCard>

      <SettingsCard
        title="Not yet routed"
        subtitle="Configuration preserved for when each type is wired through spawnAgent."
      >
        {NOT_YET_ROUTED_TYPES.map((type) => (
          <AgentTypeRow
            key={type.id}
            type={type}
            value={settings[type.id]}
            onChange={(next) => updateRow(type.id, next)}
            disabled={true}
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
  disabled: boolean
}

function AgentTypeRow({ type, value, onChange, disabled }: AgentTypeRowProps): React.JSX.Element {
  function toggleBackend(next: BackendKind): void {
    if (next === value.backend) return
    onChange({
      backend: next,
      model: next === 'claude' ? DEFAULT_CLAUDE_MODEL : DEFAULT_LOCAL_MODEL
    })
  }

  return (
    <div
      className="models-row"
      data-testid={`models-row-${type.id}`}
      aria-disabled={disabled || undefined}
    >
      <div className="models-row__label">{type.label}</div>
      <div className="models-row__desc">{type.description}</div>
      {disabled && <div className="models-row__desc">Not yet routed.</div>}
      <div className="models-row__controls">
        <BackendToggle
          value={value.backend}
          onChange={toggleBackend}
          disabled={disabled}
          rowId={type.id}
        />
        <ModelPicker
          backend={value.backend}
          model={value.model}
          onChange={(model) => onChange({ ...value, model })}
          disabled={disabled}
        />
      </div>
    </div>
  )
}

interface BackendToggleProps {
  value: BackendKind
  onChange: (next: BackendKind) => void
  disabled: boolean
  rowId: string
}

function BackendToggle({ value, onChange, disabled, rowId }: BackendToggleProps): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={`${rowId} backend`} className="models-seg">
      <button
        type="button"
        role="radio"
        aria-checked={value === 'claude'}
        data-value="claude"
        disabled={disabled}
        onClick={() => onChange('claude')}
        className="models-seg__btn"
      >
        Claude
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === 'local'}
        data-value="local"
        disabled={disabled}
        onClick={() => onChange('local')}
        className="models-seg__btn"
      >
        Local
      </button>
    </div>
  )
}

interface ModelPickerProps {
  backend: BackendKind
  model: string
  onChange: (next: string) => void
  disabled: boolean
}

function ModelPicker({ backend, model, onChange, disabled }: ModelPickerProps): React.JSX.Element {
  if (backend === 'claude') {
    return (
      <select
        className="settings-field__input"
        value={model || DEFAULT_CLAUDE_MODEL}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label="Claude model"
      >
        {CLAUDE_MODELS.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
    )
  }
  return (
    <input
      className="settings-field__input"
      type="text"
      value={model}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={LOCAL_MODEL_PLACEHOLDER}
      aria-label="Local model"
    />
  )
}
