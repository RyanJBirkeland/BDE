import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { EpicGroupService } from '../../services/epic-group-service'
import type { EpicDependency } from '../../../shared/types'
import { McpDomainError, McpErrorCode } from '../errors'
import {
  EpicAddTaskSchema,
  EpicIdSchema,
  EpicListSchema,
  EpicRemoveTaskSchema,
  EpicSetDependenciesSchema,
  EpicUpdateSchema,
  EpicWriteFieldsSchema
} from '../schemas'

export interface EpicToolsDeps {
  epicService: EpicGroupService
}

function json(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
}

export function registerEpicTools(server: McpServer, deps: EpicToolsDeps): void {
  const svc = deps.epicService

  server.tool(
    'epics.list',
    'List epics (task groups). Optionally filter by status or search string on name.',
    EpicListSchema.shape,
    async (rawArgs) => {
      const args = EpicListSchema.parse(rawArgs)
      let rows = svc.listEpics()
      if (args.status) rows = rows.filter((e) => e.status === args.status)
      if (args.search) {
        const q = args.search.toLowerCase()
        rows = rows.filter((e) => e.name.toLowerCase().includes(q))
      }
      return json(rows)
    }
  )

  server.tool(
    'epics.get',
    "Fetch one epic by id. Pass includeTasks=true to also return the epic's task list.",
    EpicIdSchema.shape,
    async (rawArgs) => {
      const { id, includeTasks } = EpicIdSchema.parse(rawArgs)
      const epic = svc.getEpic(id)
      if (!epic) throw new McpDomainError(`Epic ${id} not found`, McpErrorCode.NotFound, { id })
      if (includeTasks) {
        return json({ ...epic, tasks: svc.getEpicTasks(id) })
      }
      return json(epic)
    }
  )

  server.tool(
    'epics.create',
    'Create a new epic (task group).',
    EpicWriteFieldsSchema.shape,
    async (rawArgs) => {
      const { goal, ...rest } = EpicWriteFieldsSchema.parse(rawArgs)
      return json(svc.createEpic({ ...rest, goal: goal ?? undefined }))
    }
  )

  server.tool(
    'epics.update',
    "Update an epic's fields (name, icon, accent_color, goal, status).",
    EpicUpdateSchema.shape,
    async (rawArgs) => {
      const { id, patch } = EpicUpdateSchema.parse(rawArgs)
      const { goal, ...rest } = patch
      return json(svc.updateEpic(id, { ...rest, goal: goal ?? undefined }))
    }
  )

  server.tool(
    'epics.delete',
    'Delete an epic. Its tasks remain but are detached.',
    EpicIdSchema.shape,
    async (rawArgs) => {
      const { id } = EpicIdSchema.parse(rawArgs)
      svc.deleteEpic(id)
      return json({ deleted: true, id })
    }
  )

  server.tool(
    'epics.addTask',
    'Attach an existing task to an epic.',
    EpicAddTaskSchema.shape,
    async (rawArgs) => {
      const { epicId, taskId } = EpicAddTaskSchema.parse(rawArgs)
      svc.addTask(epicId, taskId)
      return json({ ok: true, epicId, taskId })
    }
  )

  server.tool(
    'epics.removeTask',
    'Detach a task from its epic.',
    EpicRemoveTaskSchema.shape,
    async (rawArgs) => {
      const { taskId } = EpicRemoveTaskSchema.parse(rawArgs)
      svc.removeTask(taskId)
      return json({ ok: true, taskId })
    }
  )

  server.tool(
    'epics.setDependencies',
    "Replace an epic's upstream dependencies. Rejects cycles atomically.",
    EpicSetDependenciesSchema.shape,
    async (rawArgs) => {
      const { id, dependencies } = EpicSetDependenciesSchema.parse(rawArgs)
      const epic = svc.getEpic(id)
      if (!epic) throw new McpDomainError(`Epic ${id} not found`, McpErrorCode.NotFound, { id })

      const current: EpicDependency[] = epic.depends_on ?? []
      const currentIds = new Set(current.map((d) => d.id))
      const nextIds = new Set(dependencies.map((d) => d.id))

      for (const dep of current) {
        if (!nextIds.has(dep.id)) svc.removeDependency(id, dep.id)
      }
      for (const dep of dependencies) {
        if (!currentIds.has(dep.id)) {
          svc.addDependency(id, dep)
        } else {
          svc.updateDependencyCondition(id, dep.id, dep.condition)
        }
      }

      const updated = svc.getEpic(id)
      return json(updated)
    }
  )
}
