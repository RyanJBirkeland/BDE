/**
 * ModelsSection — per-agent-type backend + model routing.
 *
 * Loads the composite `agents.backendConfig` setting on mount, renders:
 *   1. a shared Local backend card (endpoint URL + test connection),
 *   2. an Active routing card with one row per agent type. The model
 *      picker is always interactive; the Local backend radio is disabled
 *      on agent types whose spawn path does not yet support local models.
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

type TestConnState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ok'; modelCount: number; latencyMs: number }
  | { kind: 'fail'; error: string }

const DEFAULT_LOCAL_ENDPOINT = 'http://localhost:1234/v1'
const DEFAULT_CLAUDE_MODEL = DEFAULT_MODEL.modelId
const DEFAULT_LOCAL_MODEL = ''
const LOCAL_MODEL_PLACEHOLDER = 'openai/qwen/qwen3.6-35b-a3b'

type AgentTypeId = 'pipeline' | 'synthesizer' | 'copilot' | 'assistant' | 'adhoc' | 'reviewer'

interface AgentTypeMeta {
  id: AgentTypeId
  label: string
  description: string
  supportsLocal: boolean
}

const AGENT_TYPES: AgentTypeMeta[] = [
  {
    id: 'pipeline',
    label: 'Pipeline',
    description: 'Executes sprint tasks end-to-end.',
    supportsLocal: true
  },
  {
    id: 'synthesizer',
    label: 'Synthesizer',
    description: 'Drafts spec documents from task titles.',
    supportsLocal: false
  },
  {
    id: 'copilot',
    label: 'Copilot',
    description: 'Interactive pair-programming agent.',
    supportsLocal: false
  },
  {
    id: 'assistant',
    label: 'Assistant',
    description: 'One-shot Q&A over the repo.',
    supportsLocal: false
  },
  {
    id: 'adhoc',
    label: 'Adhoc',
    description: 'Freeform agent runs outside the sprint pipeline.',
    supportsLocal: false
  },
  {
    id: 'reviewer',
    label: 'Reviewer',
    description: 'Reviews PRs before merge.',
    supportsLocal: false
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
    localEndpoint: DEFAULT_LOCAL_ENDPOINT
  }
}

export function ModelsSection(): React.JSX.Element {
  const [settings, setSettings] = useState<BackendSettings>(defaultBackendSettings)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testConn, setTestConn] = useState<TestConnState>({ kind: 'idle' })

  const handleTestConnection = useCallback(async (): Promise<void> => {
    setTestConn({ kind: 'pending' })
    const result = await window.api.agents.testLocalEndpoint(settings.localEndpoint)
    if (result.ok) {
      setTestConn({ kind: 'ok', modelCount: result.modelCount, latencyMs: result.latencyMs })
    } else {
      setTestConn({ kind: 'fail', error: result.error })
    }
  }, [settings.localEndpoint])

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
    setTestConn({ kind: 'idle' })
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
        <div className="models-row__controls" style={{ marginTop: '8px' }}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleTestConnection}
            disabled={testConn.kind === 'pending'}
            loading={testConn.kind === 'pending'}
          >
            Test connection
          </Button>
          <TestConnIndicator state={testConn} />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Active routing"
        subtitle="Route each agent type to Claude or a local model. Local backend is available for Pipeline today."
      >
        {AGENT_TYPES.map((type) => (
          <AgentTypeRow
            key={type.id}
            type={type}
            value={settings[type.id]}
            onChange={(next) => updateRow(type.id, next)}
            canUseLocal={type.supportsLocal}
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

function TestConnIndicator({ state }: { state: TestConnState }): React.JSX.Element | null {
  if (state.kind === 'idle') return null
  if (state.kind === 'pending') {
    return (
      <span className="models-status" aria-live="polite">
        Testing…
      </span>
    )
  }
  if (state.kind === 'ok') {
    return (
      <span className="models-status models-status--ok" aria-live="polite">
        ✓ Reachable — {state.modelCount} models loaded ({state.latencyMs} ms)
      </span>
    )
  }
  return (
    <span className="models-status models-status--err" aria-live="polite">
      ✕ {state.error}
    </span>
  )
}

interface AgentTypeRowProps {
  type: AgentTypeMeta
  value: AgentBackendConfig
  onChange: (next: AgentBackendConfig) => void
  canUseLocal: boolean
}

function AgentTypeRow({
  type,
  value,
  onChange,
  canUseLocal
}: AgentTypeRowProps): React.JSX.Element {
  function toggleBackend(next: BackendKind): void {
    if (next === value.backend) return
    onChange({
      backend: next,
      model: next === 'claude' ? DEFAULT_CLAUDE_MODEL : DEFAULT_LOCAL_MODEL
    })
  }

  return (
    <div className="models-row" data-testid={`models-row-${type.id}`}>
      <div className="models-row__label">{type.label}</div>
      <div className="models-row__desc">{type.description}</div>
      <div className="models-row__controls">
        <BackendToggle
          value={value.backend}
          onChange={toggleBackend}
          canUseLocal={canUseLocal}
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
  canUseLocal: boolean
  rowId: string
}

const LOCAL_UNSUPPORTED_TOOLTIP = 'Local backend is not yet supported for this agent type'

function BackendToggle({
  value,
  onChange,
  canUseLocal,
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
        aria-checked={value === 'local'}
        data-value="local"
        disabled={!canUseLocal}
        title={canUseLocal ? undefined : LOCAL_UNSUPPORTED_TOOLTIP}
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
  return (
    <input
      className="settings-field__input"
      type="text"
      value={model}
      onChange={(e) => onChange(e.target.value)}
      placeholder={LOCAL_MODEL_PLACEHOLDER}
      aria-label="Local model"
    />
  )
}
