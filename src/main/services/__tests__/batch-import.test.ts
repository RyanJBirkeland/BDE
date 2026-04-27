import { describe, it, expect, vi, beforeEach } from 'vitest'
import { batchImportTasks } from '../batch-import'
import type { IDashboardRepository } from '../../data/sprint-task-repository'

describe('batchImportTasks', () => {
  it('creates tasks from JSON array and wires deps by index', async () => {
    const createdTasks: Array<{ id: string; title: string }> = []
    const repo = {
      createTask: vi.fn(async (input) => {
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
    } as unknown as IDashboardRepository

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
    const result = await batchImportTasks(tasks, repo)
    expect(result.created).toHaveLength(2)
    expect(result.errors).toHaveLength(0)
    expect(repo.createTask).toHaveBeenCalledTimes(2)
    // Verify dependency wiring
    expect(result.created[1].depends_on).toEqual([{ id: 'id-0', type: 'hard' }])
  })

  it('validates required fields', async () => {
    const repo = {
      createTask: vi.fn()
    } as unknown as IDashboardRepository

    const result = await batchImportTasks([{ title: '' } as never], repo)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(repo.createTask).not.toHaveBeenCalled()
  })

  it('rejects out-of-range dependency indices', async () => {
    const repo = {
      createTask: vi.fn(async (input) => ({
        id: `id-${Math.random()}`,
        ...input
      }))
    } as unknown as IDashboardRepository

    const tasks = [
      {
        title: 'Task A',
        repo: 'bde',
        spec: '## Intro\n\n## Details\n\nDo A',
        dependsOnIndices: [5] // Out of range
      }
    ]
    const result = await batchImportTasks(tasks, repo)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain('out of range')
  })

  it('handles soft dependencies', async () => {
    const createdTasks: Array<{ id: string; title: string }> = []
    const repo = {
      createTask: vi.fn(async (input) => {
        const task = {
          id: `id-${createdTasks.length}`,
          title: input.title,
          depends_on: input.depends_on || null
        }
        createdTasks.push(task)
        return task
      })
    } as unknown as IDashboardRepository

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
    const result = await batchImportTasks(tasks, repo)
    expect(result.created).toHaveLength(2)
    expect(result.created[1].depends_on).toEqual([{ id: 'id-0', type: 'soft' }])
  })

  it('returns null task on creation failure', async () => {
    const repo = {
      createTask: vi.fn(async () => null) // Simulate failure
    } as unknown as IDashboardRepository

    const tasks = [
      {
        title: 'Task A',
        repo: 'bde',
        spec: '## Intro\n\n## Details\n\nDo A'
      }
    ]
    const result = await batchImportTasks(tasks, repo)
    expect(result.created).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('Failed to create task')
  })

  describe('repo validation against configuredRepos', () => {
    const mockRepo = {
      createTask: vi.fn().mockImplementation(async (input) => ({ id: 'generated-id', ...input }))
    } as unknown as IDashboardRepository

    beforeEach(() => vi.clearAllMocks())

    it('creates tasks when repo is valid', async () => {
      const result = await batchImportTasks([{ title: 'Task A', repo: 'bde' }], mockRepo, [
        'bde',
        'life-os'
      ])
      expect(result.errors).toHaveLength(0)
      expect(result.created).toHaveLength(1)
    })

    it('rejects tasks with unconfigured repo when configuredRepos provided', async () => {
      const result = await batchImportTasks([{ title: 'Task A', repo: 'unknown-repo' }], mockRepo, [
        'bde',
        'life-os'
      ])
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toMatch(/unknown-repo.*not configured/i)
      expect(result.created).toHaveLength(0)
      expect(mockRepo.createTask).not.toHaveBeenCalled()
    })

    it('repo comparison is case-insensitive', async () => {
      const result = await batchImportTasks([{ title: 'Task A', repo: 'BDE' }], mockRepo, ['bde'])
      expect(result.errors).toHaveLength(0)
    })

    it('skips repo validation when configuredRepos is undefined (backward compat)', async () => {
      const result = await batchImportTasks([{ title: 'Task A', repo: 'any-repo' }], mockRepo)
      expect(result.errors).toHaveLength(0)
    })

    it('rejects all tasks when configuredRepos is empty array', async () => {
      const result = await batchImportTasks([{ title: 'Task A', repo: 'bde' }], mockRepo, [])
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toMatch(/not configured.*No repos are configured/i)
      expect(result.created).toHaveLength(0)
      expect(mockRepo.createTask).not.toHaveBeenCalled()
    })
  })
})
