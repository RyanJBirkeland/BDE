import { describe, it, expect, beforeEach } from 'vitest'
import type { SprintTask } from '../../../../shared/types'
import { useTaskWorkbenchModalStore } from '../taskWorkbenchModal'
import { useTaskWorkbenchStore } from '../taskWorkbench'

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: 'task-42',
    title: 'Edit me',
    repo: 'bde',
    status: 'queued',
    pr_url: null,
    pr_number: null,
    pr_status: null,
    completed_at: null,
    description: null,
    spec: 'spec body',
    branch: null,
    notes: null,
    created_at: '2026-04-24T00:00:00Z',
    updated_at: '2026-04-24T00:00:00Z',
    started_at: null,
    depends_on: [],
    claimed_by: null,
    agent_run_id: null,
    priority: 2,
    fast_fail_count: 0,
    max_runtime_ms: null,
    ...overrides
  } as SprintTask
}

describe('taskWorkbenchModal store', () => {
  beforeEach(() => {
    useTaskWorkbenchModalStore.setState({
      open: false,
      editingTask: null
    })
    useTaskWorkbenchStore.getState().resetForm()
  })

  it('starts closed with no editing target', () => {
    const s = useTaskWorkbenchModalStore.getState()
    expect(s.open).toBe(false)
    expect(s.editingTask).toBeNull()
  })

  it('openForCreate opens the modal in create mode and resets the form', () => {
    useTaskWorkbenchStore.getState().setField('title', 'leftover draft')
    useTaskWorkbenchModalStore.getState().openForCreate()
    expect(useTaskWorkbenchModalStore.getState().open).toBe(true)
    expect(useTaskWorkbenchModalStore.getState().editingTask).toBeNull()
    expect(useTaskWorkbenchStore.getState().title).toBe('')
  })

  it('openForCreate applies pendingGroupId preset', () => {
    useTaskWorkbenchModalStore.getState().openForCreate({ groupId: 'group-7' })
    expect(useTaskWorkbenchStore.getState().pendingGroupId).toBe('group-7')
  })

  it('openForEdit opens the modal and loads the task into the form', () => {
    const task = makeTask({ id: 'task-99', title: 'Real edit', spec: 'hello' })
    useTaskWorkbenchModalStore.getState().openForEdit(task)
    const modal = useTaskWorkbenchModalStore.getState()
    expect(modal.open).toBe(true)
    expect(modal.editingTask).toEqual(task)
    const form = useTaskWorkbenchStore.getState()
    expect(form.mode).toBe('edit')
    expect(form.taskId).toBe('task-99')
    expect(form.title).toBe('Real edit')
    expect(form.spec).toBe('hello')
  })

  it('close hides the modal', () => {
    useTaskWorkbenchModalStore.getState().openForEdit(makeTask())
    useTaskWorkbenchModalStore.getState().close()
    expect(useTaskWorkbenchModalStore.getState().open).toBe(false)
  })
})
