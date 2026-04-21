import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createMcpServer, type McpServerHandle } from './index'
import { createEpicGroupService } from '../services/epic-group-service'
import { createTaskWithValidation, updateTask, deleteTask } from '../services/sprint-service'
import { getTaskChanges } from '../data/task-changes'
import { readOrCreateToken } from './token-store'
import { createLogger } from '../logger'
import { seedBdeRepo } from './test-setup'
import type { SprintTask } from '../../shared/types/task-types'

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

let createdTaskIds: string[] = []

beforeAll(async () => {
  seedBdeRepo()
  serverHandle = createMcpServer(
    { epicService: createEpicGroupService(), onStatusTerminal: () => {} },
    { port: 0 }
  )
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
})

afterEach(() => {
  for (const id of createdTaskIds) {
    try {
      deleteTask(id)
    } catch {
      // best-effort cleanup — row may already be gone
    }
  }
})

describe('IPC vs MCP parity', () => {
  it('creates identical tasks and produces identical audit trails', async () => {
    const logger = createLogger('parity-test')
    const input = { title: 'parity-test', repo: 'bde', status: 'backlog' as const, priority: 3 }

    const ipcTask = createTaskWithValidation(input, { logger })
    createdTaskIds.push(ipcTask.id)

    const mcpResult = await mcpClient.callTool({ name: 'tasks.create', arguments: input })
    const mcpTask = JSON.parse((mcpResult.content[0] as { type: 'text'; text: string }).text)
    createdTaskIds.push(mcpTask.id)

    expect(projectParity(mcpTask)).toEqual(
      projectParity(ipcTask as unknown as Record<string, unknown>)
    )

    await mcpClient.callTool({
      name: 'tasks.update',
      arguments: { id: mcpTask.id, patch: { priority: 7 } }
    })
    updateTask(ipcTask.id, { priority: 7 })

    const ipcHistory = changeFields(getTaskChanges(ipcTask.id))
    const mcpHistory = changeFields(getTaskChanges(mcpTask.id))
    expect(mcpHistory).toEqual(ipcHistory)
  })
})
