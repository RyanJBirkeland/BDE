/**
 * TaskQueueAPI request/response types.
 * Shared between BDE (server) and task runner (client).
 */

export interface QueueHealthResponse {
  status: 'ok'
  version: string
  queue: {
    backlog: number
    queued: number
    blocked: number
    active: number
    done: number
    failed: number
    cancelled: number
    error: number
  }
}

export interface ClaimRequest {
  executorId: string
}

export interface StatusUpdateRequest {
  status: 'queued' | 'active' | 'done' | 'failed' | 'cancelled' | 'error'
  prUrl?: string
  prNumber?: number
  prStatus?: 'open' | 'merged' | 'closed' | 'draft'
  prMergeableState?: string
  completedAt?: string
  startedAt?: string
  agentRunId?: string
  retryCount?: number
  fastFailCount?: number
  notes?: string
}

/** Runner-writable status values for PATCH /queue/tasks/:id/status */
export const RUNNER_WRITABLE_STATUSES = new Set(['queued', 'active', 'done', 'failed', 'cancelled', 'error'])

/** Allowed fields in a status update patch */
export const STATUS_UPDATE_FIELDS = new Set([
  'status', 'prUrl', 'prNumber', 'prStatus', 'prMergeableState',
  'completedAt', 'startedAt', 'agentRunId', 'retryCount',
  'fastFailCount', 'notes',
])

/** Allowed fields for general PATCH /queue/tasks/:id — excludes status, claimed_by, depends_on
 *  which must go through their dedicated endpoints to enforce validation. */
export const GENERAL_PATCH_FIELDS = new Set([
  'title', 'prompt', 'repo', 'spec', 'notes', 'priority', 'templateName', 'playgroundEnabled',
])

// --- Streaming Visibility Event Types ---

/** All possible event type discriminators */
export type TaskOutputEventType =
  | 'agent:started'
  | 'agent:tool_call'
  | 'agent:tool_result'
  | 'agent:thinking'
  | 'agent:rate_limited'
  | 'agent:error'
  | 'agent:completed'

/** Base event shape — all specific events extend this */
export interface TaskOutputEvent {
  taskId: string
  timestamp: string // ISO 8601
  type: TaskOutputEventType | string // string for forward-compat with unknown types
}

/** Agent started executing */
export interface AgentStartedEvent extends TaskOutputEvent {
  type: 'agent:started'
  model: string
}

/** Agent invoked a tool */
export interface AgentToolCallEvent extends TaskOutputEvent {
  type: 'agent:tool_call'
  tool: string
  summary: string
  input?: string
}

/** Tool returned a result */
export interface AgentToolResultEvent extends TaskOutputEvent {
  type: 'agent:tool_result'
  tool: string
  success: boolean
  summary: string
}

/** Agent is thinking / processing tokens */
export interface AgentThinkingEvent extends TaskOutputEvent {
  type: 'agent:thinking'
  tokenCount: number
}

/** API rate limited */
export interface AgentRateLimitedEvent extends TaskOutputEvent {
  type: 'agent:rate_limited'
  retryDelayMs: number
  attempt: number
}

/** Agent encountered an error */
export interface AgentErrorEvent extends TaskOutputEvent {
  type: 'agent:error'
  message: string
}

/** Agent finished execution */
export interface AgentCompletedEvent extends TaskOutputEvent {
  type: 'agent:completed'
  exitCode: number
  costUsd: number | null
  tokensIn: number | null
  tokensOut: number | null
  durationMs: number
}

// --- Task Events Response Types ---

export interface TaskEventItem {
  id: number
  agentId: string
  eventType: string
  payload: string
  timestamp: number
}

export interface TaskEventsResponse {
  events: TaskEventItem[]
  hasMore: boolean
}

// --- Health Monitoring Types ---

export type HealthCondition = 'healthy' | 'degraded' | 'unhealthy'

export interface RecentHealth {
  windowMinutes: number
  agentExits: { total: number; done: number; failed: number; error: number }
  successRate: number | null
  avgDurationMs: number | null
  rateLimits: number
  stalls: number
  fastFails: number
  condition: HealthCondition
}

export interface HealthDegradedPayload {
  previousCondition: HealthCondition
  currentCondition: HealthCondition
  recentHealth: RecentHealth
}
