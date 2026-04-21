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

  it('tasks.update terminal→queued revival applies all seven reset fields; non-revival adds none (RC6)', async () => {
    const revivingDeps = fakeDeps({
      getTask: vi.fn(() =>
        fakeTask({
          id: 't1',
          status: 'failed',
          failure_reason: 'build failed',
          retry_count: 2,
          fast_fail_count: 1,
          claimed_by: 'agent-x',
          started_at: '2026-04-17T00:00:00.000Z',
          completed_at: '2026-04-17T00:30:00.000Z',
          next_eligible_at: '2026-04-17T01:00:00.000Z'
        })
      ),
      updateTask: vi.fn(() => fakeTask({ id: 't1', status: 'queued' }))
    })
    const { server: srv1, call: call1 } = mockServer()
    registerTaskTools(srv1, revivingDeps)
    await call1('tasks.update', { id: 't1', patch: { status: 'queued' } })
    const revivalPatch = (revivingDeps.updateTask as any).mock.calls[0][1]
    expect(revivalPatch).toEqual({
      status: 'queued',
      completed_at: null,
      failure_reason: null,
      claimed_by: null,
      started_at: null,
      retry_count: 0,
      fast_fail_count: 0,
      next_eligible_at: null
    })

    const queuedToActiveDeps = fakeDeps({
      getTask: vi.fn(() => fakeTask({ id: 't1', status: 'queued' })),
      updateTask: vi.fn(() => fakeTask({ id: 't1', status: 'active' }))
    })
    const { server: srv2, call: call2 } = mockServer()
    registerTaskTools(srv2, queuedToActiveDeps)
    await call2('tasks.update', { id: 't1', patch: { status: 'active' } })
    const nonRevivalPatch = (queuedToActiveDeps.updateTask as any).mock.calls[0][1]
    for (const field of [
      'completed_at',
      'failure_reason',
      'claimed_by',
      'started_at',
      'retry_count',
      'fast_fail_count',
      'next_eligible_at'
    ]) {
      expect(nonRevivalPatch).not.toHaveProperty(field)
    }
    expect(nonRevivalPatch).toEqual({ status: 'active' })
  })

  it('tasks.cancel routes through cancelTask (which triggers onStatusTerminal) with caller attribution', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.cancel', { id: 't1', reason: 'no longer needed' })
    expect(deps.cancelTask).toHaveBeenCalledWith('t1', 'no longer needed', { caller: 'mcp' })
    expect(JSON.parse(res.content[0].text).status).toBe('cancelled')
  })

  it('tasks.update forwards the MCP caller attribution to updateTask', async () => {
    const deps = fakeDeps({
      getTask: vi.fn(() => fakeTask({ id: 't1', status: 'active' })),
      updateTask: vi.fn(() => fakeTask({ id: 't1', status: 'active', priority: 9 }))
    })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    await call('tasks.update', { id: 't1', patch: { priority: 9 } })
    const options = (deps.updateTask as any).mock.calls[0][2]
    expect(options).toEqual({ caller: 'mcp' })
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

describe('tasks.list — forwards filter + pagination into the data layer (T-2)', () => {
  const prefiltered: SprintTask[] = [fakeTask({ id: 'x' })]

  function callWith(args: Record<string, unknown>) {
    const listTasks = vi.fn(() => prefiltered)
    const deps = fakeDeps({ listTasks })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    return { listTasks, call: () => call('tasks.list', args) }
  }

  it('forwards repo as an option', async () => {
    const { listTasks, call } = callWith({ repo: 'bde' })
    await call()
    expect(listTasks).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'bde', limit: 100, offset: 0 })
    )
  })

  it('forwards epicId as an option', async () => {
    const { listTasks, call } = callWith({ epicId: 'epic-1' })
    await call()
    expect(listTasks).toHaveBeenCalledWith(
      expect.objectContaining({ epicId: 'epic-1' })
    )
  })

  it('forwards tag as an option', async () => {
    const { listTasks, call } = callWith({ tag: 'foo' })
    await call()
    expect(listTasks).toHaveBeenCalledWith(expect.objectContaining({ tag: 'foo' }))
  })

  it('forwards search as an option', async () => {
    const { listTasks, call } = callWith({ search: 'alpha' })
    await call()
    expect(listTasks).toHaveBeenCalledWith(expect.objectContaining({ search: 'alpha' }))
  })

  it('forwards status as an option (not as a bare string)', async () => {
    const { listTasks, call } = callWith({ status: 'queued' })
    await call()
    expect(listTasks).toHaveBeenCalledWith(expect.objectContaining({ status: 'queued' }))
  })

  it('composes multiple filters into a single options object', async () => {
    const { listTasks, call } = callWith({ repo: 'bde', tag: 'bar', search: 'thing' })
    await call()
    const options = (listTasks.mock.calls[0][0] ?? {}) as Record<string, unknown>
    expect(options).toMatchObject({ repo: 'bde', tag: 'bar', search: 'thing' })
  })

  it('forwards explicit offset and limit verbatim', async () => {
    const { listTasks, call } = callWith({ offset: 2, limit: 5 })
    await call()
    expect(listTasks).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 2, limit: 5 })
    )
  })

  it('defaults to offset 0 and limit 100 when both omitted', async () => {
    const { listTasks, call } = callWith({})
    await call()
    expect(listTasks).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0, limit: 100 })
    )
  })

  it('returns the rows the data layer produced without further filtering', async () => {
    const { call } = callWith({ repo: 'bde' })
    const res = await call()
    const ids = (JSON.parse(res.content[0].text) as SprintTask[]).map((t) => t.id)
    expect(ids).toEqual(['x'])
  })
})

describe('tasks.history — pagination pushed into the data layer (T-3)', () => {
  const historyRows = Array.from({ length: 10 }, (_, i) => ({
    id: `c${i}`,
    task_id: 't1',
    field: 'status',
    old: 'queued',
    new: 'active',
    changed_at: `2026-04-17T00:00:0${i}.000Z`
  }))

  it('forwards both limit and offset to getTaskChanges verbatim', async () => {
    const getTaskChanges = vi.fn(() => historyRows.slice(2, 5) as any)
    const deps = fakeDeps({ getTaskChanges })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.history', { id: 't1', limit: 3, offset: 2 })
    expect(getTaskChanges).toHaveBeenCalledWith('t1', { limit: 3, offset: 2 })
    const returned = JSON.parse(res.content[0].text)
    // The data layer has already paginated; the tool no longer slices.
    expect(returned).toEqual(historyRows.slice(2, 5))
  })

  it('omits offset when only limit is supplied', async () => {
    const getTaskChanges = vi.fn(() => historyRows.slice(0, 3) as any)
    const deps = fakeDeps({ getTaskChanges })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.history', { id: 't1', limit: 3 })
    expect(getTaskChanges).toHaveBeenCalledWith('t1', { limit: 3, offset: undefined })
    expect(JSON.parse(res.content[0].text)).toEqual(historyRows.slice(0, 3))
  })

  it('forwards empty options when neither limit nor offset is supplied', async () => {
    const getTaskChanges = vi.fn(() => historyRows as any)
    const deps = fakeDeps({ getTaskChanges })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.history', { id: 't1' })
    expect(getTaskChanges).toHaveBeenCalledWith('t1', { limit: undefined, offset: undefined })
    expect(JSON.parse(res.content[0].text)).toEqual(historyRows)
  })

  it('rejects windows exceeding limit + offset <= 500 with ValidationFailed', async () => {
    const getTaskChanges = vi.fn(() => [] as any)
    const deps = fakeDeps({ getTaskChanges })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.history', { id: 't1', limit: 100, offset: 401 })
    const body = parseErrorBody(res)
    expect(body.code).toBe(-32005)
    expect(body.message).toMatch(/exceeds 500/)
    expect(body.data).toMatchObject({ limit: 100, offset: 401, cap: 500 })
    expect(getTaskChanges).not.toHaveBeenCalled()
  })

  it('allows exactly limit + offset === 500', async () => {
    const getTaskChanges = vi.fn(() => [] as any)
    const deps = fakeDeps({ getTaskChanges })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.history', { id: 't1', limit: 100, offset: 400 })
    expect(res.isError).toBeUndefined()
    expect(getTaskChanges).toHaveBeenCalledWith('t1', { limit: 100, offset: 400 })
  })

  it('rejects when default limit (100) + large offset crosses the cap', async () => {
    const getTaskChanges = vi.fn(() => [] as any)
    const deps = fakeDeps({ getTaskChanges })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.history', { id: 't1', offset: 401 })
    const body = parseErrorBody(res)
    expect(body.code).toBe(-32005)
    expect(body.data).toMatchObject({ limit: 100, offset: 401, cap: 500 })
  })
})
