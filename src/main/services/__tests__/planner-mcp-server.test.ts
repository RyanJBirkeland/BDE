import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { buildPlannerTools, PLANNER_MCP_SERVER_NAME } from '../planner-mcp-server'
import { createEpicGroupService } from '../epic-group-service'
import { deleteTask } from '../sprint-service'
import { deleteGroup } from '../../data/task-group-queries'
import { seedBdeRepo } from '../../mcp-server/test-setup'
import type { PlannerTool } from '../planner-mcp-server'
import type { Logger } from '../../logger'

vi.mock('../../broadcast', () => ({ broadcast: vi.fn() }))

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {}
}

async function callTool(
  tools: PlannerTool[],
  name: string,
  input: Record<string, unknown>
): Promise<{ isError: boolean; body: unknown }> {
  const target = tools.find((t) => t.name === name)
  if (!target) throw new Error(`Tool ${name} not found`)
  const result = await target.handler(input, undefined)
  const text = (result.content[0] as { type: 'text'; text: string }).text
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { isError: result.isError === true, body }
}

let tools: PlannerTool[]
let createdTaskIds: string[]
let createdEpicIds: string[]

beforeAll(() => {
  seedBdeRepo()
  const epicService = createEpicGroupService()
  tools = buildPlannerTools({ epicService, logger: silentLogger })
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
      /* best-effort */
    }
  }
  for (const id of createdEpicIds) {
    try {
      deleteGroup(id)
    } catch {
      /* best-effort */
    }
  }
})

describe('planner MCP server — catalogue', () => {
  it('uses the bde server name shared with the HTTP MCP server', () => {
    expect(PLANNER_MCP_SERVER_NAME).toBe('bde')
  })

  it('exposes the planner-oriented tool surface', () => {
    expect(tools.map((t) => t.name).sort()).toEqual([
      'epics.addTask',
      'epics.create',
      'epics.list',
      'epics.setDependencies',
      'meta.repos',
      'meta.taskStatuses',
      'tasks.create',
      'tasks.list',
      'tasks.update'
    ])
  })

  it('every tool carries a non-empty description so the agent knows when to use it', () => {
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(20)
    }
  })
})

describe('tasks.create', () => {
  it('creates a backlog task against a configured repo', async () => {
    const { isError, body } = await callTool(tools, 'tasks.create', {
      title: 'planner tool create',
      repo: 'bde',
      status: 'backlog'
    })
    expect(isError).toBe(false)
    const task = body as { id: string; title: string; repo: string; status: string }
    createdTaskIds.push(task.id)
    expect(task.title).toBe('planner tool create')
    expect(task.repo).toBe('bde')
    expect(task.status).toBe('backlog')
  })

  it('returns isError when the repo is not configured', async () => {
    const { isError, body } = await callTool(tools, 'tasks.create', {
      title: 'bad repo',
      repo: 'not-a-real-repo',
      status: 'backlog'
    })
    expect(isError).toBe(true)
    expect(String(body)).toMatch(/not configured/i)
  })

  it('returns isError when the title is missing', async () => {
    const { isError } = await callTool(tools, 'tasks.create', {
      repo: 'bde'
    })
    expect(isError).toBe(true)
  })

  it('downgrades a queued request to backlog so auto-exec requires human approval', async () => {
    const { isError, body } = await callTool(tools, 'tasks.create', {
      title: 'queued from agent should become backlog',
      repo: 'bde',
      spec: '# Spec\n\n## What\nNo-op.\n\n## How\nStill no-op.',
      status: 'queued'
    })
    expect(isError).toBe(false)
    const task = body as { id: string; status: string }
    createdTaskIds.push(task.id)
    expect(task.status).toBe('backlog')
  })
})

describe('tasks.update', () => {
  it('does not allow agents to transition a task to queued', async () => {
    const created = await callTool(tools, 'tasks.create', {
      title: 'agent tries to queue this later',
      repo: 'bde',
      spec: '# Spec\n\n## What\nNo-op.\n\n## How\nStill no-op.',
      status: 'backlog'
    })
    const createdTask = created.body as { id: string }
    createdTaskIds.push(createdTask.id)

    const { isError, body } = await callTool(tools, 'tasks.update', {
      id: createdTask.id,
      patch: { status: 'queued' }
    })
    expect(isError).toBe(true)
    expect(String(body)).toMatch(/queue|approval/i)
  })
})

describe('tasks.update', () => {
  it('patches an existing task and records the change under caller "agent"', async () => {
    const created = await callTool(tools, 'tasks.create', {
      title: 'to be updated',
      repo: 'bde',
      status: 'backlog'
    })
    const taskId = (created.body as { id: string }).id
    createdTaskIds.push(taskId)

    const { isError, body } = await callTool(tools, 'tasks.update', {
      id: taskId,
      patch: { priority: 7, tags: ['planner-tool'] }
    })
    expect(isError).toBe(false)
    const patched = body as { priority: number; tags: string[] }
    expect(patched.priority).toBe(7)
    expect(patched.tags).toEqual(['planner-tool'])
  })

  it('returns isError for an unknown task id', async () => {
    const { isError, body } = await callTool(tools, 'tasks.update', {
      id: 'does-not-exist',
      patch: { priority: 1 }
    })
    expect(isError).toBe(true)
    expect(String(body)).toMatch(/not found/i)
  })
})

describe('tasks.list', () => {
  it('returns recently created tasks filtered by repo', async () => {
    const created = await callTool(tools, 'tasks.create', {
      title: 'listable task',
      repo: 'bde',
      status: 'backlog'
    })
    const taskId = (created.body as { id: string }).id
    createdTaskIds.push(taskId)

    const { isError, body } = await callTool(tools, 'tasks.list', {
      repo: 'bde',
      limit: 50
    })
    expect(isError).toBe(false)
    const rows = body as Array<{ id: string }>
    expect(rows.some((r) => r.id === taskId)).toBe(true)
  })
})

describe('epics.create + epics.addTask', () => {
  it('creates an epic and attaches an existing task to it', async () => {
    const epicResult = await callTool(tools, 'epics.create', {
      name: 'planner test epic',
      goal: 'verify epic-task linkage works end-to-end'
    })
    expect(epicResult.isError).toBe(false)
    const epic = epicResult.body as { id: string; name: string }
    createdEpicIds.push(epic.id)
    expect(epic.name).toBe('planner test epic')

    const taskResult = await callTool(tools, 'tasks.create', {
      title: 'epic-member task',
      repo: 'bde',
      status: 'backlog'
    })
    const taskId = (taskResult.body as { id: string }).id
    createdTaskIds.push(taskId)

    const addResult = await callTool(tools, 'epics.addTask', {
      epicId: epic.id,
      taskId
    })
    expect(addResult.isError).toBe(false)
    const ack = addResult.body as { ok: boolean; epicId: string; taskId: string }
    expect(ack).toEqual({ ok: true, epicId: epic.id, taskId })
  })

  it('returns isError when the target epic does not exist', async () => {
    const taskResult = await callTool(tools, 'tasks.create', {
      title: 'orphan task',
      repo: 'bde',
      status: 'backlog'
    })
    const taskId = (taskResult.body as { id: string }).id
    createdTaskIds.push(taskId)

    const { isError } = await callTool(tools, 'epics.addTask', {
      epicId: 'no-such-epic',
      taskId
    })
    expect(isError).toBe(true)
  })
})

describe('meta tools', () => {
  it('meta.repos returns the seeded repo configuration', async () => {
    const { isError, body } = await callTool(tools, 'meta.repos', {})
    expect(isError).toBe(false)
    const repos = body as Array<{ name: string }>
    expect(repos.some((r) => r.name === 'bde')).toBe(true)
  })

  it('meta.taskStatuses advertises the full status vocabulary', async () => {
    const { isError, body } = await callTool(tools, 'meta.taskStatuses', {})
    expect(isError).toBe(false)
    const payload = body as { statuses: string[]; transitions: Record<string, string[]> }
    expect(payload.statuses).toContain('queued')
    expect(payload.statuses).toContain('review')
    expect(payload.statuses).toContain('done')
    expect(Object.keys(payload.transitions).length).toBeGreaterThan(0)
  })
})
