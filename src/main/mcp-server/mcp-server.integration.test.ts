import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createMcpServer, type McpServerHandle } from './index'
import { createEpicGroupService } from '../services/epic-group-service'
import { deleteTask } from '../services/sprint-service'
import { readOrCreateToken } from './token-store'
import { seedBdeRepo } from './test-setup'

vi.mock('../broadcast', () => ({ broadcast: vi.fn() }))

let handle: McpServerHandle
let client: Client
let port: number
let token: string
const createdIds: string[] = []

beforeAll(async () => {
  seedBdeRepo()
  const epicService = createEpicGroupService()
  handle = createMcpServer(
    { epicService, onStatusTerminal: () => {} },
    { port: 0 }
  )
  port = await handle.start()
  token = (await readOrCreateToken()).token

  client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} })
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
  )
  await client.connect(transport)
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

describe('MCP server integration', () => {
  it('lists the expected tools', async () => {
    const { tools } = await client.listTools()
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
    const created = await client.callTool({
      name: 'tasks.create',
      arguments: { title: 'mcp integration demo', repo: 'bde', status: 'backlog' }
    })
    const createdBody = JSON.parse((created.content[0] as { type: 'text'; text: string }).text)
    expect(createdBody.title).toBe('mcp integration demo')
    const id = createdBody.id
    createdIds.push(id)

    const list = await client.callTool({
      name: 'tasks.list',
      arguments: { search: 'mcp integration demo' }
    })
    const listBody = JSON.parse((list.content[0] as { type: 'text'; text: string }).text)
    expect(listBody.some((t: { id: string }) => t.id === id)).toBe(true)

    const updated = await client.callTool({
      name: 'tasks.update',
      arguments: { id, patch: { priority: 5 } }
    })
    const updatedBody = JSON.parse((updated.content[0] as { type: 'text'; text: string }).text)
    expect(updatedBody.priority).toBe(5)

    const history = await client.callTool({
      name: 'tasks.history',
      arguments: { id }
    })
    const historyBody = JSON.parse((history.content[0] as { type: 'text'; text: string }).text)
    expect(Array.isArray(historyBody)).toBe(true)
    expect(historyBody.some((r: { field: string }) => r.field === 'priority')).toBe(true)

    await client.callTool({ name: 'tasks.cancel', arguments: { id } })
  })

  it('rejects requests with a wrong bearer token', async () => {
    const bad = new Client({ name: 'bad', version: '0.0.0' }, { capabilities: {} })
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
      { requestInit: { headers: { Authorization: 'Bearer wrong' } } }
    )
    await expect(bad.connect(transport)).rejects.toThrow()
  })
})
