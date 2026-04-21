/**
 * Per-agent-type runtime resolution.
 *
 * Every agent type — Pipeline, Synthesizer, Copilot, Assistant, Adhoc, Reviewer —
 * resolves its model (and, for Pipeline, its backend) from the user's stored
 * `agents.backendConfig` record. The Local backend is wired through today only
 * for Pipeline; the other types run on Claude regardless of the stored
 * `backend` field.
 *
 * Settings live in BDE's SQLite-backed JSON store under `SETTING_BACKEND_CONFIG`.
 * A missing value resolves to `DEFAULT_SETTINGS` (every type on `claude` with
 * the shared default model — zero behaviour change for existing users).
 */
import type { AgentType } from '../agent-system/personality/types'
import type {
  BackendKind,
  AgentBackendConfig,
  BackendSettings
} from '../../shared/types/backend-settings'
import { DEFAULT_CONFIG } from './types'
import { getSettingJson, setSettingJson } from '../settings'

export type { BackendKind, AgentBackendConfig, BackendSettings }

export const SETTING_BACKEND_CONFIG = 'agents.backendConfig'

const DEFAULT_LOCAL_ENDPOINT = 'http://localhost:1234/v1'

export const DEFAULT_SETTINGS: BackendSettings = {
  pipeline: { backend: 'claude', model: DEFAULT_CONFIG.defaultModel },
  synthesizer: { backend: 'claude', model: DEFAULT_CONFIG.defaultModel },
  copilot: { backend: 'claude', model: DEFAULT_CONFIG.defaultModel },
  assistant: { backend: 'claude', model: DEFAULT_CONFIG.defaultModel },
  adhoc: { backend: 'claude', model: DEFAULT_CONFIG.defaultModel },
  reviewer: { backend: 'claude', model: DEFAULT_CONFIG.defaultModel },
  localEndpoint: DEFAULT_LOCAL_ENDPOINT
}

export function loadBackendSettings(): BackendSettings {
  const stored = getSettingJson<Partial<BackendSettings>>(SETTING_BACKEND_CONFIG)
  if (!stored) return DEFAULT_SETTINGS
  return mergeWithDefaults(stored)
}

export function saveBackendSettings(next: BackendSettings): void {
  setSettingJson<BackendSettings>(SETTING_BACKEND_CONFIG, next)
}

export function resolveAgentRuntime(
  agentType: AgentType,
  settings: BackendSettings = loadBackendSettings()
): AgentBackendConfig {
  return settings[agentType]
}

function mergeWithDefaults(stored: Partial<BackendSettings>): BackendSettings {
  return {
    pipeline: stored.pipeline ?? DEFAULT_SETTINGS.pipeline,
    synthesizer: stored.synthesizer ?? DEFAULT_SETTINGS.synthesizer,
    copilot: stored.copilot ?? DEFAULT_SETTINGS.copilot,
    assistant: stored.assistant ?? DEFAULT_SETTINGS.assistant,
    adhoc: stored.adhoc ?? DEFAULT_SETTINGS.adhoc,
    reviewer: stored.reviewer ?? DEFAULT_SETTINGS.reviewer,
    localEndpoint: stored.localEndpoint ?? DEFAULT_SETTINGS.localEndpoint
  }
}
