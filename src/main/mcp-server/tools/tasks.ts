import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SprintTask } from '../../../shared/types'
import type { TaskChange } from '../../data/task-changes'
import type { CreateTaskWithValidationDeps } from '../../services/sprint-service'
import type { CreateTaskInput } from '../../data/sprint-task-repository'
import { McpDomainError, McpErrorCode } from '../errors'
import {
  TaskCancelSchema,
  TaskCreateSchema,
  TaskHistorySchema,
  TaskIdSchema,
  TaskListSchema,
  TaskUpdateSchema
} from '../schemas'

// T11 will register write tools using these schemas.
void [TaskCreateSchema, TaskUpdateSchema, TaskCancelSchema]

export interface TaskToolsDeps {
  listTasks: (status?: string) => SprintTask[]
  getTask: (id: string) => SprintTask | null
  createTaskWithValidation: (input: CreateTaskInput, deps: CreateTaskWithValidationDeps) => SprintTask
  updateTask: (id: string, patch: Record<string, unknown>) => SprintTask | null
  cancelTask: (id: string, reason?: string) => SprintTask | null
  /** Mirrors the data-layer signature: (taskId, limit?). Offset is applied in the tool handler via slice. */
  getTaskChanges: (id: string, limit?: number) => TaskChange[]
  logger: CreateTaskWithValidationDeps['logger']
}

function json(value: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
}

function filterInMemory(tasks: SprintTask[], args: ReturnType<typeof TaskListSchema.parse>): SprintTask[] {
  let out = tasks
  if (args.repo) out = out.filter((t) => t.repo === args.repo)
  if (args.epicId) out = out.filter((t) => t.group_id === args.epicId)
  if (args.tag) out = out.filter((t) => Array.isArray(t.tags) && t.tags.includes(args.tag!))
  if (args.search) {
    const q = args.search.toLowerCase()
    out = out.filter(
      (t) => t.title.toLowerCase().includes(q) || (t.spec ? t.spec.toLowerCase().includes(q) : false)
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
      const args = TaskListSchema.parse(rawArgs)
      const rows = deps.listTasks(args.status)
      return json(filterInMemory(rows, args))
    }
  )

  server.tool(
    'tasks.get',
    'Fetch one task by id.',
    TaskIdSchema.shape,
    async (rawArgs) => {
      const { id } = TaskIdSchema.parse(rawArgs)
      const row = deps.getTask(id)
      if (!row) throw new McpDomainError(`Task ${id} not found`, McpErrorCode.NotFound, { id })
      return json(row)
    }
  )

  server.tool(
    'tasks.history',
    'Fetch the audit trail (field-level change log) for a task.',
    TaskHistorySchema.shape,
    async (rawArgs) => {
      const { id, limit, offset } = TaskHistorySchema.parse(rawArgs)
      const task = deps.getTask(id)
      if (!task) throw new McpDomainError(`Task ${id} not found`, McpErrorCode.NotFound, { id })
      const effectiveLimit = (limit ?? 100) + (offset ?? 0)
      const rows = deps.getTaskChanges(id, effectiveLimit)
      return json(rows.slice(offset ?? 0))
    }
  )

  // tasks.create, tasks.update, tasks.cancel registered in Task 11.
  registerTaskWriteTools(server, deps)
}

// Placeholder so the file typechecks between task 10 and task 11.
function registerTaskWriteTools(_server: McpServer, _deps: TaskToolsDeps): void {
  // Implemented in Task 11.
}
