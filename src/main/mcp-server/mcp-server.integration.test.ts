import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createMcpServer, type McpServerHandle } from './index'
import { createEpicGroupService } from '../services/epic-group-service'
import { deleteTask } from '../services/sprint-service'
import { readOrCreateToken } from './token-store'
import { seedBdeRepo } from './test-setup'

vi.mock('../broadcast', () => ({ broadcast: vi.fn() }))

/**
 * State split (F.I.R.S.T. — Independent):
 *
 * - `beforeAll` owns expensive process-wide infrastructure: the HTTP server,
 *   the authed MCP `Client`, and the bearer token. Spinning these up per test
 *   is prohibitive (DB open + port bind + MCP handshake each ≈ 100ms).
 * - `beforeEach` / `afterEach` own per-test data: every `tasks.create` result
 *   is tracked in a fresh `createdTaskIds` array and cleaned up after the
 *   test. No test sees another's rows.
 *
 * The three tests stay independent — each can run in isolation with
 * `it.only(...)` and pass.
 */

let serverHandle: McpServerHandle
let mcpClient: Client
let serverPort: number
let bearerToken: string

// Reset per test — no cross-test carryover of created rows.
let createdTaskIds: string[] = []

beforeAll(async () => {
  seedBdeRepo()
  const epicService = createEpicGroupService()
  serverHandle = createMcpServer({ epicService, onStatusTerminal: () => {} }, { port: 0 })
  serverPort = await serverHandle.start()
  bearerToken = (await readOrCreateToken()).token

  mcpClient = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} })
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${serverPort}/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${bearerToken}` } } }
  )
  await mcpClient.connect(transport)
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

describe('MCP server integration', () => {
  it('lists the expected tools', async () => {
    const { tools } = await mcpClient.listTools()
    const names = tools.map((t) => t.name).sort()
    expect(names).toContain('tasks.list')
    expect(names).toContain('tasks.create')
    expect(names).toContain('tasks.update')
    expect(names).toContain('tasks.cancel')
    expect(names).toContain('tasks.history')
    expect(names).toContain('epics.list')
    expect(names).toContain('epics.create')
    expect(names).toContain('meta.taskStatuses')
  })

  it('create → list → update → history round-trip', async () => {
    const created = await mcpClient.callTool({
      name: 'tasks.create',
      arguments: { title: 'mcp integration demo', repo: 'bde', status: 'backlog' }
    })
    const createdBody = JSON.parse((created.content[0] as { type: 'text'; text: string }).text)
    expect(createdBody.title).toBe('mcp integration demo')
    const id = createdBody.id
    createdTaskIds.push(id)

    const list = await mcpClient.callTool({
      name: 'tasks.list',
      arguments: { search: 'mcp integration demo' }
    })
    const listBody = JSON.parse((list.content[0] as { type: 'text'; text: string }).text)
    expect(listBody.some((t: { id: string }) => t.id === id)).toBe(true)

    const updated = await mcpClient.callTool({
      name: 'tasks.update',
      arguments: { id, patch: { priority: 5 } }
    })
    const updatedBody = JSON.parse((updated.content[0] as { type: 'text'; text: string }).text)
    expect(updatedBody.priority).toBe(5)

    const history = await mcpClient.callTool({
      name: 'tasks.history',
      arguments: { id }
    })
    const historyBody = JSON.parse((history.content[0] as { type: 'text'; text: string }).text)
    expect(Array.isArray(historyBody)).toBe(true)
    expect(historyBody.some((r: { field: string }) => r.field === 'priority')).toBe(true)

    await mcpClient.callTool({ name: 'tasks.cancel', arguments: { id } })
  })

  it('rejects requests with a wrong bearer token', async () => {
    const badClient = new Client({ name: 'bad', version: '0.0.0' }, { capabilities: {} })
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${serverPort}/mcp`),
      { requestInit: { headers: { Authorization: 'Bearer wrong' } } }
    )
    await expect(badClient.connect(transport)).rejects.toThrow()
  })
})
