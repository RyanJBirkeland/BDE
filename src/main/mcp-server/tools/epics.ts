import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { EpicGroupService } from '../../services/epic-group-service'
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
import { jsonContent } from './response'

export interface EpicToolsDeps {
  epicService: EpicGroupService
}

export function registerEpicTools(server: McpServer, deps: EpicToolsDeps): void {
  const svc = deps.epicService

  server.tool(
    'epics.list',
    'List epics (task groups). Optionally filter by status or search string on name.',
    EpicListSchema.shape,
    async (rawArgs) => {
      const args = parseToolArgs(EpicListSchema, rawArgs)
      let rows = svc.listEpics()
      if (args.status) rows = rows.filter((e) => e.status === args.status)
      if (args.search) {
        const q = args.search.toLowerCase()
        rows = rows.filter((e) => e.name.toLowerCase().includes(q))
      }
      return jsonContent(rows)
    }
  )

  server.tool(
    'epics.get',
    "Fetch one epic by id. Pass includeTasks=true to also return the epic's task list.",
    EpicIdSchema.shape,
    async (rawArgs) => {
      const { id, includeTasks } = parseToolArgs(EpicIdSchema, rawArgs)
      const epic = svc.getEpic(id)
      if (!epic) throw new McpDomainError(`Epic ${id} not found`, McpErrorCode.NotFound, { id })
      if (includeTasks) {
        return jsonContent({ ...epic, tasks: svc.getEpicTasks(id) })
      }
      return jsonContent(epic)
    }
  )

  server.tool(
    'epics.create',
    'Create a new epic (task group).',
    EpicWriteFieldsSchema.shape,
    async (rawArgs) => {
      const { goal, ...rest } = parseToolArgs(EpicWriteFieldsSchema, rawArgs)
      return jsonContent(svc.createEpic({ ...rest, goal: goal ?? undefined }))
    }
  )

  server.tool(
    'epics.update',
    "Update an epic's fields (name, icon, accent_color, goal, status).",
    EpicUpdateSchema.shape,
    async (rawArgs) => {
      const { id, patch } = parseToolArgs(EpicUpdateSchema, rawArgs)
      const { goal, ...rest } = patch
      return jsonContent(svc.updateEpic(id, { ...rest, goal: goal ?? undefined }))
    }
  )

  server.tool(
    'epics.delete',
    'Delete an epic. Its tasks remain but are detached.',
    EpicIdSchema.shape,
    async (rawArgs) => {
      const { id } = parseToolArgs(EpicIdSchema, rawArgs)
      svc.deleteEpic(id)
      return jsonContent({ deleted: true, id })
    }
  )

  server.tool(
    'epics.addTask',
    'Attach an existing task to an epic.',
    EpicAddTaskSchema.shape,
    async (rawArgs) => {
      const { epicId, taskId } = parseToolArgs(EpicAddTaskSchema, rawArgs)
      svc.addTask(epicId, taskId)
      return jsonContent({ ok: true, epicId, taskId })
    }
  )

  server.tool(
    'epics.removeTask',
    'Detach a task from its epic.',
    EpicRemoveTaskSchema.shape,
    async (rawArgs) => {
      const { taskId } = parseToolArgs(EpicRemoveTaskSchema, rawArgs)
      svc.removeTask(taskId)
      return jsonContent({ ok: true, taskId })
    }
  )

  server.tool(
    'epics.setDependencies',
    "Replace an epic's upstream dependencies. Rejects cycles atomically.",
    EpicSetDependenciesSchema.shape,
    async (rawArgs) => {
      const { id, dependencies } = parseToolArgs(EpicSetDependenciesSchema, rawArgs)
      try {
        const updated = svc.setDependencies(id, dependencies)
        return jsonContent(updated)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (/not found/i.test(message)) {
          throw new McpDomainError(message, McpErrorCode.NotFound, { id })
        }
        throw err
      }
    }
  )
}
