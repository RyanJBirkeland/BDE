import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTaskWithValidation } from './sprint-service'
import type { CreateTaskInput } from './sprint-service'
import type { SprintTask, TaskGroup } from '../../shared/types'

// sprint-service pulls getDb() indirectly via sprint-mutations. Mock the
// mutation layer so no real DB is required.
vi.mock('./sprint-mutations', () => ({
  createTask: vi.fn(),
  listTasks: vi.fn(() => [] as SprintTask[]),
  getTask: vi.fn(),
  listTasksRecent: vi.fn(),
  getQueueStats: vi.fn(),
  getDoneTodayCount: vi.fn(),
  listTasksWithOpenPrs: vi.fn(),
  getHealthCheckTasks: vi.fn(),
  getSuccessRateBySpecType: vi.fn(),
  getDailySuccessRate: vi.fn(),
  markTaskDoneByPrNumber: vi.fn(),
  markTaskCancelledByPrNumber: vi.fn(),
  updateTaskMergeableState: vi.fn(),
  flagStuckTasks: vi.fn(),
  claimTask: vi.fn(),
  updateTask: vi.fn(),
  forceUpdateTask: vi.fn(),
  deleteTask: vi.fn(),
  releaseTask: vi.fn(),
  createReviewTaskFromAdhoc: vi.fn()
}))
vi.mock('./sprint-mutation-broadcaster', () => ({
  notifySprintMutation: vi.fn(),
  onSprintMutation: vi.fn()
}))
vi.mock('../data/task-group-queries', () => ({
  listGroups: vi.fn(() => [] as TaskGroup[])
}))
vi.mock('../git', () => ({
  getRepoPaths: vi.fn(() => ({ bde: '/fake/path' }))
}))

import * as mutations from './sprint-mutations'

describe('createTaskWithValidation', () => {
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects when repo is not configured', () => {
    const input: CreateTaskInput = { title: 't', repo: 'unknown', status: 'backlog' }
    expect(() => createTaskWithValidation(input, { logger })).toThrow(/not configured/)
    expect(mutations.createTask).not.toHaveBeenCalled()
  })

  it('rejects a queued task whose spec is missing required sections', () => {
    const input: CreateTaskInput = {
      title: 't',
      repo: 'bde',
      status: 'queued',
      spec: 'plain text with no headings'
    }
    expect(() => createTaskWithValidation(input, { logger })).toThrow(/Spec quality/)
    expect(mutations.createTask).not.toHaveBeenCalled()
  })

  it('delegates to sprint-mutations.createTask on valid input and returns the row', () => {
    const fakeRow = { id: 'abc', title: 't', repo: 'bde', status: 'backlog' } as SprintTask
    ;(mutations.createTask as ReturnType<typeof vi.fn>).mockReturnValue(fakeRow)

    const input: CreateTaskInput = { title: 't', repo: 'bde', status: 'backlog' }
    const result = createTaskWithValidation(input, { logger })

    expect(result).toBe(fakeRow)
    expect(mutations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: 't', repo: 'bde' })
    )
  })

  it('applies auto-blocking to queued tasks with unsatisfied hard dependencies', () => {
    ;(mutations.listTasks as ReturnType<typeof vi.fn>).mockReturnValue([
      { id: 'upstream-unfinished', status: 'queued' } as SprintTask
    ])
    ;(mutations.createTask as ReturnType<typeof vi.fn>).mockImplementation(
      (task) => ({ id: 'new-id', ...task }) as SprintTask
    )

    const input: CreateTaskInput = {
      title: 't',
      repo: 'bde',
      status: 'queued',
      spec: [
        '## Overview',
        'Auto-blocking path exercised by this test.',
        '## Files to Change',
        '- src/main/services/sprint-service.ts',
        '## Implementation Steps',
        '1. Create task with hard dep.',
        '## How to Test',
        'Run the vitest suite.'
      ].join('\n'),
      depends_on: [{ id: 'upstream-unfinished', type: 'hard', condition: 'on_success' }]
    }
    createTaskWithValidation(input, { logger })

    expect(mutations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'blocked' })
    )
  })
})
