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
    active: number
    done: number
    failed: number
    cancelled: number
  }
}

export interface ClaimRequest {
  executorId: string
}

export interface StatusUpdateRequest {
  status: 'active' | 'done' | 'failed' | 'cancelled'
  pr_url?: string
  pr_number?: number
  pr_status?: 'open' | 'merged' | 'closed' | 'draft'
  completed_at?: string
  agent_run_id?: string
}

/** Runner-writable status values for PATCH /queue/tasks/:id/status */
export const RUNNER_WRITABLE_STATUSES = new Set(['active', 'done', 'failed', 'cancelled'])

/** Allowed fields in a status update patch */
export const STATUS_UPDATE_FIELDS = new Set([
  'status',
  'pr_url',
  'pr_number',
  'pr_status',
  'completed_at',
  'agent_run_id',
])
