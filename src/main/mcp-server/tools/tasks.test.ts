import { describe, it, expect, vi } from 'vitest'
import { registerTaskTools, type TaskToolsDeps } from './tasks'
import { TaskValidationError } from '../../services/sprint-service'
import type { SprintTask } from '../../../shared/types'

type ToolResult = {
  isError?: boolean
  content: Array<{ type: 'text'; text: string }>
}
type ToolHandler = (args: unknown) => Promise<ToolResult>

function mockServer() {
  const handlers = new Map<string, ToolHandler>()
  return {
    server: {
      tool: (name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
        handlers.set(name, handler)
      }
    } as any,
    call: (name: string, args: unknown): Promise<ToolResult> => {
      const h = handlers.get(name)
      if (!h) throw new Error(`no handler for ${name}`)
      return h(args)
    }
  }
}

function parseErrorBody(res: ToolResult): { code: number; message: string; data?: unknown } {
  expect(res.isError).toBe(true)
  return JSON.parse(res.content[0].text)
}

const baseTask: SprintTask = {
  id: 't1',
  title: 'demo',
  repo: 'bde',
  status: 'backlog',
  priority: 0,
  created_at: '2026-04-17T00:00:00.000Z',
  updated_at: '2026-04-17T00:00:00.000Z',
  claimed_by: null,
  tags: null,
  depends_on: null,
  group_id: null,
  spec: null,
  spec_type: null,
  notes: null,
  worktree_path: null,
  pr_url: null,
  pr_number: null,
  pr_status: null,
  started_at: null,
  completed_at: null,
  agent_run_id: null,
  failure_reason: null,
  retry_count: 0,
  playground_enabled: false,
  max_runtime_ms: null,
  template_name: null,
  prompt: null,
  fast_fail_count: 0,
  needs_review: false,
  session_id: null,
  next_eligible_at: null,
  model: null,
  retry_context: null,
  max_cost_usd: null,
  partial_diff: null,
  sprint_id: null,
  cross_repo_contract: null,
  rebase_base_sha: null,
  rebased_at: null,
  revision_feedback: null,
  review_diff_snapshot: null,
  duration_ms: null
}

const fakeTask = (overrides: Partial<SprintTask> = {}): SprintTask => ({
  ...baseTask,
  ...overrides
})

function fakeDeps(overrides: Partial<TaskToolsDeps> = {}): TaskToolsDeps {
  return {
    listTasks: vi.fn(() => [fakeTask()]),
    getTask: vi.fn(() => fakeTask()),
    createTaskWithValidation: vi.fn(() => fakeTask()),
    updateTask: vi.fn(() => fakeTask()),
    cancelTask: vi.fn(() => fakeTask({ status: 'cancelled' })),
    getTaskChanges: vi.fn(() => []),
    onStatusTerminal: vi.fn(() => Promise.resolve()),
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
    ...overrides
  }
}

describe('tasks.* write tools', () => {
  it('tasks.create delegates to createTaskWithValidation', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.create', { title: 't', repo: 'bde' })
    expect(deps.createTaskWithValidation).toHaveBeenCalledWith(
      expect.objectContaining({ title: 't', repo: 'bde' }),
      expect.any(Object)
    )
    expect(JSON.parse(res.content[0].text).id).toBe('t1')
  })

  it('tasks.create strips system-managed fields from the delegate payload', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    // claimed_by, pr_url, pr_status, completed_at, agent_run_id are system-
    // managed — not in TaskWriteFieldsSchema. The schema strips them, and the
    // delegate must never see them. Asserting that the call received a patch
    // object *without* these fields catches regressions where the schema is
    // accidentally broadened.
    await call('tasks.create', {
      title: 't',
      repo: 'bde',
      claimed_by: 'x',
      pr_url: 'https://example.com/pr/1',
      pr_status: 'open',
      completed_at: '2026-04-17T00:00:00.000Z',
      agent_run_id: 'run-1'
    } as any)
    expect(deps.createTaskWithValidation).toHaveBeenCalledWith(
      expect.not.objectContaining({
        claimed_by: expect.anything(),
        pr_url: expect.anything(),
        pr_status: expect.anything(),
        completed_at: expect.anything(),
        agent_run_id: expect.anything()
      }),
      expect.any(Object)
    )
  })

  it('tasks.create forwards every CreateTaskInput field to the delegate', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const fullInput = {
      title: 'Full-coverage task',
      repo: 'bde',
      status: 'queued',
      prompt: 'build it',
      spec: '## Problem\nx\n## Solution\ny\n## Files to Change\n- a.ts\n',
      spec_type: 'feature',
      notes: 'additional context',
      priority: 5,
      tags: ['foo', 'bar'],
      depends_on: [{ id: 'dep-1', type: 'hard' as const }],
      playground_enabled: true,
      max_runtime_ms: 600_000,
      template_name: 'Feature',
      model: 'claude-sonnet-4-5',
      cross_repo_contract: 'needs api change in other-repo',
      group_id: 'epic-1'
    }
    await call('tasks.create', fullInput)
    const call0 = (deps.createTaskWithValidation as any).mock.calls[0][0]
    for (const [key, value] of Object.entries(fullInput)) {
      expect(call0[key]).toEqual(value)
    }
  })

  it('tasks.create forwards skipReadinessCheck to the delegate', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    await call('tasks.create', { title: 't', repo: 'bde', skipReadinessCheck: true })
    const invocation = (deps.createTaskWithValidation as any).mock.calls[0]
    const opts = invocation[2]
    expect(opts).toEqual(expect.objectContaining({ skipReadinessCheck: true }))
    // And the option must not leak into the CreateTaskInput forwarded to the delegate.
    const input = invocation[0]
    expect(input.skipReadinessCheck).toBeUndefined()
  })

  it('tasks.create omits skipReadinessCheck opt when absent', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    await call('tasks.create', { title: 't', repo: 'bde' })
    const invocation = (deps.createTaskWithValidation as any).mock.calls[0]
    const opts = invocation[2]
    expect(opts?.skipReadinessCheck).toBeUndefined()
  })

  it('tasks.update returns structured NotFound when updateTask returns null', async () => {
    const deps = fakeDeps({
      updateTask: vi.fn(() => null)
    })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.update', { id: 't1', patch: { priority: 5 } })
    const body = parseErrorBody(res)
    expect(body.code).toBe(-32001)
    expect(body.message).toMatch(/not found/)
    expect(body.data).toMatchObject({ id: 't1' })
  })

  it('tasks.update resets terminal-state fields when transitioning from terminal to queued', async () => {
    const deps = fakeDeps({
      getTask: vi.fn(() => fakeTask({ id: 't1', status: 'failed' })),
      updateTask: vi.fn(() => fakeTask({ id: 't1', status: 'queued' }))
    })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    await call('tasks.update', { id: 't1', patch: { status: 'queued' } })
    const patch = (deps.updateTask as any).mock.calls[0][1]
    expect(patch).toMatchObject({
      status: 'queued',
      completed_at: null,
      failure_reason: null,
      claimed_by: null,
      started_at: null,
      retry_count: 0,
      fast_fail_count: 0,
      next_eligible_at: null
    })
  })

  it('tasks.update resets terminal-state fields on terminal → backlog transitions too', async () => {
    const deps = fakeDeps({
      getTask: vi.fn(() => fakeTask({ id: 't1', status: 'cancelled' })),
      updateTask: vi.fn(() => fakeTask({ id: 't1', status: 'backlog' }))
    })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    await call('tasks.update', { id: 't1', patch: { status: 'backlog' } })
    const patch = (deps.updateTask as any).mock.calls[0][1]
    expect(patch).toMatchObject({
      status: 'backlog',
      completed_at: null,
      failure_reason: null
    })
  })

  it('tasks.update for non-terminal status changes does NOT clear terminal fields', async () => {
    const deps = fakeDeps({
      getTask: vi.fn(() => fakeTask({ id: 't1', status: 'active' })),
      updateTask: vi.fn(() => fakeTask({ id: 't1', status: 'review' }))
    })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    await call('tasks.update', { id: 't1', patch: { status: 'review' } })
    const patch = (deps.updateTask as any).mock.calls[0][1]
    expect(patch).not.toHaveProperty('completed_at')
    expect(patch).not.toHaveProperty('failure_reason')
  })

  it('tasks.update for non-status patches does NOT clear terminal fields', async () => {
    const deps = fakeDeps({
      getTask: vi.fn(() => fakeTask({ id: 't1', status: 'failed' })),
      updateTask: vi.fn(() => fakeTask({ id: 't1', status: 'failed' }))
    })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    await call('tasks.update', { id: 't1', patch: { priority: 9 } })
    const patch = (deps.updateTask as any).mock.calls[0][1]
    expect(patch).not.toHaveProperty('completed_at')
    expect(patch).toMatchObject({ priority: 9 })
  })

  it('tasks.cancel routes through cancelTask (which triggers onStatusTerminal)', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.cancel', { id: 't1', reason: 'no longer needed' })
    expect(deps.cancelTask).toHaveBeenCalledWith('t1', 'no longer needed')
    expect(JSON.parse(res.content[0].text).status).toBe('cancelled')
  })

  it('tasks.cancel returns structured NotFound when cancelTask returns null', async () => {
    const deps = fakeDeps({ cancelTask: vi.fn(() => null) })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.cancel', { id: 'missing' })
    const body = parseErrorBody(res)
    expect(body.code).toBe(-32001)
    expect(body.message).toMatch(/not found/i)
    expect(body.data).toMatchObject({ id: 'missing' })
  })

  it('tasks.update fires onStatusTerminal when entering a terminal status from non-terminal', async () => {
    const deps = fakeDeps({
      getTask: vi.fn(() => fakeTask({ id: 't1', status: 'active' })),
      updateTask: vi.fn(() => fakeTask({ id: 't1', status: 'done' }))
    })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    await call('tasks.update', { id: 't1', patch: { status: 'done' } })
    expect(deps.onStatusTerminal).toHaveBeenCalledTimes(1)
    expect(deps.onStatusTerminal).toHaveBeenCalledWith('t1', 'done')
  })

  it('tasks.update does NOT fire onStatusTerminal on the revival path (terminal → queued)', async () => {
    const deps = fakeDeps({
      getTask: vi.fn(() => fakeTask({ id: 't1', status: 'failed' })),
      updateTask: vi.fn(() => fakeTask({ id: 't1', status: 'queued' }))
    })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    await call('tasks.update', { id: 't1', patch: { status: 'queued' } })
    expect(deps.onStatusTerminal).not.toHaveBeenCalled()
  })

  it('tasks.update does NOT fire onStatusTerminal when already terminal (idempotent retry)', async () => {
    const deps = fakeDeps({
      getTask: vi.fn(() => fakeTask({ id: 't1', status: 'failed' })),
      updateTask: vi.fn(() => fakeTask({ id: 't1', status: 'error' }))
    })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    await call('tasks.update', { id: 't1', patch: { status: 'error' } })
    expect(deps.onStatusTerminal).not.toHaveBeenCalled()
  })

  it('tasks.update does NOT fire onStatusTerminal for non-terminal transitions', async () => {
    const deps = fakeDeps({
      getTask: vi.fn(() => fakeTask({ id: 't1', status: 'active' })),
      updateTask: vi.fn(() => fakeTask({ id: 't1', status: 'review' }))
    })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    await call('tasks.update', { id: 't1', patch: { status: 'review' } })
    expect(deps.onStatusTerminal).not.toHaveBeenCalled()
  })

  it('tasks.create returns ValidationFailed payload when TaskValidationError is thrown', async () => {
    const deps = fakeDeps({
      createTaskWithValidation: vi.fn(() => {
        throw new TaskValidationError('spec-structural', 'Spec missing required headings')
      })
    })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.create', { title: 't', repo: 'bde' })
    const body = parseErrorBody(res)
    expect(body.code).toBe(-32005)
    expect(body.message).toMatch(/Spec missing required headings/)
    expect(body.data).toMatchObject({ code: 'spec-structural' })
  })

  it('tasks.create propagates unknown throws unchanged', async () => {
    const deps = fakeDeps({
      createTaskWithValidation: vi.fn(() => {
        throw new Error('database offline')
      })
    })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    await expect(call('tasks.create', { title: 't', repo: 'bde' })).rejects.toThrow(
      /database offline/
    )
  })
})

describe('tasks.* read tools', () => {
  it('tasks.list filters by status and returns JSON text', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.list', { status: 'queued' })
    const parsed = JSON.parse(res.content[0].text)
    expect(Array.isArray(parsed)).toBe(true)
    expect(deps.listTasks).toHaveBeenCalled()
  })

  it('tasks.get returns structured NotFound payload when task missing', async () => {
    const deps = fakeDeps({ getTask: vi.fn(() => null) })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.get', { id: 'missing' })
    const body = parseErrorBody(res)
    expect(body.code).toBe(-32001)
    expect(body.message).toMatch(/not found/)
    expect(body.data).toMatchObject({ id: 'missing' })
  })

  it('tasks.create returns structured InvalidParams payload on zod validation failure', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    // Missing required `title` — schema enforces a minimum length.
    const res = await call('tasks.create', { title: '', repo: 'bde' })
    const body = parseErrorBody(res)
    expect(body.code).toBe(-32602)
    expect(body.message).toMatch(/title/i)
  })

  it('tasks.history returns the change rows as JSON', async () => {
    const rows = [{ id: 'c1', task_id: 't1', field: 'status', old: 'queued', new: 'active' }]
    const deps = fakeDeps({ getTaskChanges: vi.fn(() => rows as any) })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.history', { id: 't1' })
    expect(JSON.parse(res.content[0].text)).toEqual(rows)
  })
})

describe('tasks.list filter + pagination composition', () => {
  const fixture: SprintTask[] = [
    fakeTask({
      id: 'a',
      title: 'Alpha widget',
      repo: 'bde',
      tags: ['foo'],
      group_id: 'epic-1',
      spec: 'details about alpha'
    }),
    fakeTask({
      id: 'b',
      title: 'Beta panel',
      repo: 'bde',
      tags: ['foo', 'bar'],
      group_id: 'epic-2',
      spec: null
    }),
    fakeTask({
      id: 'c',
      title: 'Gamma report',
      repo: 'other',
      tags: ['bar'],
      group_id: 'epic-1',
      spec: 'report details'
    }),
    fakeTask({
      id: 'd',
      title: 'Delta note',
      repo: 'other',
      tags: null,
      group_id: null,
      spec: 'mentions ALPHA inside'
    }),
    fakeTask({
      id: 'e',
      title: 'Epsilon task',
      repo: 'bde',
      tags: ['baz'],
      group_id: 'epic-2',
      spec: 'nothing special'
    })
  ]

  function idsFromResult(res: ToolResult): string[] {
    return (JSON.parse(res.content[0].text) as SprintTask[]).map((t) => t.id)
  }

  it('filters by repo', async () => {
    const deps = fakeDeps({ listTasks: vi.fn(() => fixture) })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.list', { repo: 'bde' })
    expect(idsFromResult(res)).toEqual(['a', 'b', 'e'])
  })

  it('filters by epicId', async () => {
    const deps = fakeDeps({ listTasks: vi.fn(() => fixture) })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.list', { epicId: 'epic-1' })
    expect(idsFromResult(res)).toEqual(['a', 'c'])
  })

  it('filters by tag (array membership)', async () => {
    const deps = fakeDeps({ listTasks: vi.fn(() => fixture) })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.list', { tag: 'foo' })
    expect(idsFromResult(res)).toEqual(['a', 'b'])
  })

  it('filters by search (case-insensitive, title OR spec)', async () => {
    const deps = fakeDeps({ listTasks: vi.fn(() => fixture) })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.list', { search: 'alpha' })
    // 'a' matches title; 'd' matches spec body ("mentions ALPHA inside") case-insensitively.
    expect(idsFromResult(res).sort()).toEqual(['a', 'd'])
  })

  it('composes two filters as an intersection', async () => {
    const deps = fakeDeps({ listTasks: vi.fn(() => fixture) })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.list', { repo: 'bde', tag: 'bar' })
    expect(idsFromResult(res)).toEqual(['b'])
  })

  it('paginates with explicit offset + limit', async () => {
    const deps = fakeDeps({ listTasks: vi.fn(() => fixture) })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const firstPage = await call('tasks.list', { offset: 0, limit: 2 })
    expect(idsFromResult(firstPage)).toEqual(['a', 'b'])
    const secondPage = await call('tasks.list', { offset: 2, limit: 2 })
    expect(idsFromResult(secondPage)).toEqual(['c', 'd'])
  })

  it('returns empty page when offset exceeds fixture size', async () => {
    const deps = fakeDeps({ listTasks: vi.fn(() => fixture) })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.list', { offset: 10 })
    expect(idsFromResult(res)).toEqual([])
  })

  it('defaults to offset 0 and limit 100 when both omitted', async () => {
    const deps = fakeDeps({ listTasks: vi.fn(() => fixture) })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.list', {})
    expect(idsFromResult(res)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('tasks.history offset arithmetic', () => {
  const historyRows = Array.from({ length: 10 }, (_, i) => ({
    id: `c${i}`,
    task_id: 't1',
    field: 'status',
    old: 'queued',
    new: 'active',
    changed_at: `2026-04-17T00:00:0${i}.000Z`
  }))

  it('adds offset to limit when calling getTaskChanges, then slices by offset', async () => {
    const getTaskChanges = vi.fn(() => historyRows as any)
    const deps = fakeDeps({ getTaskChanges })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.history', { id: 't1', limit: 3, offset: 2 })
    expect(getTaskChanges).toHaveBeenCalledWith('t1', 5)
    const returned = JSON.parse(res.content[0].text)
    expect(returned).toEqual(historyRows.slice(2))
  })

  it('defaults offset to 0 when only limit is supplied', async () => {
    const getTaskChanges = vi.fn(() => historyRows.slice(0, 3) as any)
    const deps = fakeDeps({ getTaskChanges })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.history', { id: 't1', limit: 3 })
    expect(getTaskChanges).toHaveBeenCalledWith('t1', 3)
    expect(JSON.parse(res.content[0].text)).toEqual(historyRows.slice(0, 3))
  })

  it('defaults both offset and limit when neither is supplied', async () => {
    const getTaskChanges = vi.fn(() => historyRows as any)
    const deps = fakeDeps({ getTaskChanges })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.history', { id: 't1' })
    expect(getTaskChanges).toHaveBeenCalledWith('t1', 100)
    expect(JSON.parse(res.content[0].text)).toEqual(historyRows)
  })
})
