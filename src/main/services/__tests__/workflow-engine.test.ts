import { describe, it, expect, vi } from 'vitest'
import { instantiateWorkflow } from '../workflow-engine'
import type { WorkflowTemplate } from '../../../shared/workflow-types'
import type { IDashboardRepository } from '../../data/sprint-task-repository'
import type { SprintTask } from '../../../shared/types'
import { nowIso } from '../../../shared/time'

describe('workflow-engine', () => {
  function createMockRepo(): IDashboardRepository {
    let idCounter = 1
    const mockCreateTask = vi.fn(async (input) => {
      if (!input.title) return null
      return {
        id: `task-${idCounter++}`,
        title: input.title,
        repo: input.repo,
        status: input.status || 'backlog',
        depends_on: input.depends_on || null,
        prompt: input.prompt || null,
        spec: input.spec || null,
        playground_enabled: input.playground_enabled || false,
        model: input.model || null,
        created_at: nowIso(),
        updated_at: nowIso()
      } as SprintTask
    })

    return {
      createTask: mockCreateTask,
      listTasks: vi.fn(),
      listTasksRecent: vi.fn(),
      deleteTask: vi.fn(),
      releaseTask: vi.fn(),
      getQueueStats: vi.fn(),
      getDoneTodayCount: vi.fn(),
      getHealthCheckTasks: vi.fn(),
      getSuccessRateBySpecType: vi.fn(),
      createReviewTaskFromAdhoc: vi.fn(),
      getDailySuccessRate: vi.fn(),
      getFailureReasonBreakdown: vi.fn()
    }
  }

  it('should create tasks with no dependencies', async () => {
    const template: WorkflowTemplate = {
      name: 'Test Workflow',
      description: 'A simple workflow',
      steps: [
        { title: 'Step 1', repo: 'BDE', spec: 'Do task 1' },
        { title: 'Step 2', repo: 'BDE', prompt: 'Do task 2' }
      ]
    }

    const repo = createMockRepo()
    const result = await instantiateWorkflow(template, repo)

    expect(result.errors).toEqual([])
    expect(result.tasks).toHaveLength(2)
    expect(result.tasks[0].title).toBe('[Test Workflow] Step 1')
    expect(result.tasks[0].status).toBe('backlog')
    expect(result.tasks[0].depends_on).toBeNull()
    expect(result.tasks[1].title).toBe('[Test Workflow] Step 2')
    expect(result.tasks[1].status).toBe('backlog')
    expect(result.tasks[1].depends_on).toBeNull()
  })

  it('should create tasks with hard dependencies', async () => {
    const template: WorkflowTemplate = {
      name: 'Dependency Test',
      description: 'Test hard dependencies',
      steps: [
        { title: 'Base Task', repo: 'BDE', spec: 'Base' },
        { title: 'Dependent Task', repo: 'BDE', spec: 'Depends on 0', dependsOnSteps: [0] }
      ]
    }

    const repo = createMockRepo()
    const result = await instantiateWorkflow(template, repo)

    expect(result.errors).toEqual([])
    expect(result.tasks).toHaveLength(2)
    expect(result.tasks[1].status).toBe('blocked')
    expect(result.tasks[1].depends_on).toEqual([{ id: 'task-1', type: 'hard' }])
  })

  it('should create tasks with soft dependencies', async () => {
    const template: WorkflowTemplate = {
      name: 'Soft Dep Test',
      description: 'Test soft dependencies',
      steps: [
        { title: 'Base Task', repo: 'BDE', spec: 'Base' },
        {
          title: 'Soft Dependent',
          repo: 'BDE',
          spec: 'Soft depends on 0',
          dependsOnSteps: [0],
          depType: 'soft'
        }
      ]
    }

    const repo = createMockRepo()
    const result = await instantiateWorkflow(template, repo)

    expect(result.errors).toEqual([])
    expect(result.tasks).toHaveLength(2)
    expect(result.tasks[1].status).toBe('blocked')
    expect(result.tasks[1].depends_on).toEqual([{ id: 'task-1', type: 'soft' }])
  })

  it('should handle multiple dependencies', async () => {
    const template: WorkflowTemplate = {
      name: 'Multi Dep',
      description: 'Multiple dependencies',
      steps: [
        { title: 'Task A', repo: 'BDE', spec: 'A' },
        { title: 'Task B', repo: 'BDE', spec: 'B' },
        {
          title: 'Task C',
          repo: 'BDE',
          spec: 'C depends on A and B',
          dependsOnSteps: [0, 1]
        }
      ]
    }

    const repo = createMockRepo()
    const result = await instantiateWorkflow(template, repo)

    expect(result.errors).toEqual([])
    expect(result.tasks).toHaveLength(3)
    expect(result.tasks[2].depends_on).toEqual([
      { id: 'task-1', type: 'hard' },
      { id: 'task-2', type: 'hard' }
    ])
  })

  it('should report error for out-of-range dependency index', async () => {
    const template: WorkflowTemplate = {
      name: 'Invalid Dep',
      description: 'Out of range dependency',
      steps: [
        { title: 'Task A', repo: 'BDE', spec: 'A' },
        {
          title: 'Task B',
          repo: 'BDE',
          spec: 'B depends on non-existent task',
          dependsOnSteps: [5] // Out of range
        }
      ]
    }

    const repo = createMockRepo()
    const result = await instantiateWorkflow(template, repo)

    expect(result.errors).toContain('Step 1: dependsOnSteps[5] out of range')
    expect(result.tasks).toHaveLength(2)
    // Task should still be created, just without the invalid dependency
    expect(result.tasks[1].depends_on).toBeNull()
  })

  it('should report error for negative dependency index', async () => {
    const template: WorkflowTemplate = {
      name: 'Negative Dep',
      description: 'Negative dependency index',
      steps: [
        { title: 'Task A', repo: 'BDE', spec: 'A' },
        {
          title: 'Task B',
          repo: 'BDE',
          spec: 'B',
          dependsOnSteps: [-1]
        }
      ]
    }

    const repo = createMockRepo()
    const result = await instantiateWorkflow(template, repo)

    expect(result.errors).toContain('Step 1: dependsOnSteps[-1] out of range')
  })

  it('should stop on createTask failure', async () => {
    const template: WorkflowTemplate = {
      name: 'Fail Test',
      description: 'Test createTask failure',
      steps: [
        { title: 'Task A', repo: 'BDE', spec: 'A' },
        { title: 'Task B', repo: 'BDE', spec: 'B' },
        { title: 'Task C', repo: 'BDE', spec: 'C' }
      ]
    }

    // Create a mock repo that fails on the second task
    const failingRepo: IDashboardRepository = {
      createTask: vi.fn(async (input) => {
        const callCount = (failingRepo.createTask as ReturnType<typeof vi.fn>).mock.calls.length
        if (callCount === 2) return null // Fail on second call
        return {
          id: `task-${callCount}`,
          title: input.title,
          repo: input.repo,
          status: input.status || 'backlog',
          depends_on: input.depends_on || null,
          prompt: input.prompt || null,
          spec: input.spec || null,
          playground_enabled: input.playground_enabled || false,
          model: input.model || null,
          created_at: nowIso(),
          updated_at: nowIso()
        } as SprintTask
      }),
      listTasks: vi.fn(),
      listTasksRecent: vi.fn(),
      deleteTask: vi.fn(),
      releaseTask: vi.fn(),
      getQueueStats: vi.fn(),
      getDoneTodayCount: vi.fn(),
      getHealthCheckTasks: vi.fn(),
      getSuccessRateBySpecType: vi.fn(),
      createReviewTaskFromAdhoc: vi.fn(),
      getDailySuccessRate: vi.fn(),
      getFailureReasonBreakdown: vi.fn()
    }

    const result = await instantiateWorkflow(template, failingRepo)

    expect(result.errors).toContain('Step 1: createTask failed for "Task B"')
    expect(result.tasks).toHaveLength(1) // Only first task created
  })

  it('should pass through playground_enabled flag', async () => {
    const template: WorkflowTemplate = {
      name: 'Playground Test',
      description: 'Test playground flag',
      steps: [{ title: 'Task A', repo: 'BDE', spec: 'A', playgroundEnabled: true }]
    }

    const repo = createMockRepo()
    const result = await instantiateWorkflow(template, repo)

    expect(result.errors).toEqual([])
    expect(result.tasks[0].playground_enabled).toBe(true)
  })

  it('should pass through model field', async () => {
    const template: WorkflowTemplate = {
      name: 'Model Test',
      description: 'Test model field',
      steps: [{ title: 'Task A', repo: 'BDE', spec: 'A', model: 'opus' }]
    }

    const repo = createMockRepo()
    const result = await instantiateWorkflow(template, repo)

    expect(result.errors).toEqual([])
    expect(result.tasks[0].model).toBe('opus')
  })

  it('should handle empty workflow', async () => {
    const template: WorkflowTemplate = {
      name: 'Empty',
      description: 'Empty workflow',
      steps: []
    }

    const repo = createMockRepo()
    const result = await instantiateWorkflow(template, repo)

    expect(result.errors).toEqual([])
    expect(result.tasks).toHaveLength(0)
  })
})
