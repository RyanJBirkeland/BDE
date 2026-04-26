import { describe, it, expect, vi } from 'vitest'
import {
  refreshDependencyIndex,
  computeDepsFingerprint,
  type DepsFingerprint
} from '../dependency-refresher'
import type { DependencyIndex } from '../../services/dependency-service'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'
import type { Logger } from '../../logger'
import type { TaskDependency } from '../../../shared/types'

function makeDepIndex(): DependencyIndex {
  return {
    update: vi.fn(),
    remove: vi.fn(),
    rebuild: vi.fn(),
    isUnblocked: vi.fn().mockReturnValue(true),
    getDependents: vi.fn().mockReturnValue([])
  } as unknown as DependencyIndex
}

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    event: vi.fn()
  } as unknown as Logger
}

function makeRepo(
  rows: Array<{ id: string; depends_on: TaskDependency[] | null; status: string }>
): IAgentTaskRepository {
  return {
    getTasksWithDependencies: vi.fn().mockReturnValue(rows)
  } as unknown as IAgentTaskRepository
}

function seedFingerprints(
  rows: Array<{ id: string; depends_on: TaskDependency[] | null }>
): DepsFingerprint {
  const map: DepsFingerprint = new Map()
  for (const row of rows) {
    map.set(row.id, {
      deps: row.depends_on,
      hash: computeDepsFingerprint(row.depends_on)
    })
  }
  return map
}

describe('refreshDependencyIndex (dirty-set hint)', () => {
  it('skips dep-index updates for cached tasks not in the dirty set', () => {
    const rows = [
      { id: 'task-a', depends_on: null, status: 'queued' },
      { id: 'task-b', depends_on: null, status: 'queued' }
    ]
    const repo = makeRepo(rows)
    const depIndex = makeDepIndex()
    const fingerprints = seedFingerprints(rows)
    const dirty = new Set<string>(['task-a'])

    refreshDependencyIndex(depIndex, fingerprints, repo, makeLogger(), dirty)

    // No fingerprint changed; with the dirty hint, only task-a is even
    // considered, and even task-a's hash already matches — neither task should
    // touch the dep-index.
    expect(depIndex.update).not.toHaveBeenCalled()
  })

  it('still updates a dirty task when its fingerprint differs', () => {
    const rows = [
      {
        id: 'task-a',
        depends_on: [{ id: 'upstream-1', type: 'hard' as const }],
        status: 'queued'
      },
      { id: 'task-b', depends_on: null, status: 'queued' }
    ]
    const repo = makeRepo(rows)
    const depIndex = makeDepIndex()
    // Seed task-a with a stale fingerprint so the refresh detects a change.
    const fingerprints: DepsFingerprint = new Map([
      ['task-a', { deps: null, hash: '' }],
      ['task-b', { deps: null, hash: computeDepsFingerprint(null) }]
    ])
    const dirty = new Set<string>(['task-a'])

    refreshDependencyIndex(depIndex, fingerprints, repo, makeLogger(), dirty)

    expect(depIndex.update).toHaveBeenCalledWith('task-a', rows[0].depends_on)
    expect(depIndex.update).toHaveBeenCalledTimes(1)
  })

  it('still updates an uncached task even when not in the dirty set', () => {
    const rows = [
      {
        id: 'new-task',
        depends_on: [{ id: 'upstream-1', type: 'hard' as const }],
        status: 'queued'
      }
    ]
    const repo = makeRepo(rows)
    const depIndex = makeDepIndex()
    const fingerprints: DepsFingerprint = new Map()
    const dirty = new Set<string>() // empty — but uncached tasks must still write

    refreshDependencyIndex(depIndex, fingerprints, repo, makeLogger(), dirty)

    expect(depIndex.update).toHaveBeenCalledWith('new-task', rows[0].depends_on)
  })

  it('still evicts terminal tasks from fingerprints regardless of dirty set', () => {
    const rows = [{ id: 'task-done', depends_on: null, status: 'done' }]
    const repo = makeRepo(rows)
    const depIndex = makeDepIndex()
    const fingerprints: DepsFingerprint = new Map([
      ['task-done', { deps: null, hash: '' }]
    ])

    refreshDependencyIndex(depIndex, fingerprints, repo, makeLogger(), new Set<string>())

    expect(fingerprints.has('task-done')).toBe(false)
  })
})
