import { describe, it, expect, vi } from 'vitest'
import { batchImportTasks } from '../batch-import'
import type { ISprintTaskRepository } from '../../data/sprint-task-repository'

describe('batchImportTasks', () => {
  it('creates tasks from JSON array and wires deps by index', () => {
    const createdTasks: Array<{ id: string; title: string }> = []
    const repo = {
      createTask: vi.fn((input) => {
        const task = {
          id: `id-${createdTasks.length}`,
          title: input.title,
          repo: input.repo,
          spec: input.spec,
          depends_on: input.depends_on || null
        }
        createdTasks.push(task)
        return task
      })
    } as unknown as ISprintTaskRepository

    const tasks = [
      {
        title: 'Task A',
        repo: 'bde',
        spec: '## Intro\n\n## Details\n\nDo A'
      },
      {
        title: 'Task B',
        repo: 'bde',
        spec: '## Intro\n\n## Details\n\nDo B',
        dependsOnIndices: [0]
      }
    ]
    const result = batchImportTasks(tasks, repo)
    expect(result.created).toHaveLength(2)
    expect(result.errors).toHaveLength(0)
    expect(repo.createTask).toHaveBeenCalledTimes(2)
    // Verify dependency wiring
    expect(result.created[1].depends_on).toEqual([{ id: 'id-0', type: 'hard' }])
  })

  it('validates required fields', () => {
    const repo = {
      createTask: vi.fn()
    } as unknown as ISprintTaskRepository

    const result = batchImportTasks([{ title: '' } as never], repo)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(repo.createTask).not.toHaveBeenCalled()
  })

  it('rejects out-of-range dependency indices', () => {
    const repo = {
      createTask: vi.fn((input) => ({
        id: `id-${Math.random()}`,
        ...input
      }))
    } as unknown as ISprintTaskRepository

    const tasks = [
      {
        title: 'Task A',
        repo: 'bde',
        spec: '## Intro\n\n## Details\n\nDo A',
        dependsOnIndices: [5] // Out of range
      }
    ]
    const result = batchImportTasks(tasks, repo)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain('out of range')
  })

  it('handles soft dependencies', () => {
    const createdTasks: Array<{ id: string; title: string }> = []
    const repo = {
      createTask: vi.fn((input) => {
        const task = {
          id: `id-${createdTasks.length}`,
          title: input.title,
          depends_on: input.depends_on || null
        }
        createdTasks.push(task)
        return task
      })
    } as unknown as ISprintTaskRepository

    const tasks = [
      {
        title: 'Task A',
        repo: 'bde',
        spec: '## Intro\n\n## Details\n\nDo A'
      },
      {
        title: 'Task B',
        repo: 'bde',
        spec: '## Intro\n\n## Details\n\nDo B',
        dependsOnIndices: [0],
        depType: 'soft' as const
      }
    ]
    const result = batchImportTasks(tasks, repo)
    expect(result.created).toHaveLength(2)
    expect(result.created[1].depends_on).toEqual([{ id: 'id-0', type: 'soft' }])
  })

  it('returns null task on creation failure', () => {
    const repo = {
      createTask: vi.fn(() => null) // Simulate failure
    } as unknown as ISprintTaskRepository

    const tasks = [
      {
        title: 'Task A',
        repo: 'bde',
        spec: '## Intro\n\n## Details\n\nDo A'
      }
    ]
    const result = batchImportTasks(tasks, repo)
    expect(result.created).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('Failed to create task')
  })
})
