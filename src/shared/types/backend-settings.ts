/**
 * Backend-selection types — shared across the main process and renderer.
 *
 * Each agent type can be routed to the built-in Claude SDK path or to the
 * opencode CLI backend. `BackendSettings` is the persisted shape stored
 * under `agents.backendConfig`.
 */

export type BackendKind = 'claude' | 'opencode'

export interface AgentBackendConfig {
  backend: BackendKind
  model: string
}

export interface BackendSettings {
  pipeline: AgentBackendConfig
  synthesizer: AgentBackendConfig
  copilot: AgentBackendConfig
  assistant: AgentBackendConfig
  adhoc: AgentBackendConfig
  reviewer: AgentBackendConfig
  opencodeExecutable: string
}
