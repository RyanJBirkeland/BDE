import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'
import type { SprintTask } from '../../../shared/types'
import type { TaskChange } from '../../data/task-changes'
import {
  TaskValidationError,
  type CreateTaskWithValidationDeps,
  type CreateTaskWithValidationOpts
} from '../../services/sprint-service'
import type { CancelTaskResult } from '../../services/sprint-use-cases'
import type { CreateTaskInput, ListTasksOptions } from '../../data/sprint-task-repository'
import { McpDomainError, McpErrorCode, parseToolArgs } from '../errors'
import {
  TaskCancelSchema,
  TaskCreateSchema,
  TaskHistorySchema,
  TaskIdSchema,
  TaskListSchema,
  TaskUpdateSchema,
  TASK_HISTORY_DEFAULT_LIMIT,
  TASK_HISTORY_MAX_WINDOW,
  TASK_LIST_DEFAULT_LIMIT,
  TASK_LIST_DEFAULT_OFFSET
} from '../schemas'
import { TERMINAL_STATUSES, isTaskStatus } from '../../../shared/task-state-machine'
import type { TaskStatus } from '../../../shared/task-state-machine'
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

function isRevivingTerminalTask(currentStatus: TaskStatus, targetStatus: unknown): boolean {
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
  ) => Promise<SprintTask>
  /**
   * `caller` is recorded in the `task_changes` audit trail as the
   * `changed_by` value. The MCP adapter passes `'mcp'` (or
   * `'mcp:<client-name>'` when the SDK exposes client info) so audit
   * rows can distinguish MCP-originated edits from IPC-originated ones.
   */
  updateTask: (id: string, patch: TaskPatch, options?: { caller?: string }) => Promise<SprintTask | null>
  cancelTask: (
    id: string,
    reason?: string,
    options?: { caller?: string }
  ) => Promise<CancelTaskResult> | CancelTaskResult
  /**
   * Fired when `tasks.update` drives a task into a terminal status from a
   * non-terminal one. Routes to `TaskTerminalService.onStatusTerminal` so
   * dependents unblock, the PR poller cleans up, and worktrees are reclaimed.
   * The revival direction (terminal → queued/backlog) never triggers this.
   */
  onStatusTerminal: (taskId: string, status: TaskStatus) => void | Promise<void>
  /** Central status-transition service — routes MCP status writes through TaskStateService. */
  taskStateService: import('../../services/task-state-service').TaskStateService
}

/**
 * Read-side task queries used by `tasks.list` and `tasks.get`.
 *
 * `listTasks` accepts either a bare `status` (legacy callers) or a
 * `ListTasksOptions` object so every filter and the pagination window
 * are pushed into SQL instead of being applied in memory at the tool.
 */
export interface TaskQueryPort {
  listTasks: (options?: string | ListTasksOptions) => SprintTask[]
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
  getTaskChanges: (
    id: string,
    options?: { limit?: number | undefined; offset?: number | undefined }
  ) => TaskChange[]
}

/**
 * Union of the three role-specific ports plus the shared logger, so
 * `registerTaskTools` still takes a single `deps` argument. Individual
 * tool functions can depend on a narrower port when they're lifted
 * out of this file.
 */
export interface TaskToolsDeps extends TaskCommandPort, TaskQueryPort, TaskHistoryPort {
  logger: CreateTaskWithValidationDeps['logger']
}

/**
 * Attribution label the MCP adapter passes through to the audit trail
 * for every write. Rendered in `task_changes.changed_by` so operators
 * can distinguish MCP-originated edits from IPC-originated ones without
 * reverse-engineering the log. Extend to `mcp:<client-name>` once the
 * SDK exposes a clean hook — the constant is the single source of truth.
 */
export const MCP_CALLER = 'mcp'

export function registerTaskTools(server: McpServer, deps: TaskToolsDeps): void {
  server.registerTool(
    'tasks.list',
    {
      description: 'List sprint tasks with optional filters (status, repo, epicId, tag, search).',
      inputSchema: TaskListSchema
    },
    async (rawArgs) =>
      safeToolResponse(
        async () => {
          const args = parseToolArgs(TaskListSchema, rawArgs)
          const rows = deps.listTasks(toListTasksOptions(args))
          return jsonContent(rows)
        },
        { schema: TaskListSchema, logger: deps.logger }
      )
  )

  server.registerTool(
    'tasks.get',
    { description: 'Fetch one task by id.', inputSchema: TaskIdSchema },
    async (rawArgs) =>
      safeToolResponse(
        async () => {
          const { id } = parseToolArgs(TaskIdSchema, rawArgs)
          const row = deps.getTask(id)
          if (!row) {
            deps.logger.debug(`mcp.tasks.get: task ${id} not found`)
            throw new McpDomainError(`Task ${id} not found`, McpErrorCode.NotFound, { id })
          }
          return jsonContent(row)
        },
        { schema: TaskIdSchema, logger: deps.logger }
      )
  )

  server.registerTool(
    'tasks.history',
    {
      description: 'Fetch the audit trail (field-level change log) for a task.',
      inputSchema: TaskHistorySchema
    },
    async (rawArgs) =>
      safeToolResponse(
        async () => {
          const { id, limit, offset } = parseToolArgs(TaskHistorySchema, rawArgs)
          assertHistoryWindowWithinCap(limit, offset)
          const task = deps.getTask(id)
          if (!task) {
            deps.logger.debug(`mcp.tasks.history: task ${id} not found`)
            throw new McpDomainError(`Task ${id} not found`, McpErrorCode.NotFound, { id })
          }
          const rows = deps.getTaskChanges(id, { limit, offset })
          return jsonContent(rows)
        },
        { schema: TaskHistorySchema, logger: deps.logger }
      )
  )

  registerTaskWriteTools(server, deps)
}

function registerTaskWriteTools(server: McpServer, deps: TaskToolsDeps): void {
  server.registerTool(
    'tasks.create',
    {
      description:
        'Create a new sprint task. Runs the same validation as the in-app Task Workbench.',
      inputSchema: TaskCreateSchema
    },
    async (rawArgs) =>
      safeToolResponse(
        async () => {
          const parsed = parseToolArgs(TaskCreateSchema, rawArgs)
          const { skipReadinessCheck, ...createInput } = parsed
          try {
            const row = await runCreateWithValidation(
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

  server.registerTool(
    'tasks.update',
    {
      description:
        'Update an existing task. Status transitions are validated; forbidden fields are stripped.',
      inputSchema: TaskUpdateSchema
    },
    async (rawArgs) =>
      safeToolResponse(
        async () => {
          const { id, patch } = parseToolArgs(TaskUpdateSchema, rawArgs)
          const current = deps.getTask(id)
          const effectivePatch = buildEffectiveUpdatePatch(patch, current)

          if ('status' in effectivePatch && typeof effectivePatch.status === 'string' && isTaskStatus(effectivePatch.status)) {
            // Status-changing write — route through TaskStateService for validation + terminal dispatch.
            const { status, ...nonStatusFields } = effectivePatch
            await deps.taskStateService.transition(id, status, {
              fields: nonStatusFields as Record<string, unknown>,
              caller: MCP_CALLER
            })
          } else {
            // Non-status write — plain field update.
            const row = await deps.updateTask(id, effectivePatch, { caller: MCP_CALLER })
            if (!row) {
              deps.logger.debug(`mcp.tasks.update: task ${id} not found`)
              throw new McpDomainError(`Task ${id} not found`, McpErrorCode.NotFound, { id })
            }
          }

          const updated = deps.getTask(id)
          if (!updated) {
            deps.logger.debug(`mcp.tasks.update: task ${id} not found after update`)
            throw new McpDomainError(`Task ${id} not found`, McpErrorCode.NotFound, { id })
          }
          return jsonContent(updated)
        },
        { schema: TaskUpdateSchema, logger: deps.logger }
      )
  )

  server.registerTool(
    'tasks.cancel',
    {
      description:
        'Cancel a task. Runs through the terminal-status path so dependents are re-evaluated.',
      inputSchema: TaskCancelSchema
    },
    async (rawArgs) =>
      safeToolResponse(
        async () => {
          const { id, reason } = parseToolArgs(TaskCancelSchema, rawArgs)
          const result = await deps.cancelTask(id, reason, { caller: MCP_CALLER })
          if (result.row === null) {
            deps.logger.debug(`mcp.tasks.cancel: task ${id} not found`)
            throw new McpDomainError(`Task ${id} not found`, McpErrorCode.NotFound, { id })
          }
          if (result.sideEffectFailed) {
            deps.logger.warn(
              `mcp.tasks.cancel: task ${id} cancelled but terminal dispatch failed — dependents may need manual unblock`
            )
            return jsonContent({
              ...result.row,
              warning:
                'terminal dispatch failed — dependents may need manual unblock'
            })
          }
          return jsonContent(result.row)
        },
        { schema: TaskCancelSchema, logger: deps.logger }
      )
  )
}

function runCreateWithValidation(
  deps: TaskToolsDeps,
  createInput: CreateTaskInput,
  skipReadinessCheck: boolean | undefined
): Promise<SprintTask> {
  const delegateDeps = { logger: deps.logger }
  if (skipReadinessCheck === undefined) {
    return deps.createTaskWithValidation(createInput, delegateDeps)
  }
  return deps.createTaskWithValidation(createInput, delegateDeps, { skipReadinessCheck })
}

/**
 * Project the parsed `tasks.list` args into the `ListTasksOptions` shape
 * the data layer consumes. Applies the default pagination window so the
 * repository always sees an explicit `LIMIT`/`OFFSET` — matches the
 * previous in-memory `slice(offset, offset + limit)` default.
 */
function toListTasksOptions(args: ReturnType<typeof TaskListSchema.parse>): ListTasksOptions {
  return {
    status: args.status,
    repo: args.repo,
    epicId: args.epicId,
    tag: args.tag,
    search: args.search,
    limit: args.limit ?? TASK_LIST_DEFAULT_LIMIT,
    offset: args.offset ?? TASK_LIST_DEFAULT_OFFSET
  }
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

function buildEffectiveUpdatePatch(patch: TaskPatch, current: SprintTask | null): TaskPatch {
  if (!('status' in patch) || !current) return { ...patch }
  if (!isRevivingTerminalTask(current.status, patch.status)) return { ...patch }
  return { ...patch, ...TERMINAL_STATE_RESET_PATCH }
}

/**
 * Reject `tasks.history` requests whose reach into the table exceeds
 * `TASK_HISTORY_MAX_WINDOW`. Beyond this window SQLite pays the full
 * scan cost for the skipped rows — effectively an unbounded query.
 */
function assertHistoryWindowWithinCap(limit: number | undefined, offset: number | undefined): void {
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
