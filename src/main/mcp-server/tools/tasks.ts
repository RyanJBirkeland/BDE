import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'
import type { SprintTask } from '../../../shared/types'
import type { TaskChange } from '../../data/task-changes'
import {
  TaskValidationError,
  type CreateTaskWithValidationDeps,
  type CreateTaskWithValidationOpts
} from '../../services/sprint-service'
import type { CreateTaskInput } from '../../data/sprint-task-repository'
import { McpDomainError, McpErrorCode, parseToolArgs } from '../errors'
import {
  TaskCancelSchema,
  TaskCreateSchema,
  TaskHistorySchema,
  TaskIdSchema,
  TaskListSchema,
  TaskUpdateSchema,
  TASK_HISTORY_DEFAULT_LIMIT,
  TASK_HISTORY_MAX_WINDOW
} from '../schemas'
import { TERMINAL_STATUSES } from '../../../shared/task-state-machine'
import { jsonContent, safeToolResponse } from './response'

/**
 * Precise patch shape derived from the MCP write schema. Replaces the
 * previous `Record<string, unknown>` signature so downstream callers see
 * the exact set of fields the schema validates and strips.
 */
export type TaskPatch = z.infer<typeof TaskUpdateSchema>['patch']

/**
 * Patch fragment that clears stale terminal-state fields. Applied when an
 * MCP `tasks.update` call transitions a task from a terminal status back
 * into the active lifecycle (`queued` or `backlog`). Mirrors the in-app
 * `sprint:retry` hygiene so the re-queued row looks freshly created.
 */
const TERMINAL_STATE_RESET_PATCH = {
  completed_at: null,
  failure_reason: null,
  claimed_by: null,
  started_at: null,
  retry_count: 0,
  fast_fail_count: 0,
  next_eligible_at: null
} as const

function isRevivingTerminalTask(currentStatus: string, targetStatus: unknown): boolean {
  if (targetStatus !== 'queued' && targetStatus !== 'backlog') return false
  return TERMINAL_STATUSES.has(currentStatus)
}

/**
 * Write-side operations. Pure commands — nothing that merely inspects
 * data belongs here. `onStatusTerminal` lives alongside the writes
 * because a command (`tasks.update` into a terminal status) is what
 * triggers it.
 */
export interface TaskCommandPort {
  createTaskWithValidation: (
    input: CreateTaskInput,
    deps: CreateTaskWithValidationDeps,
    opts?: CreateTaskWithValidationOpts
  ) => SprintTask
  updateTask: (id: string, patch: TaskPatch) => SprintTask | null
  cancelTask: (id: string, reason?: string) => Promise<SprintTask | null> | SprintTask | null
  /**
   * Fired when `tasks.update` drives a task into a terminal status from a
   * non-terminal one. Routes to `TaskTerminalService.onStatusTerminal` so
   * dependents unblock, the PR poller cleans up, and worktrees are reclaimed.
   * The revival direction (terminal → queued/backlog) never triggers this.
   */
  onStatusTerminal: (taskId: string, status: string) => void | Promise<void>
}

/**
 * Read-side task queries used by `tasks.list` and `tasks.get`.
 */
export interface TaskQueryPort {
  listTasks: (status?: string) => SprintTask[]
  getTask: (id: string) => SprintTask | null
}

/**
 * Audit-log queries used by `tasks.history`.
 */
export interface TaskHistoryPort {
  /**
   * Mirrors the data-layer signature after T-3 — pagination is pushed
   * into SQL (`LIMIT ? OFFSET ?`) instead of slicing in memory.
   */
  getTaskChanges: (id: string, options?: { limit?: number; offset?: number }) => TaskChange[]
}

/**
 * Union of the three role-specific ports plus the shared logger, so
 * `registerTaskTools` still takes a single `deps` argument. Individual
 * tool functions can depend on a narrower port when they're lifted
 * out of this file.
 */
export interface TaskToolsDeps
  extends TaskCommandPort,
    TaskQueryPort,
    TaskHistoryPort {
  logger: CreateTaskWithValidationDeps['logger']
}

function filterInMemory(
  tasks: SprintTask[],
  args: ReturnType<typeof TaskListSchema.parse>
): SprintTask[] {
  let out = tasks
  if (args.repo) out = out.filter((t) => t.repo === args.repo)
  if (args.epicId) out = out.filter((t) => t.group_id === args.epicId)
  if (args.tag) out = out.filter((t) => Array.isArray(t.tags) && t.tags.includes(args.tag!))
  if (args.search) {
    const q = args.search.toLowerCase()
    out = out.filter(
      (t) =>
        t.title.toLowerCase().includes(q) || (t.spec ? t.spec.toLowerCase().includes(q) : false)
    )
  }
  const offset = args.offset ?? 0
  const limit = args.limit ?? 100
  return out.slice(offset, offset + limit)
}

export function registerTaskTools(server: McpServer, deps: TaskToolsDeps): void {
  server.tool(
    'tasks.list',
    'List sprint tasks with optional filters (status, repo, epicId, tag, search).',
    TaskListSchema.shape,
    async (rawArgs) =>
      safeToolResponse(
        async () => {
          const args = parseToolArgs(TaskListSchema, rawArgs)
          const rows = deps.listTasks(args.status)
          return jsonContent(filterInMemory(rows, args))
        },
        { schema: TaskListSchema, logger: deps.logger }
      )
  )

  server.tool('tasks.get', 'Fetch one task by id.', TaskIdSchema.shape, async (rawArgs) =>
    safeToolResponse(
      async () => {
        const { id } = parseToolArgs(TaskIdSchema, rawArgs)
        const row = deps.getTask(id)
        if (!row) throw new McpDomainError(`Task ${id} not found`, McpErrorCode.NotFound, { id })
        return jsonContent(row)
      },
      { schema: TaskIdSchema, logger: deps.logger }
    )
  )

  server.tool(
    'tasks.history',
    'Fetch the audit trail (field-level change log) for a task.',
    TaskHistorySchema.shape,
    async (rawArgs) =>
      safeToolResponse(
        async () => {
          const { id, limit, offset } = parseToolArgs(TaskHistorySchema, rawArgs)
          assertHistoryWindowWithinCap(limit, offset)
          const task = deps.getTask(id)
          if (!task) throw new McpDomainError(`Task ${id} not found`, McpErrorCode.NotFound, { id })
          const rows = deps.getTaskChanges(id, { limit, offset })
          return jsonContent(rows)
        },
        { schema: TaskHistorySchema, logger: deps.logger }
      )
  )

  registerTaskWriteTools(server, deps)
}

function registerTaskWriteTools(server: McpServer, deps: TaskToolsDeps): void {
  server.tool(
    'tasks.create',
    'Create a new sprint task. Runs the same validation as the in-app Task Workbench.',
    TaskCreateSchema.shape,
    async (rawArgs) =>
      safeToolResponse(
        async () => {
          const parsed = parseToolArgs(TaskCreateSchema, rawArgs)
          const { skipReadinessCheck, ...createInput } = parsed
          try {
            const row = runCreateWithValidation(
              deps,
              createInput as CreateTaskInput,
              skipReadinessCheck
            )
            return jsonContent(row)
          } catch (err) {
            throw rewrapTaskValidationError(err)
          }
        },
        { schema: TaskCreateSchema, logger: deps.logger }
      )
  )

  server.tool(
    'tasks.update',
    'Update an existing task. Status transitions are validated; forbidden fields are stripped.',
    TaskUpdateSchema.shape,
    async (rawArgs) =>
      safeToolResponse(
        async () => {
          const { id, patch } = parseToolArgs(TaskUpdateSchema, rawArgs)
          const current = deps.getTask(id)
          const effectivePatch = buildEffectiveUpdatePatch(patch, current)
          const row = deps.updateTask(id, effectivePatch)
          if (!row) throw new McpDomainError(`Task ${id} not found`, McpErrorCode.NotFound, { id })
          await fireTerminalHookIfNeeded(deps, current, row)
          return jsonContent(row)
        },
        { schema: TaskUpdateSchema, logger: deps.logger }
      )
  )

  server.tool(
    'tasks.cancel',
    'Cancel a task. Runs through the terminal-status path so dependents are re-evaluated.',
    TaskCancelSchema.shape,
    async (rawArgs) =>
      safeToolResponse(
        async () => {
          const { id, reason } = parseToolArgs(TaskCancelSchema, rawArgs)
          const row = await deps.cancelTask(id, reason)
          if (!row) throw new McpDomainError(`Task ${id} not found`, McpErrorCode.NotFound, { id })
          return jsonContent(row)
        },
        { schema: TaskCancelSchema, logger: deps.logger }
      )
  )
}

function runCreateWithValidation(
  deps: TaskToolsDeps,
  createInput: CreateTaskInput,
  skipReadinessCheck: boolean | undefined
): SprintTask {
  const delegateDeps = { logger: deps.logger }
  if (skipReadinessCheck === undefined) {
    return deps.createTaskWithValidation(createInput, delegateDeps)
  }
  return deps.createTaskWithValidation(createInput, delegateDeps, { skipReadinessCheck })
}

/**
 * Translate `TaskValidationError` into `McpDomainError(ValidationFailed)` so
 * MCP clients see a structured `code` + machine-readable subcode (`spec-structural`,
 * `spec-readiness`, `repo-not-configured`). Unknown throws propagate.
 */
function rewrapTaskValidationError(err: unknown): unknown {
  if (err instanceof TaskValidationError) {
    return new McpDomainError(err.message, McpErrorCode.ValidationFailed, { code: err.code })
  }
  return err
}

function buildEffectiveUpdatePatch(
  patch: TaskPatch,
  current: SprintTask | null
): TaskPatch {
  if (!('status' in patch) || !current) return { ...patch }
  if (!isRevivingTerminalTask(current.status, patch.status)) return { ...patch }
  return { ...patch, ...TERMINAL_STATE_RESET_PATCH }
}

/**
 * Fire `onStatusTerminal` when `tasks.update` drives a task into a terminal
 * status from a non-terminal one. The revival direction (terminal → queued or
 * terminal → backlog) is handled elsewhere — it is not a terminal *entry*.
 */
async function fireTerminalHookIfNeeded(
  deps: TaskToolsDeps,
  pre: SprintTask | null,
  post: SprintTask
): Promise<void> {
  if (!pre) return
  if (!TERMINAL_STATUSES.has(post.status)) return
  if (TERMINAL_STATUSES.has(pre.status)) return
  await deps.onStatusTerminal(post.id, post.status)
}

/**
 * Reject `tasks.history` requests whose reach into the table exceeds
 * `TASK_HISTORY_MAX_WINDOW`. Beyond this window SQLite pays the full
 * scan cost for the skipped rows — effectively an unbounded query.
 */
function assertHistoryWindowWithinCap(
  limit: number | undefined,
  offset: number | undefined
): void {
  const effectiveLimit = limit ?? TASK_HISTORY_DEFAULT_LIMIT
  const effectiveOffset = offset ?? 0
  if (effectiveLimit + effectiveOffset > TASK_HISTORY_MAX_WINDOW) {
    throw new McpDomainError(
      `tasks.history window too large: limit (${effectiveLimit}) + offset (${effectiveOffset}) exceeds ${TASK_HISTORY_MAX_WINDOW}`,
      McpErrorCode.ValidationFailed,
      { limit: effectiveLimit, offset: effectiveOffset, cap: TASK_HISTORY_MAX_WINDOW }
    )
  }
}
