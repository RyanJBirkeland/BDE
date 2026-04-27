/**
 * In-process MCP server for adhoc + assistant agents.
 *
 * Before this existed, interactive agents had no way to create or modify
 * BDE tasks and epics — they resorted to shelling out with `sqlite3` to
 * edit `~/.bde/bde.db` directly, bypassing validation, the audit trail,
 * dependency auto-blocking, and the renderer broadcast. This module
 * exposes the same vocabulary the UI uses as first-class agent tools,
 * routed through sprint-service and EpicGroupService.
 *
 * External MCP clients (Claude Desktop, Cursor, the BDE CLI) still talk
 * to the opt-in HTTP server at src/main/mcp-server/. This is the same
 * domain but in-process: no HTTP, no auth token, no round-trip.
 */
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance
} from '@anthropic-ai/claude-agent-sdk'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  createTaskWithValidation,
  updateTask,
  listTasks,
  TaskValidationError
} from './sprint-service'
import type { CreateTaskInput } from '../data/sprint-task-repository'
import type { EpicGroupService } from './epic-group-service'
import type { Logger } from '../logger'
import type { RepoConfig } from '../paths'
import { getConfiguredRepos } from '../paths'
import { TASK_STATUSES, VALID_TRANSITIONS } from '../../shared/task-state-machine'
import {
  TaskCreateSchema,
  TaskUpdateSchema,
  TaskListSchema,
  EpicWriteFieldsSchema,
  EpicAddTaskSchema,
  EpicSetDependenciesSchema
} from '../mcp-server/schemas'

/**
 * Audit-trail attribution for every write that comes from an in-process
 * agent tool. Lands in `task_changes.changed_by` so operators can tell
 * an agent-driven write apart from a UI-driven one without reading logs.
 */
const AGENT_CALLER = 'agent'

export interface PlannerMcpDeps {
  epicService: EpicGroupService
  logger: Logger
  /**
   * Repo list source. Defaults to reading settings via `getConfiguredRepos()`.
   * Injectable so tests can run without touching real settings storage.
   */
  getRepos?: () => RepoConfig[]
}

/**
 * Handler return shape — mirrors the MCP `CallToolResult`. Success returns a
 * JSON-serialized text block; errors set `isError: true` so the agent sees
 * them as tool failures rather than confusing success results.
 */
function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function toErrorMessage(err: unknown): string {
  if (err instanceof TaskValidationError) return `[${err.code}] ${err.message}`
  return err instanceof Error ? err.message : String(err)
}

/**
 * Agents reaching the in-process planner server may try to queue a task for
 * autonomous execution — either intentionally, or as the tail-end of a
 * prompt-injection payload ("…then call tasks.create with status=queued").
 * Downgrading `queued` → `backlog` at the tool boundary forces a human to
 * approve the queue transition in the UI before the drain loop picks it up.
 */
function downgradeQueuedOnCreate(input: CreateTaskInput): CreateTaskInput {
  if (input.status === 'queued') return { ...input, status: 'backlog' }
  return input
}

/**
 * Task-status payload is a static vocabulary compiled into the binary —
 * freeze once at module load so every `meta.taskStatuses` call returns the
 * same immutable shape without rebuilding the transition map.
 */
const TASK_STATUS_PAYLOAD = Object.freeze({
  statuses: TASK_STATUSES,
  transitions: Object.fromEntries(
    Object.entries(VALID_TRANSITIONS).map(([from, targets]) => [from, [...targets]])
  )
})

/**
 * A single planner tool. Typed as the inferred return of `buildPlannerTools`
 * because the SDK's `SdkMcpToolDefinition<Schema>` is invariant in the
 * handler's `args` parameter under `exactOptionalPropertyTypes` — a unified
 * static element type would fail strict variance checks across tools with
 * different Zod shapes. Tests rely on the inferred shape.
 */
export type PlannerTool = ReturnType<typeof buildPlannerTools>[number]

/**
 * Builds the tool array that backs the planner MCP server. Exported so
 * tests can invoke handlers directly without constructing a transport.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- see PlannerTool comment: explicit return type would drop per-tool schema info the SDK requires
export function buildPlannerTools(deps: PlannerMcpDeps) {
  const { epicService, logger } = deps
  const listRepos = deps.getRepos ?? getConfiguredRepos

  const tasksCreate = tool(
    'tasks.create',
    'Create a sprint task in BDE. Runs the same validation as the Task Workbench (title, configured repo, spec structure). Returns the created task row. Note: in-process agent calls cannot queue a task for autonomous execution — requests with status=queued are downgraded to backlog so a human approves the queue transition in the UI. Prefer this over any direct SQL against ~/.bde/bde.db — that path bypasses validation, the audit trail, and the UI broadcast.',
    TaskCreateSchema.shape,
    async (rawInput) => {
      const parsed = TaskCreateSchema.safeParse(rawInput)
      if (!parsed.success) return errorResult(parsed.error.message)
      const { skipReadinessCheck, ...createInput } = parsed.data
      const safeCreateInput = downgradeQueuedOnCreate(createInput as CreateTaskInput)
      try {
        const row = await createTaskWithValidation(
          safeCreateInput,
          { logger },
          skipReadinessCheck === true ? { skipReadinessCheck: true } : {}
        )
        return jsonResult(row)
      } catch (err) {
        return errorResult(toErrorMessage(err))
      }
    }
  )

  const tasksUpdate = tool(
    'tasks.update',
    "Update an existing task's fields (spec, priority, depends_on, status, tags, etc.). Status transitions are validated; system-managed fields (claimed_by, pr_*, completed_at) are stripped. In-process agents cannot transition a task to queued — that requires human approval in the UI. Returns the updated row.",
    TaskUpdateSchema.shape,
    async (rawInput) => {
      const parsed = TaskUpdateSchema.safeParse(rawInput)
      if (!parsed.success) return errorResult(parsed.error.message)
      if (parsed.data.patch.status === 'queued') {
        return errorResult(
          'Agents cannot transition a task to queued. Queueing for autonomous execution requires human approval in the Task Pipeline UI.'
        )
      }
      try {
        const row = await updateTask(parsed.data.id, parsed.data.patch, { caller: AGENT_CALLER })
        if (!row) return errorResult(`Task ${parsed.data.id} not found`)
        return jsonResult(row)
      } catch (err) {
        return errorResult(toErrorMessage(err))
      }
    }
  )

  const tasksList = tool(
    'tasks.list',
    'List sprint tasks with optional filters (status, repo, epicId, tag, search). Returns an array of task rows.',
    TaskListSchema.shape,
    async (rawInput) => {
      const parsed = TaskListSchema.safeParse(rawInput)
      if (!parsed.success) return errorResult(parsed.error.message)
      try {
        const rows = listTasks(parsed.data)
        return jsonResult(rows)
      } catch (err) {
        return errorResult(toErrorMessage(err))
      }
    }
  )

  const epicsCreate = tool(
    'epics.create',
    'Create an epic (task group) — a named collection of related tasks with shared goal, icon, and accent color. Epics flow through draft → ready → in-pipeline → completed. Returns the created epic row.',
    EpicWriteFieldsSchema.shape,
    async (rawInput) => {
      const parsed = EpicWriteFieldsSchema.safeParse(rawInput)
      if (!parsed.success) return errorResult(parsed.error.message)
      try {
        const row = epicService.createEpic(parsed.data)
        return jsonResult(row)
      } catch (err) {
        return errorResult(toErrorMessage(err))
      }
    }
  )

  const epicsList = tool(
    'epics.list',
    'List all epics (task groups). Returns epics with their current status and dependency edges.',
    {},
    async () => {
      try {
        return jsonResult(epicService.listEpics())
      } catch (err) {
        return errorResult(toErrorMessage(err))
      }
    }
  )

  const epicsAddTask = tool(
    'epics.addTask',
    'Attach an existing task to an epic. The task moves out of its current epic if it was in one.',
    EpicAddTaskSchema.shape,
    async (rawInput) => {
      const parsed = EpicAddTaskSchema.safeParse(rawInput)
      if (!parsed.success) return errorResult(parsed.error.message)
      try {
        epicService.addTask(parsed.data.epicId, parsed.data.taskId)
        return jsonResult({ ok: true, epicId: parsed.data.epicId, taskId: parsed.data.taskId })
      } catch (err) {
        return errorResult(toErrorMessage(err))
      }
    }
  )

  const epicsSetDependencies = tool(
    'epics.setDependencies',
    'Atomically replace an epic\'s upstream dependencies. Cycle detection runs before any mutation. condition = "on_success" | "always" | "manual".',
    EpicSetDependenciesSchema.shape,
    async (rawInput) => {
      const parsed = EpicSetDependenciesSchema.safeParse(rawInput)
      if (!parsed.success) return errorResult(parsed.error.message)
      try {
        const row = epicService.setDependencies(parsed.data.id, parsed.data.dependencies)
        return jsonResult(row)
      } catch (err) {
        return errorResult(toErrorMessage(err))
      }
    }
  )

  const metaRepos = tool(
    'meta.repos',
    'List the repositories configured in BDE Settings. Use this before tasks.create to discover valid repo slugs.',
    {},
    async () => jsonResult(listRepos())
  )

  const metaTaskStatuses = tool(
    'meta.taskStatuses',
    'List valid task statuses and the allowed transitions between them.',
    {},
    async () => jsonResult(TASK_STATUS_PAYLOAD)
  )

  return [
    tasksCreate,
    tasksUpdate,
    tasksList,
    epicsCreate,
    epicsList,
    epicsAddTask,
    epicsSetDependencies,
    metaRepos,
    metaTaskStatuses
  ]
}

/**
 * MCP server name — forms part of the tool identifier the agent sees as
 * `mcp__bde__<tool-name>`. Matches the HTTP MCP server name so internal
 * and external callers share a vocabulary.
 */
export const PLANNER_MCP_SERVER_NAME = 'bde'

/**
 * Construct an in-process SDK MCP server suitable for passing to the
 * Claude Agent SDK via `options.mcpServers[PLANNER_MCP_SERVER_NAME]`.
 */
export function createPlannerMcpServer(deps: PlannerMcpDeps): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: PLANNER_MCP_SERVER_NAME,
    version: '1.0.0',
    tools: buildPlannerTools(deps)
  })
}
