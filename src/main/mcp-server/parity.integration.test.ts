import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createMcpServer, type McpServerHandle } from './index'
import { createEpicGroupService } from '../services/epic-group-service'
import { createTaskWithValidation, updateTask, deleteTask } from '../services/sprint-service'
import { getTaskChanges } from '../data/task-changes'
import { readOrCreateToken } from './token-store'
import { createLogger } from '../logger'
import { seedBdeRepo } from './test-setup'

vi.mock('../broadcast', () => ({ broadcast: vi.fn() }))

let handle: McpServerHandle
let client: Client
let port: number
const createdIds: string[] = []

beforeAll(async () => {
  seedBdeRepo()
  handle = createMcpServer(
    { epicService: createEpicGroupService(), onStatusTerminal: () => {} },
    { port: 0 }
  )
  port = await handle.start()
  const { token } = await readOrCreateToken()

  client = new Client({ name: 'parity', version: '0.0.0' }, { capabilities: {} })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    })
  )
}, 30_000)

afterAll(async () => {
  for (const id of createdIds) {
    try {
      deleteTask(id)
    } catch {
      // best-effort cleanup — row may already be gone
    }
  }
  await client?.close()
  await handle?.stop()
})

function changeFields(changes: ReturnType<typeof getTaskChanges>) {
  return changes.map((c) => ({ field: c.field, old: c.old_value, new: c.new_value }))
}

function withoutVolatileFields(task: Record<string, unknown>) {
  const { id: _id, created_at: _ca, updated_at: _ua, ...rest } = task
  return rest
}

describe('IPC vs MCP parity', () => {
  it('creates identical tasks and produces identical audit trails', async () => {
    const logger = createLogger('parity-test')
    const input = { title: 'parity-test', repo: 'bde', status: 'backlog' as const, priority: 3 }

    const ipcTask = createTaskWithValidation(input, { logger })
    createdIds.push(ipcTask.id)

    const mcpResult = await client.callTool({ name: 'tasks.create', arguments: input })
    const mcpTask = JSON.parse((mcpResult.content[0] as { type: 'text'; text: string }).text)
    createdIds.push(mcpTask.id)

    expect(withoutVolatileFields(mcpTask)).toEqual(withoutVolatileFields(ipcTask as Record<string, unknown>))

    await client.callTool({
      name: 'tasks.update',
      arguments: { id: mcpTask.id, patch: { priority: 7 } }
    })
    updateTask(ipcTask.id, { priority: 7 })

    const ipcHistory = changeFields(getTaskChanges(ipcTask.id))
    const mcpHistory = changeFields(getTaskChanges(mcpTask.id))
    expect(mcpHistory).toEqual(ipcHistory)
  })
})
