import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createMcpServer, type McpServerHandle } from './index'
import {
  createEpicGroupService,
  EpicCycleError,
  type EpicGroupService
} from '../services/epic-group-service'
import {
  cancelTask,
  createTaskWithValidation,
  updateTask,
  deleteTask,
  TaskValidationError
} from '../services/sprint-service'
import { getTaskChanges } from '../data/task-changes'
import { readOrCreateToken } from './token-store'
import { createLogger } from '../logger'
import { seedBdeRepo } from './test-setup'
import type { SprintTask, TaskGroup } from '../../shared/types/task-types'

vi.mock('../broadcast', () => ({ broadcast: vi.fn() }))

/**
 * Fields an external caller (MCP or IPC) can set on a task create. This is
 * the explicit allow-list that drives parity comparison — if either path
 * drops, mistranslates, or silently overrides any of these, the test fails.
 *
 * The list is derived from `TaskWriteFieldsSchema` in `schemas.ts`. When a
 * new write field is added there, add it here in the same PR.
 *
 * Deliberately excluded (system-managed — allowed to differ between two
 * creations even with identical input):
 *   id, created_at, updated_at, claimed_by, started_at, completed_at,
 *   agent_run_id, retry_count, fast_fail_count, failure_reason,
 *   next_eligible_at, session_id, partial_diff, worktree_path,
 *   pr_* (number/status/url/mergeable_state), rebase_base_sha,
 *   rebased_at, duration_ms, needs_review, model, max_cost_usd,
 *   retry_context, revision_feedback, review_diff_snapshot, sprint_id.
 */
const PARITY_FIELDS: readonly (keyof SprintTask)[] = [
  'title',
  'repo',
  'status',
  'prompt',
  'spec',
  'spec_type',
  'notes',
  'priority',
  'tags',
  'depends_on',
  'playground_enabled',
  'max_runtime_ms',
  'template_name',
  'cross_repo_contract',
  'group_id'
] as const

function projectParity(task: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(PARITY_FIELDS.map((field) => [field, task[field as string]]))
}

function changeFields(changes: ReturnType<typeof getTaskChanges>) {
  return changes.map((c) => ({ field: c.field, old: c.old_value, new: c.new_value }))
}

/**
 * Same state split as `mcp-server.integration.test.ts` (F.I.R.S.T.
 * Independent): `beforeAll` owns the server + MCP client; `beforeEach`
 * resets per-test created-task tracking so one test's rows can never
 * leak into another's cleanup scope.
 */

let serverHandle: McpServerHandle
let mcpClient: Client
let serverPort: number
let epicService: EpicGroupService

let createdTaskIds: string[] = []
let createdEpicIds: string[] = []

beforeAll(async () => {
  seedBdeRepo()
  epicService = createEpicGroupService()
  serverHandle = createMcpServer({ epicService, onStatusTerminal: () => {} }, { port: 0 })
  serverPort = await serverHandle.start()
  const { token } = await readOrCreateToken()

  mcpClient = new Client({ name: 'parity', version: '0.0.0' }, { capabilities: {} })
  await mcpClient.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${serverPort}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    })
  )
}, 30_000)

afterAll(async () => {
  await mcpClient?.close()
  await serverHandle?.stop()
})

beforeEach(() => {
  createdTaskIds = []
  createdEpicIds = []
})

afterEach(() => {
  for (const id of createdTaskIds) {
    try {
      deleteTask(id)
    } catch {
      // best-effort cleanup — row may already be gone
    }
  }
  for (const id of createdEpicIds) {
    try {
      epicService.deleteEpic(id)
    } catch {
      // best-effort cleanup — epic may already be gone
    }
  }
})

/**
 * Unwrap an MCP tool response's single text-content entry. The SDK wraps
 * JSON payloads in `{ content: [{ type: 'text', text: string }] }`; tests
 * need the parsed object back.
 */
function readMcpJson<T = unknown>(result: { content: unknown[] }): T {
  const first = result.content[0] as { type: 'text'; text: string }
  return JSON.parse(first.text) as T
}

const EPIC_PARITY_FIELDS = ['name', 'icon', 'accent_color', 'goal', 'status'] as const

function projectEpicParity(epic: TaskGroup): Record<string, unknown> {
  return Object.fromEntries(EPIC_PARITY_FIELDS.map((field) => [field, epic[field]]))
}

describe('IPC vs MCP parity', () => {
  it('creates identical tasks and produces identical audit trails', async () => {
    const logger = createLogger('parity-test')
    const input = { title: 'parity-test', repo: 'bde', status: 'backlog' as const, priority: 3 }

    const ipcTask = await createTaskWithValidation(input, { logger })
    createdTaskIds.push(ipcTask.id)

    const mcpResult = await mcpClient.callTool({ name: 'tasks.create', arguments: input })
    const mcpTask = readMcpJson<SprintTask>(mcpResult as { content: unknown[] })
    createdTaskIds.push(mcpTask.id)

    expect(projectParity(mcpTask as unknown as Record<string, unknown>)).toEqual(
      projectParity(ipcTask as unknown as Record<string, unknown>)
    )

    await mcpClient.callTool({
      name: 'tasks.update',
      arguments: { id: mcpTask.id, patch: { priority: 7 } }
    })
    await updateTask(ipcTask.id, { priority: 7 })

    const ipcHistory = changeFields(getTaskChanges(ipcTask.id))
    const mcpHistory = changeFields(getTaskChanges(mcpTask.id))
    expect(mcpHistory).toEqual(ipcHistory)
  })

  it('cancels tasks identically and records the same terminal audit rows', async () => {
    // `tasks.cancel` (MCP) and `cancelTask()` (service / IPC) must produce the
    // same terminal state + audit trail. Earlier versions only had the happy
    // path for create/update covered, so a drift in how cancel handles the
    // optional reason or the state-machine transition could ship unnoticed.
    const logger = createLogger('parity-test')
    const baseInput = {
      title: 'parity-cancel',
      repo: 'bde',
      status: 'backlog' as const,
      priority: 2
    }

    const ipcTask = await createTaskWithValidation(baseInput, { logger })
    createdTaskIds.push(ipcTask.id)
    const mcpCreate = await mcpClient.callTool({ name: 'tasks.create', arguments: baseInput })
    const mcpTask = readMcpJson<SprintTask>(mcpCreate as { content: unknown[] })
    createdTaskIds.push(mcpTask.id)

    const reason = 'parity cancel reason'
    // cancelTask now returns CancelTaskResult — result.row is the cancelled task
    const cancelResult = await cancelTask(ipcTask.id, { reason }, { onStatusTerminal: () => {}, logger })
    expect(cancelResult.row).not.toBeNull()
    await mcpClient.callTool({
      name: 'tasks.cancel',
      arguments: { id: mcpTask.id, reason }
    })

    const ipcAfter = await mcpClient.callTool({
      name: 'tasks.get',
      arguments: { id: ipcTask.id }
    })
    const mcpAfter = await mcpClient.callTool({
      name: 'tasks.get',
      arguments: { id: mcpTask.id }
    })
    const ipcRow = readMcpJson<SprintTask>(ipcAfter as { content: unknown[] })
    const mcpRow = readMcpJson<SprintTask>(mcpAfter as { content: unknown[] })

    expect(ipcRow.status).toBe('cancelled')
    expect(mcpRow.status).toBe('cancelled')
    expect(ipcRow.notes).toBe(reason)
    expect(mcpRow.notes).toBe(reason)

    expect(changeFields(getTaskChanges(mcpTask.id))).toEqual(
      changeFields(getTaskChanges(ipcTask.id))
    )
  })

  it('rejects unconfigured repos identically on both create paths', async () => {
    // `repo` is validated by `createTaskWithValidation`'s configured-repo
    // check on both paths. A repo slug that isn't listed in Settings →
    // Repositories must be refused — otherwise tasks would land in a state
    // that later crashes on worktree resolution. Exercising the shared
    // validation path on both sides catches a rewiring that accidentally
    // bypasses it.
    const logger = createLogger('parity-test')
    const input = {
      title: 'parity-bad-repo',
      repo: 'repo-that-does-not-exist',
      status: 'backlog' as const
    }

    let ipcError: TaskValidationError | null = null
    try {
      await createTaskWithValidation(input, { logger })
    } catch (err) {
      if (err instanceof TaskValidationError) ipcError = err
    }
    expect(ipcError).not.toBeNull()
    expect(ipcError?.code).toBe('repo-not-configured')

    const mcpResult = (await mcpClient.callTool({
      name: 'tasks.create',
      arguments: input
    })) as { isError?: boolean; content: { type: string; text: string }[] }
    expect(mcpResult.isError).toBe(true)
    const mcpBody = JSON.parse(mcpResult.content[0]!.text) as {
      data?: { code?: string }
    }
    expect(mcpBody.data?.code).toBe('repo-not-configured')
  })
})

/**
 * Epic operations have no `epic_changes` audit table (unlike `task_changes`),
 * so parity is restricted to returned-row fields and error semantics. Still
 * valuable: the MCP epic tools are thin wrappers over `EpicGroupService`, and
 * this suite ensures the wrapping does not silently swallow or reshape
 * user-visible behavior.
 */
describe('IPC vs MCP parity — epics', () => {
  it('creates identical epics on both paths', async () => {
    const baseInput = {
      name: 'parity-epic',
      icon: '🚀',
      accent_color: '#00ffcc',
      goal: 'verify wrapper transparency'
    }

    const ipcEpic = epicService.createEpic(baseInput)
    createdEpicIds.push(ipcEpic.id)

    const mcpResult = await mcpClient.callTool({ name: 'epics.create', arguments: baseInput })
    const mcpEpic = readMcpJson<TaskGroup>(mcpResult as { content: unknown[] })
    createdEpicIds.push(mcpEpic.id)

    expect(projectEpicParity(mcpEpic)).toEqual(projectEpicParity(ipcEpic))
  })

  it('rejects dependency cycles identically on both paths', async () => {
    // Cycle detection is the one non-trivial invariant on epic dependencies.
    // If the MCP wrapper forgot to run it — or wrapped the EpicCycleError
    // into something callers can't branch on — users could introduce cycles
    // via the MCP tool that the UI would refuse.
    const epicA = epicService.createEpic({
      name: 'parity-cycle-a',
      icon: 'A',
      accent_color: '#111111'
    })
    const epicB = epicService.createEpic({
      name: 'parity-cycle-b',
      icon: 'B',
      accent_color: '#222222'
    })
    createdEpicIds.push(epicA.id, epicB.id)

    epicService.setDependencies(epicA.id, [{ id: epicB.id, condition: 'on_success' }])

    let ipcThrew: unknown = null
    try {
      epicService.setDependencies(epicB.id, [{ id: epicA.id, condition: 'on_success' }])
    } catch (err) {
      ipcThrew = err
    }
    expect(ipcThrew).toBeInstanceOf(EpicCycleError)

    const mcpResult = (await mcpClient.callTool({
      name: 'epics.setDependencies',
      arguments: {
        id: epicB.id,
        dependencies: [{ id: epicA.id, condition: 'on_success' }]
      }
    })) as { isError?: boolean; content: { type: string; text: string }[] }
    expect(mcpResult.isError).toBe(true)
    const mcpBody = JSON.parse(mcpResult.content[0]!.text) as {
      kind?: string
      message?: string
    }
    // McpDomainError uses `code: 'cycle'` — surfaced as the `kind` field
    // in the JSON-RPC envelope after `toJsonRpcError()` normalises it.
    expect(mcpBody.message?.toLowerCase()).toContain('cycle')
  })
})
