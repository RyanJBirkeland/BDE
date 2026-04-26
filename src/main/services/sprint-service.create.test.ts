import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTaskWithValidation, TaskValidationError } from './sprint-service'
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
// Phase-5 audit: createTaskWithValidation now imports getRepoPaths from ../paths
// (the canonical owner). The legacy ../git mock stays for any consumer that
// has not migrated yet.
vi.mock('../paths', async () => {
  const actual = await vi.importActual<typeof import('../paths')>('../paths')
  return {
    ...actual,
    getRepoPaths: vi.fn(() => ({ bde: '/fake/path' }))
  }
})

import * as mutations from './sprint-mutations'
import * as git from '../git'
import * as paths from '../paths'

describe('createTaskWithValidation', () => {
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects when repo is not configured', async () => {
    const input: CreateTaskInput = { title: 't', repo: 'unknown', status: 'backlog' }
    await expect(createTaskWithValidation(input, { logger })).rejects.toThrow(/not configured/)
    expect(mutations.createTask).not.toHaveBeenCalled()
  })

  it('rejects a queued task whose spec is missing required sections', async () => {
    const input: CreateTaskInput = {
      title: 't',
      repo: 'bde',
      status: 'queued',
      spec: 'plain text with no headings'
    }
    await expect(createTaskWithValidation(input, { logger })).rejects.toThrow(/Spec quality/)
    expect(mutations.createTask).not.toHaveBeenCalled()
  })

  it('delegates to sprint-mutations.createTask on valid input and returns the row', async () => {
    const fakeRow = { id: 'abc', title: 't', repo: 'bde', status: 'backlog' } as SprintTask
    ;(mutations.createTask as ReturnType<typeof vi.fn>).mockReturnValue(fakeRow)

    const input: CreateTaskInput = { title: 't', repo: 'bde', status: 'backlog' }
    const result = await createTaskWithValidation(input, { logger })

    expect(result).toBe(fakeRow)
    expect(mutations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: 't', repo: 'bde' })
    )
  })

  describe('skipReadinessCheck', () => {
    it('rejects a queued task with insufficient headings by default', async () => {
      const input: CreateTaskInput = {
        title: 'no sections',
        repo: 'bde',
        status: 'queued',
        spec: '## Only one\nbody'
      }
      await expect(createTaskWithValidation(input, { logger })).rejects.toThrow(/spec|section/i)
    })

    it('accepts the same task when skipReadinessCheck is true', async () => {
      const fakeRow = { id: 'bypass', title: 'no sections', repo: 'bde' } as SprintTask
      ;(mutations.createTask as ReturnType<typeof vi.fn>).mockReturnValue(fakeRow)

      const warn = vi.fn()
      const input: CreateTaskInput = {
        title: 'no sections',
        repo: 'bde',
        status: 'queued',
        spec: '## Only one\nbody'
      }
      const row = await createTaskWithValidation(
        input,
        { logger: { ...logger, warn } },
        { skipReadinessCheck: true }
      )
      expect(row).toBe(fakeRow)
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skipReadinessCheck/))
    })

    it('still enforces required fields even with skipReadinessCheck', async () => {
      const input = { title: '', repo: 'bde' } as CreateTaskInput
      await expect(
        createTaskWithValidation(input, { logger }, { skipReadinessCheck: true })
      ).rejects.toThrow(/title/i)
    })

    it('still enforces repo configuration even with skipReadinessCheck', async () => {
      const input: CreateTaskInput = { title: 't', repo: 'unknown' }
      await expect(
        createTaskWithValidation(input, { logger }, { skipReadinessCheck: true })
      ).rejects.toThrow(/not configured/)
    })
  })

  describe('error codes', () => {
    it('structural validation failures throw TaskValidationError with code spec-structural', async () => {
      const input = { title: '', repo: 'bde' } as CreateTaskInput
      await expect(createTaskWithValidation(input, { logger })).rejects.toMatchObject({
        code: 'spec-structural',
        message: expect.any(String)
      })
    })

    it('required-sections failures throw TaskValidationError with code spec-readiness', async () => {
      // Passes Tier-1 (≥2 headings, ≥50 chars) but fails Tier-2 because none
      // of the required sections (Overview, Files to Change, Implementation
      // Steps, How to Test) are present.
      const input: CreateTaskInput = {
        title: 't',
        repo: 'bde',
        status: 'queued',
        spec: [
          '## Background',
          'This spec is intentionally padded so it clears the minimum spec length floor.',
          '## Context',
          'It has two markdown headings but none match the required-sections allowlist.'
        ].join('\n')
      }
      await expect(createTaskWithValidation(input, { logger })).rejects.toMatchObject({
        code: 'spec-readiness'
      })
    })

    it('missing-repo failures throw TaskValidationError with code repo-not-configured', async () => {
      ;(git.getRepoPaths as ReturnType<typeof vi.fn>).mockReturnValueOnce({})
      ;(paths.getRepoPaths as ReturnType<typeof vi.fn>).mockReturnValueOnce({})
      const input: CreateTaskInput = { title: 't', repo: 'bde' }
      await expect(createTaskWithValidation(input, { logger })).rejects.toMatchObject({
        code: 'repo-not-configured'
      })
    })
  })

  it('applies auto-blocking to queued tasks with unsatisfied hard dependencies', async () => {
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
    await createTaskWithValidation(input, { logger })

    expect(mutations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'blocked' })
    )
  })
})
