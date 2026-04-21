import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SprintTask } from '../../../shared/types'
import type { TaskChange } from '../../data/task-changes'
import type {
  CreateTaskWithValidationDeps,
  CreateTaskWithValidationOpts
} from '../../services/sprint-service'
import type { CreateTaskInput } from '../../data/sprint-task-repository'
import { McpDomainError, McpErrorCode, parseToolArgs } from '../errors'
import {
  TaskCancelSchema,
  TaskCreateSchema,
  TaskHistorySchema,
  TaskIdSchema,
  TaskListSchema,
  TaskUpdateSchema
} from '../schemas'
import { TERMINAL_STATUSES } from '../../../shared/task-state-machine'

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

function isRevivingTerminalTask(
  currentStatus: string,
  targetStatus: unknown
): boolean {
  if (targetStatus !== 'queued' && targetStatus !== 'backlog') return false
  return TERMINAL_STATUSES.has(currentStatus)
}

export interface TaskToolsDeps {
  listTasks: (status?: string) => SprintTask[]
  getTask: (id: string) => SprintTask | null
  createTaskWithValidation: (
    input: CreateTaskInput,
    deps: CreateTaskWithValidationDeps,
    opts?: CreateTaskWithValidationOpts
  ) => SprintTask
  updateTask: (id: string, patch: Record<string, unknown>) => SprintTask | null
  cancelTask: (id: string, reason?: string) => Promise<SprintTask | null> | SprintTask | null
  /** Mirrors the data-layer signature: (taskId, limit?). Offset is applied in the tool handler via slice. */
  getTaskChanges: (id: string, limit?: number) => TaskChange[]
  logger: CreateTaskWithValidationDeps['logger']
}

function json(value: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
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
    async (rawArgs) => {
      const args = parseToolArgs(TaskListSchema, rawArgs)
      const rows = deps.listTasks(args.status)
      return json(filterInMemory(rows, args))
    }
  )

  server.tool('tasks.get', 'Fetch one task by id.', TaskIdSchema.shape, async (rawArgs) => {
    const { id } = parseToolArgs(TaskIdSchema, rawArgs)
    const row = deps.getTask(id)
    if (!row) throw new McpDomainError(`Task ${id} not found`, McpErrorCode.NotFound, { id })
    return json(row)
  })

  server.tool(
    'tasks.history',
    'Fetch the audit trail (field-level change log) for a task.',
    TaskHistorySchema.shape,
    async (rawArgs) => {
      const { id, limit, offset } = parseToolArgs(TaskHistorySchema, rawArgs)
      const task = deps.getTask(id)
      if (!task) throw new McpDomainError(`Task ${id} not found`, McpErrorCode.NotFound, { id })
      const effectiveLimit = (limit ?? 100) + (offset ?? 0)
      const rows = deps.getTaskChanges(id, effectiveLimit)
      return json(rows.slice(offset ?? 0))
    }
  )

  registerTaskWriteTools(server, deps)
}

function registerTaskWriteTools(server: McpServer, deps: TaskToolsDeps): void {
  server.tool(
    'tasks.create',
    'Create a new sprint task. Runs the same validation as the in-app Task Workbench.',
    TaskCreateSchema.shape,
    async (rawArgs) => {
      const parsed = parseToolArgs(TaskCreateSchema, rawArgs)
      const { skipReadinessCheck, ...createInput } = parsed
      const delegateDeps = { logger: deps.logger }
      const row =
        skipReadinessCheck === undefined
          ? deps.createTaskWithValidation(createInput as CreateTaskInput, delegateDeps)
          : deps.createTaskWithValidation(createInput as CreateTaskInput, delegateDeps, {
              skipReadinessCheck
            })
      return json(row)
    }
  )

  server.tool(
    'tasks.update',
    'Update an existing task. Status transitions are validated; forbidden fields are stripped.',
    TaskUpdateSchema.shape,
    async (rawArgs) => {
      const { id, patch } = parseToolArgs(TaskUpdateSchema, rawArgs)
      const effectivePatch: Record<string, unknown> = { ...patch }
      if ('status' in effectivePatch) {
        const current = deps.getTask(id)
        if (current && isRevivingTerminalTask(current.status, effectivePatch.status)) {
          Object.assign(effectivePatch, TERMINAL_STATE_RESET_PATCH)
        }
      }
      const row = deps.updateTask(id, effectivePatch)
      if (!row) throw new McpDomainError(`Task ${id} not found`, McpErrorCode.NotFound, { id })
      return json(row)
    }
  )

  server.tool(
    'tasks.cancel',
    'Cancel a task. Runs through the terminal-status path so dependents are re-evaluated.',
    TaskCancelSchema.shape,
    async (rawArgs) => {
      const { id, reason } = parseToolArgs(TaskCancelSchema, rawArgs)
      const row = await deps.cancelTask(id, reason)
      if (!row) throw new McpDomainError(`Task ${id} not found`, McpErrorCode.NotFound, { id })
      return json(row)
    }
  )
}
