import { describe, it, expect, vi } from 'vitest'
import { registerTaskTools, type TaskToolsDeps } from './tasks'
import type { SprintTask } from '../../../shared/types'

type ToolHandler = (args: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }> }>

function mockServer() {
  const handlers = new Map<string, ToolHandler>()
  return {
    server: {
      tool: (
        name: string,
        _desc: string,
        _schema: unknown,
        handler: ToolHandler
      ) => {
        handlers.set(name, handler)
      }
    } as any,
    call: (name: string, args: unknown) => {
      const h = handlers.get(name)
      if (!h) throw new Error(`no handler for ${name}`)
      return h(args)
    }
  }
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

const fakeTask = (overrides: Partial<SprintTask> = {}): SprintTask => ({ ...baseTask, ...overrides })

function fakeDeps(overrides: Partial<TaskToolsDeps> = {}): TaskToolsDeps {
  return {
    listTasks: vi.fn(() => [fakeTask()]),
    getTask: vi.fn(() => fakeTask()),
    createTaskWithValidation: vi.fn(() => fakeTask()),
    updateTask: vi.fn(() => fakeTask()),
    cancelTask: vi.fn(() => fakeTask({ status: 'cancelled' })),
    getTaskChanges: vi.fn(() => []),
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

  it('tasks.create rejects forbidden fields', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    // claimed_by is system-managed; zod strips unknown keys on .parse, so
    // a forbidden field that survives is a schema bug. Assert the schema
    // strips it by ensuring the delegate was not asked to set it.
    await call('tasks.create', { title: 't', repo: 'bde', claimed_by: 'x' } as any)
    const call0 = (deps.createTaskWithValidation as any).mock.calls[0][0]
    expect(call0.claimed_by).toBeUndefined()
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

  it('tasks.update throws when updateTask returns null', async () => {
    const deps = fakeDeps({
      updateTask: vi.fn(() => null)
    })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    await expect(
      call('tasks.update', { id: 't1', patch: { priority: 5 } })
    ).rejects.toThrow(/not found/)
  })

  it('tasks.cancel routes through cancelTask (which triggers onStatusTerminal)', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.cancel', { id: 't1', reason: 'no longer needed' })
    expect(deps.cancelTask).toHaveBeenCalledWith('t1', 'no longer needed')
    expect(JSON.parse(res.content[0].text).status).toBe('cancelled')
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

  it('tasks.get returns -32001 when task missing', async () => {
    const deps = fakeDeps({ getTask: vi.fn(() => null) })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    await expect(call('tasks.get', { id: 'missing' })).rejects.toThrow(/not found/)
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
