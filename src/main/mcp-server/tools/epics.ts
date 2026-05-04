import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  EpicCycleError,
  EpicNotFoundError,
  type EpicGroupService
} from '../../services/epic-group-service'
import { McpDomainError, McpErrorCode, parseToolArgs } from '../errors'
import {
  EpicAddTaskSchema,
  EpicIdSchema,
  EpicListSchema,
  EpicRemoveTaskSchema,
  EpicSetDependenciesSchema,
  EpicUpdateSchema,
  EpicWriteFieldsSchema
} from '../schemas'
import { jsonContent, safeToolResponse } from './response'

export interface EpicToolsDeps {
  epicService: EpicGroupService
}

export function registerEpicTools(server: McpServer, deps: EpicToolsDeps): void {
  const svc = deps.epicService

  server.registerTool(
    'epics.list',
    {
      description:
        'List epics (task groups). Optionally filter by status or search string on name.',
      inputSchema: EpicListSchema
    },
    async (rawArgs) =>
      safeToolResponse(
        async () => {
          const args = parseToolArgs(EpicListSchema, rawArgs)
          let rows = svc.listEpics()
          if (args.status) rows = rows.filter((e) => e.status === args.status)
          if (args.search) {
            const q = args.search.toLowerCase()
            rows = rows.filter((e) => e.name.toLowerCase().includes(q))
          }
          return jsonContent(rows)
        },
        { schema: EpicListSchema }
      )
  )

  server.registerTool(
    'epics.get',
    {
      description:
        "Fetch one epic by id. Pass includeTasks=true to also return the epic's task list.",
      inputSchema: EpicIdSchema
    },
    async (rawArgs) =>
      safeToolResponse(
        async () => {
          const { id, includeTasks } = parseToolArgs(EpicIdSchema, rawArgs)
          const epic = svc.getEpic(id)
          if (!epic) throw new McpDomainError(`Epic ${id} not found`, McpErrorCode.NotFound, { id })
          if (includeTasks) {
            return jsonContent({ ...epic, tasks: svc.getEpicTasks(id) })
          }
          return jsonContent(epic)
        },
        { schema: EpicIdSchema }
      )
  )

  server.registerTool(
    'epics.create',
    {
      description: 'Create a new epic (task group).',
      inputSchema: EpicWriteFieldsSchema
    },
    async (rawArgs) =>
      safeToolResponse(
        async () => {
          const input = parseToolArgs(EpicWriteFieldsSchema, rawArgs)
          // Pass `goal` through as-is: `null` clears, `undefined` omits.
          // The service + data layer honor that distinction.
          return jsonContent(svc.createEpic(input))
        },
        { schema: EpicWriteFieldsSchema }
      )
  )

  server.registerTool(
    'epics.update',
    {
      description: "Update an epic's fields (name, icon, accent_color, goal, status).",
      inputSchema: EpicUpdateSchema
    },
    async (rawArgs) =>
      safeToolResponse(
        async () => {
          const { id, patch } = parseToolArgs(EpicUpdateSchema, rawArgs)
          try {
            // Pass `patch` through unchanged so `goal: null` reaches the
            // service as "clear the goal" and `goal: undefined` / absent
            // means "leave it alone". Collapsing null→undefined here would
            // silently strip the clear-goal intent.
            return jsonContent(svc.updateEpic(id, patch))
          } catch (err) {
            throw rewrapEpicServiceError(err)
          }
        },
        { schema: EpicUpdateSchema }
      )
  )

  server.registerTool(
    'epics.delete',
    {
      description: 'Delete an epic. Its tasks remain but are detached.',
      inputSchema: EpicIdSchema
    },
    async (rawArgs) =>
      safeToolResponse(
        async () => {
          const { id } = parseToolArgs(EpicIdSchema, rawArgs)
          svc.deleteEpic(id)
          return jsonContent({ deleted: true, id })
        },
        { schema: EpicIdSchema }
      )
  )

  server.registerTool(
    'epics.addTask',
    {
      description: 'Attach an existing task to an epic.',
      inputSchema: EpicAddTaskSchema
    },
    async (rawArgs) =>
      safeToolResponse(
        async () => {
          const { epicId, taskId } = parseToolArgs(EpicAddTaskSchema, rawArgs)
          svc.addTask(epicId, taskId)
          return jsonContent({ ok: true, epicId, taskId })
        },
        { schema: EpicAddTaskSchema }
      )
  )

  server.registerTool(
    'epics.removeTask',
    {
      description: 'Detach a task from its epic.',
      inputSchema: EpicRemoveTaskSchema
    },
    async (rawArgs) =>
      safeToolResponse(
        async () => {
          const { taskId } = parseToolArgs(EpicRemoveTaskSchema, rawArgs)
          svc.removeTask(taskId)
          return jsonContent({ ok: true, taskId })
        },
        { schema: EpicRemoveTaskSchema }
      )
  )

  server.registerTool(
    'epics.setDependencies',
    {
      description: "Replace an epic's upstream dependencies. Rejects cycles atomically.",
      inputSchema: EpicSetDependenciesSchema
    },
    async (rawArgs) =>
      safeToolResponse(
        async () => {
          const { id, dependencies } = parseToolArgs(EpicSetDependenciesSchema, rawArgs)
          try {
            return jsonContent(svc.setDependencies(id, dependencies))
          } catch (err) {
            throw rewrapEpicServiceError(err)
          }
        },
        { schema: EpicSetDependenciesSchema }
      )
  )

  const BulkQueueSchema = z.object({ id: z.string().describe('Epic ID') })

  server.registerTool(
    'epics.bulkQueueTasks',
    {
      description:
        'Queue all backlog tasks in an epic that have a valid spec. Returns counts of queued and skipped tasks.',
      inputSchema: BulkQueueSchema
    },
    async (rawArgs) =>
      safeToolResponse(async () => {
        const { id } = parseToolArgs(BulkQueueSchema, rawArgs)
        const epic = svc.getEpic(id)
        if (!epic) throw new McpDomainError(`Epic ${id} not found`, McpErrorCode.NotFound, { id })
        const queued = svc.queueAllTasks(id)
        return jsonContent({ queued })
      })
  )
}

/**
 * Translate typed epic-service errors into MCP domain errors so clients see
 * `McpErrorCode.NotFound` / `McpErrorCode.Cycle` instead of a generic
 * internal error. Unknown throws propagate unchanged.
 */
function rewrapEpicServiceError(err: unknown): unknown {
  if (err instanceof EpicNotFoundError) {
    return new McpDomainError(err.message, McpErrorCode.NotFound, { id: err.epicId })
  }
  if (err instanceof EpicCycleError) {
    return new McpDomainError(err.message, McpErrorCode.Cycle, { id: err.epicId })
  }
  return err
}
