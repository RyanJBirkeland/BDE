import { describe, it, expect, vi } from 'vitest'
import { registerEpicTools, type EpicToolsDeps } from './epics'
import { EpicCycleError, EpicNotFoundError } from '../../services/epic-group-service'
import type { TaskGroup } from '../../../shared/types'

type ToolResult = {
  isError?: boolean
  content: Array<{ type: 'text'; text: string }>
}
type ToolHandler = (args: unknown) => Promise<ToolResult>

function mockServer() {
  const handlers = new Map<string, ToolHandler>()
  return {
    server: {
      tool: (name: string, _d: string, _s: unknown, h: ToolHandler) => {
        handlers.set(name, h)
      }
    } as any,
    call: (name: string, args: unknown): Promise<ToolResult> => handlers.get(name)!(args)
  }
}

function parseErrorBody(res: ToolResult): { code: number; message: string; data?: unknown } {
  expect(res.isError).toBe(true)
  return JSON.parse(res.content[0].text)
}

const fakeGroup = (overrides: Partial<TaskGroup> = {}): TaskGroup => ({
  id: 'g1',
  name: 'E1',
  icon: 'G',
  accent_color: '#0ff',
  goal: null,
  status: 'draft',
  created_at: '2026-04-17T00:00:00.000Z',
  updated_at: '2026-04-17T00:00:00.000Z',
  depends_on: null,
  ...overrides
})

// Only includes methods the epic tool handlers actually call. `registerEpicTools`
// never invokes reorderTasks, queueAllTasks, addDependency, removeDependency,
// or updateDependencyCondition — setDependencies replaces them atomically — so
// leaving them on the fake misleads readers about the handler's surface.
function fakeDeps(over: Partial<EpicToolsDeps> = {}): EpicToolsDeps {
  const svc = {
    listEpics: vi.fn(() => [fakeGroup()]),
    getEpic: vi.fn(() => fakeGroup()),
    getEpicTasks: vi.fn(() => []),
    createEpic: vi.fn((i) => fakeGroup({ id: 'new', ...i })),
    updateEpic: vi.fn((id, patch) => fakeGroup({ id, ...patch })),
    deleteEpic: vi.fn(),
    addTask: vi.fn(),
    removeTask: vi.fn(),
    setDependencies: vi.fn((id, deps) => fakeGroup({ id, depends_on: [...deps] }))
  }
  return { epicService: svc as any, ...over }
}

describe('epics.* tools', () => {
  it('epics.list returns JSON text', async () => {
    const { server, call } = mockServer()
    registerEpicTools(server, fakeDeps())
    const res = await call('epics.list', {})
    expect(Array.isArray(JSON.parse(res.content[0].text))).toBe(true)
  })

  it('epics.get returns structured NotFound payload when missing', async () => {
    const deps = fakeDeps()
    ;(deps.epicService.getEpic as any).mockReturnValue(null)
    const { server, call } = mockServer()
    registerEpicTools(server, deps)
    const res = await call('epics.get', { id: 'missing' })
    const body = parseErrorBody(res)
    expect(body.code).toBe(-32001)
    expect(body.message).toMatch(/not found/)
    expect(body.data).toMatchObject({ id: 'missing' })
  })

  it('epics.get includes tasks when includeTasks is true', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerEpicTools(server, deps)
    const res = await call('epics.get', { id: 'g1', includeTasks: true })
    const body = JSON.parse(res.content[0].text)
    expect(body).toHaveProperty('tasks')
    expect(deps.epicService.getEpicTasks).toHaveBeenCalledWith('g1')
  })

  it('epics.create delegates to service', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerEpicTools(server, deps)
    const res = await call('epics.create', { name: 'new' })
    expect(deps.epicService.createEpic).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'new' })
    )
    expect(JSON.parse(res.content[0].text).id).toBe('new')
  })

  it('epics.setDependencies delegates to service.setDependencies (atomic)', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerEpicTools(server, deps)
    await call('epics.setDependencies', {
      id: 'g1',
      dependencies: [{ id: 'new', condition: 'always' }]
    })
    expect(deps.epicService.setDependencies).toHaveBeenCalledWith('g1', [
      { id: 'new', condition: 'always' }
    ])
    // Handler delegates atomically to setDependencies. Omitting addDependency
    // and removeDependency from the fake is the structural guarantee that the
    // handler cannot re-implement the diff loop against them — if someone
    // regresses this, the handler will crash with "undefined is not a function".
  })

  it('epics.setDependencies returns structured NotFound payload when EpicNotFoundError is thrown', async () => {
    const deps = fakeDeps()
    ;(deps.epicService.setDependencies as any).mockImplementation(() => {
      throw new EpicNotFoundError('missing')
    })
    const { server, call } = mockServer()
    registerEpicTools(server, deps)
    const res = await call('epics.setDependencies', { id: 'missing', dependencies: [] })
    const body = parseErrorBody(res)
    expect(body.code).toBe(-32001)
    expect(body.message).toMatch(/not found/i)
    expect(body.data).toMatchObject({ id: 'missing' })
  })

  it('epics.setDependencies returns structured Cycle payload when EpicCycleError is thrown', async () => {
    const deps = fakeDeps()
    ;(deps.epicService.setDependencies as any).mockImplementation(() => {
      throw new EpicCycleError('g1', 'g1 -> g2 -> g1')
    })
    const { server, call } = mockServer()
    registerEpicTools(server, deps)
    const res = await call('epics.setDependencies', { id: 'g1', dependencies: [] })
    const body = parseErrorBody(res)
    expect(body.code).toBe(-32003)
    expect(body.message).toMatch(/cycle/i)
    expect(body.data).toMatchObject({ id: 'g1' })
  })

  it('epics.setDependencies propagates unknown throws unchanged', async () => {
    const deps = fakeDeps()
    ;(deps.epicService.setDependencies as any).mockImplementation(() => {
      throw new Error('something broke')
    })
    const { server, call } = mockServer()
    registerEpicTools(server, deps)
    await expect(call('epics.setDependencies', { id: 'g1', dependencies: [] })).rejects.toThrow(
      /something broke/
    )
  })

  it('epics.update delegates to updateEpic with the patch', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerEpicTools(server, deps)
    const res = await call('epics.update', {
      id: 'g1',
      patch: { name: 'renamed', status: 'ready' }
    })
    expect(deps.epicService.updateEpic).toHaveBeenCalledWith('g1', {
      name: 'renamed',
      status: 'ready',
      goal: undefined
    })
    const body = JSON.parse(res.content[0].text)
    expect(body).toMatchObject({ id: 'g1', name: 'renamed', status: 'ready' })
  })

  it('epics.update coerces null goal to undefined before delegating', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerEpicTools(server, deps)
    await call('epics.update', { id: 'g1', patch: { goal: null } })
    // Nullable goal in the schema is currently coerced to `undefined` by the
    // handler (pending T-17). Lock in the current behavior so the follow-up
    // refactor has a visible baseline.
    expect(deps.epicService.updateEpic).toHaveBeenCalledWith('g1', { goal: undefined })
  })

  it('epics.update returns structured NotFound when EpicNotFoundError is thrown', async () => {
    const deps = fakeDeps()
    ;(deps.epicService.updateEpic as any).mockImplementation(() => {
      throw new EpicNotFoundError('missing')
    })
    const { server, call } = mockServer()
    registerEpicTools(server, deps)
    const res = await call('epics.update', { id: 'missing', patch: { name: 'x' } })
    const body = parseErrorBody(res)
    expect(body.code).toBe(-32001)
    expect(body.message).toMatch(/not found/i)
    expect(body.data).toMatchObject({ id: 'missing' })
  })

  it('epics.delete delegates to deleteEpic and returns an acknowledgement payload', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerEpicTools(server, deps)
    const res = await call('epics.delete', { id: 'g1' })
    expect(deps.epicService.deleteEpic).toHaveBeenCalledWith('g1')
    expect(JSON.parse(res.content[0].text)).toEqual({ deleted: true, id: 'g1' })
  })

  it('epics.addTask delegates to addTask and returns an acknowledgement payload', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerEpicTools(server, deps)
    const res = await call('epics.addTask', { epicId: 'g1', taskId: 't1' })
    expect(deps.epicService.addTask).toHaveBeenCalledWith('g1', 't1')
    expect(JSON.parse(res.content[0].text)).toEqual({ ok: true, epicId: 'g1', taskId: 't1' })
  })

  it('epics.removeTask delegates to removeTask and returns an acknowledgement payload', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerEpicTools(server, deps)
    const res = await call('epics.removeTask', { taskId: 't1' })
    expect(deps.epicService.removeTask).toHaveBeenCalledWith('t1')
    expect(JSON.parse(res.content[0].text)).toEqual({ ok: true, taskId: 't1' })
  })
})
