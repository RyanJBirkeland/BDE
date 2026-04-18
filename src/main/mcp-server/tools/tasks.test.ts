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

const fakeTask = (overrides: Partial<SprintTask> = {}): SprintTask => ({
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
  duration_ms: null,
  ...(overrides as SprintTask)
}) as SprintTask

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
