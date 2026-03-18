/**
 * Centralized status constants — single source of truth.
 * Use these instead of raw string literals to prevent typos and enable refactoring.
 */

export const TASK_STATUS = {
  BACKLOG: 'backlog',
  QUEUED: 'queued',
  ACTIVE: 'active',
  DONE: 'done',
  CANCELLED: 'cancelled',
} as const

export type TaskStatusValue = (typeof TASK_STATUS)[keyof typeof TASK_STATUS]

export const PR_STATUS = {
  OPEN: 'open',
  MERGED: 'merged',
  CLOSED: 'closed',
  DRAFT: 'draft',
} as const

export type PrStatusValue = (typeof PR_STATUS)[keyof typeof PR_STATUS]

export const AGENT_STATUS = {
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  UNKNOWN: 'unknown',
} as const

export type AgentStatusValue = (typeof AGENT_STATUS)[keyof typeof AGENT_STATUS]
