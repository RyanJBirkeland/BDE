import { describe, it, expect, beforeEach } from 'vitest'
import { useTaskWorkbenchStore } from '../taskWorkbench'

describe('taskWorkbench store', () => {
  beforeEach(() => {
    useTaskWorkbenchStore.getState().resetForm()
  })

  it('has correct defaults', () => {
    const s = useTaskWorkbenchStore.getState()
    expect(s.mode).toBe('create')
    expect(s.taskId).toBeNull()
    expect(s.title).toBe('')
    expect(s.repo).toBe('BDE')
    expect(s.priority).toBe(3)
    expect(s.spec).toBe('')
    expect(s.copilotVisible).toBe(true)
    expect(s.copilotMessages).toHaveLength(1)
    expect(s.copilotMessages[0].role).toBe('system')
  })

  it('setField updates a single field', () => {
    useTaskWorkbenchStore.getState().setField('title', 'Fix auth bug')
    expect(useTaskWorkbenchStore.getState().title).toBe('Fix auth bug')
  })

  it('setField updates repo', () => {
    useTaskWorkbenchStore.getState().setField('repo', 'life-os')
    expect(useTaskWorkbenchStore.getState().repo).toBe('life-os')
  })

  it('resetForm restores defaults', () => {
    const store = useTaskWorkbenchStore.getState()
    store.setField('title', 'Something')
    store.setField('spec', 'Some spec')
    store.resetForm()
    const s = useTaskWorkbenchStore.getState()
    expect(s.title).toBe('')
    expect(s.spec).toBe('')
    expect(s.mode).toBe('create')
  })

  it('loadTask populates form from SprintTask', () => {
    useTaskWorkbenchStore.getState().loadTask({
      id: 'task-123',
      title: 'Existing task',
      repo: 'life-os',
      priority: 2,
      spec: '## Problem\nSomething',
      prompt: null,
      notes: null,
      status: 'backlog',
      retry_count: 0,
      fast_fail_count: 0,
      agent_run_id: null,
      pr_number: null,
      pr_status: null,
      pr_url: null,
      claimed_by: null,
      started_at: null,
      completed_at: null,
      template_name: null,
      depends_on: null,
      updated_at: '2026-01-01',
      created_at: '2026-01-01'
    })
    const s = useTaskWorkbenchStore.getState()
    expect(s.mode).toBe('edit')
    expect(s.taskId).toBe('task-123')
    expect(s.title).toBe('Existing task')
    expect(s.repo).toBe('life-os')
    expect(s.priority).toBe(2)
    expect(s.spec).toBe('## Problem\nSomething')
  })

  it('loadTask clears stale checks', () => {
    useTaskWorkbenchStore
      .getState()
      .setSemanticChecks([{ id: 'old', label: 'Old', tier: 2, status: 'pass', message: 'stale' }])
    useTaskWorkbenchStore.getState().loadTask({
      id: 'task-456',
      title: 'New task',
      repo: 'BDE',
      priority: 3,
      spec: '',
      prompt: null,
      notes: null,
      status: 'backlog',
      retry_count: 0,
      fast_fail_count: 0,
      agent_run_id: null,
      pr_number: null,
      pr_status: null,
      pr_url: null,
      claimed_by: null,
      started_at: null,
      completed_at: null,
      template_name: null,
      depends_on: null,
      updated_at: '2026-01-01',
      created_at: '2026-01-01'
    })
    expect(useTaskWorkbenchStore.getState().semanticChecks).toHaveLength(0)
    expect(useTaskWorkbenchStore.getState().operationalChecks).toHaveLength(0)
  })

  it('toggleCopilot flips visibility', () => {
    expect(useTaskWorkbenchStore.getState().copilotVisible).toBe(true)
    useTaskWorkbenchStore.getState().toggleCopilot()
    expect(useTaskWorkbenchStore.getState().copilotVisible).toBe(false)
  })

  it('addCopilotMessage appends to messages', () => {
    const before = useTaskWorkbenchStore.getState().copilotMessages.length
    useTaskWorkbenchStore.getState().addCopilotMessage({
      id: 'test-1',
      role: 'user',
      content: 'Hello',
      timestamp: Date.now()
    })
    expect(useTaskWorkbenchStore.getState().copilotMessages).toHaveLength(before + 1)
  })
})
