// src/main/agents/types.ts

// --- Agent Events (unified event stream for local + remote agents) ---

export type AgentEventType =
  | 'agent:started'
  | 'agent:text'
  | 'agent:user_message'
  | 'agent:thinking'
  | 'agent:tool_call'
  | 'agent:tool_result'
  | 'agent:rate_limited'
  | 'agent:error'
  | 'agent:completed'

export type AgentEvent =
  | { type: 'agent:started'; model: string; timestamp: number }
  | { type: 'agent:text'; text: string; timestamp: number }
  | { type: 'agent:user_message'; text: string; timestamp: number }
  | { type: 'agent:thinking'; tokenCount: number; text?: string; timestamp: number }
  | { type: 'agent:tool_call'; tool: string; summary: string; input?: unknown; timestamp: number }
  | { type: 'agent:tool_result'; tool: string; success: boolean; summary: string; output?: unknown; timestamp: number }
  | { type: 'agent:rate_limited'; retryDelayMs: number; attempt: number; timestamp: number }
  | { type: 'agent:error'; message: string; timestamp: number }
  | { type: 'agent:completed'; exitCode: number; costUsd: number; tokensIn: number; tokensOut: number; durationMs: number; timestamp: number }

// --- Agent Provider Interface ---

export interface AgentSpawnOptions {
  prompt: string
  workingDirectory: string
  model?: string
  maxTokens?: number
  templatePrefix?: string
  agentId?: string
}

export interface AgentHandle {
  id: string
  pid?: number
  logPath?: string
  events: AsyncIterable<AgentEvent>
  steer(message: string): Promise<void>
  stop(): Promise<void>
}

export interface AgentProvider {
  spawn(opts: AgentSpawnOptions): Promise<AgentHandle>
}
