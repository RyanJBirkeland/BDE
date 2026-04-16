import { describe, it, expect, beforeEach } from 'vitest'
import { useTaskWorkbenchStore } from '../taskWorkbench'
import { useTaskWorkbenchValidation } from '../taskWorkbenchValidation'

describe('taskWorkbench store', () => {
  beforeEach(() => {
    useTaskWorkbenchStore.getState().resetForm()
  })

  it('has correct defaults', () => {
    const s = useTaskWorkbenchStore.getState()
    expect(s.mode).toBe('create')
    expect(s.taskId).toBeNull()
    expect(s.title).toBe('')
    expect(s.repo).toBe('')
    expect(s.priority).toBe(3)
    expect(s.spec).toBe('')
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
    useTaskWorkbenchValidation
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
    expect(useTaskWorkbenchValidation.getState().semanticChecks).toHaveLength(0)
    expect(useTaskWorkbenchValidation.getState().operationalChecks).toHaveLength(0)
  })

  it('isDirty returns false in pristine create mode', () => {
    const s = useTaskWorkbenchStore.getState()
    expect(s.isDirty()).toBe(false)
  })

  it('isDirty returns false when no changes in edit mode', () => {
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
    expect(s.isDirty()).toBe(false)
  })

  it('isDirty returns true when title changes in edit mode', () => {
    useTaskWorkbenchStore.getState().loadTask({
      id: 'task-123',
      title: 'Original title',
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
    useTaskWorkbenchStore.getState().setField('title', 'Modified title')
    const s = useTaskWorkbenchStore.getState()
    expect(s.isDirty()).toBe(true)
  })

  it('isDirty returns true when spec changes in edit mode', () => {
    useTaskWorkbenchStore.getState().loadTask({
      id: 'task-123',
      title: 'Task',
      repo: 'life-os',
      priority: 2,
      spec: '## Original spec',
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
    useTaskWorkbenchStore.getState().setField('spec', '## Modified spec')
    const s = useTaskWorkbenchStore.getState()
    expect(s.isDirty()).toBe(true)
  })

  it('isDirty detects dependency changes in edit mode', () => {
    useTaskWorkbenchStore.getState().loadTask({
      id: 'task-123',
      title: 'Task',
      repo: 'life-os',
      priority: 2,
      spec: '## Spec',
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
      depends_on: [{ id: 'dep-1', type: 'hard' }],
      updated_at: '2026-01-01',
      created_at: '2026-01-01'
    })
    useTaskWorkbenchStore.getState().setField('dependsOn', [
      { id: 'dep-1', type: 'hard' },
      { id: 'dep-2', type: 'soft' }
    ])
    const s = useTaskWorkbenchStore.getState()
    expect(s.isDirty()).toBe(true)
  })
})
