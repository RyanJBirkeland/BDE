/**
 * Centralized status constants — single source of truth.
 * Use these instead of raw string literals to prevent typos and enable refactoring.
 */

export const TASK_STATUS = {
  BACKLOG: 'backlog',
  QUEUED: 'queued',
  BLOCKED: 'blocked',
  ACTIVE: 'active',
  REVIEW: 'review',
  DONE: 'done',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
  ERROR: 'error'
} as const

export type TaskStatusValue = (typeof TASK_STATUS)[keyof typeof TASK_STATUS]

export const PR_STATUS = {
  OPEN: 'open',
  MERGED: 'merged',
  CLOSED: 'closed',
  DRAFT: 'draft',
  BRANCH_ONLY: 'branch_only'
} as const

export type PrStatusValue = (typeof PR_STATUS)[keyof typeof PR_STATUS]

export const AGENT_STATUS = {
  RUNNING: 'running',
  DONE: 'done',
  ERROR: 'error',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  UNKNOWN: 'unknown'
} as const

export type AgentStatusValue = (typeof AGENT_STATUS)[keyof typeof AGENT_STATUS]

/** Default task templates seeded on first access. */
export const DEFAULT_TASK_TEMPLATES = [
  {
    name: 'bugfix',
    promptPrefix:
      "You are fixing a bug. Be surgical — change only what's necessary. Identify the root cause before writing code. Include a test that reproduces the bug."
  },
  {
    name: 'feature',
    promptPrefix:
      'You are building a new feature. Follow the spec exactly. Reference specific file paths. Write tests for new functionality.'
  },
  {
    name: 'refactor',
    promptPrefix:
      'You are refactoring existing code. Do not change behavior — only improve structure, naming, and organization. Existing tests must still pass.'
  },
  {
    name: 'test',
    promptPrefix:
      'You are writing tests. Cover edge cases and error paths, not just happy paths. Use the existing test patterns in the codebase.'
  }
] as const
