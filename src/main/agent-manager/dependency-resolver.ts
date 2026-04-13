import type { Logger } from '../logger'
import type { TaskDependency } from '../../shared/types'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import { createDependencyIndex, type DependencyIndex } from '../services/dependency-service'
import {
  createEpicDependencyIndex,
  type EpicDependencyIndex
} from '../services/epic-dependency-service'
import { isTerminal } from '../../shared/task-state-machine'

/**
 * DependencyResolver manages task and epic dependency indexes.
 * Handles initialization, incremental updates, and fingerprint caching.
 */
export interface DependencyResolver {
  readonly depIndex: DependencyIndex
  readonly epicIndex: EpicDependencyIndex

  /**
   * Initialize dependency indexes from repository data.
   * Called once at agent manager start.
   */
  initialize(): void

  /**
   * Incrementally update dependency indexes based on current task state.
   * Returns a Map of taskId -> status for dependency checking.
   */
  updateIndexes(): Map<string, string>
}

export interface DependencyResolverDeps {
  repo: ISprintTaskRepository
  logger: Logger
}

export class DependencyResolverImpl implements DependencyResolver {
  readonly depIndex: DependencyIndex
  readonly epicIndex: EpicDependencyIndex

  // F-t1-sysprof-1/-4: Cache stable fingerprints to avoid deep-compare on every drain tick
  private readonly lastTaskDeps = new Map<string, { deps: TaskDependency[] | null; hash: string }>()

  constructor(private readonly deps: DependencyResolverDeps) {
    this.depIndex = createDependencyIndex()
    this.epicIndex = createEpicDependencyIndex()
  }

  initialize(): void {
    try {
      const tasks = this.deps.repo.getTasksWithDependencies()
      this.depIndex.rebuild(tasks)

      const groups = this.deps.repo.getGroupsWithDependencies()
      this.epicIndex.rebuild(groups)

      // Initialize fingerprint cache to avoid false positives on first drain
      this.lastTaskDeps.clear()
      for (const task of tasks) {
        const deps = task.depends_on ?? null
        this.lastTaskDeps.set(task.id, {
          deps,
          hash: DependencyResolverImpl.depsFingerprint(deps)
        })
      }

      this.deps.logger.info(
        `[dependency-resolver] Indexes built with ${tasks.length} tasks and ${groups.length} groups`
      )
    } catch (err) {
      this.deps.logger.error(`[dependency-resolver] Failed to build indexes: ${err}`)
    }
  }

  updateIndexes(): Map<string, string> {
    let taskStatusMap = new Map<string, string>()

    try {
      const allTasks = this.deps.repo.getTasksWithDependencies()
      const currentTaskIds = new Set(allTasks.map((t) => t.id))

      // Remove deleted tasks from index
      for (const oldId of this.lastTaskDeps.keys()) {
        if (!currentTaskIds.has(oldId)) {
          this.depIndex.remove(oldId)
          this.lastTaskDeps.delete(oldId)
        }
      }

      // Update tasks with changed dependencies.
      // F-t1-sysprof-1/-4: Compare cached fingerprints — avoids re-sorting
      // the unchanged-deps case (the common path for most drain ticks).
      // F-t1-sre-6: Evict terminal-status tasks from lastTaskDeps — their deps
      // never change, so keeping fingerprint entries just grows the map forever.
      for (const task of allTasks) {
        if (isTerminal(task.status)) {
          // Terminal tasks' deps are frozen — evict from fingerprint cache.
          // The dep-index retains the task's edges for dependency-satisfaction
          // checks; we only drop the fingerprint entry.
          this.lastTaskDeps.delete(task.id)
          continue
        }

        const cached = this.lastTaskDeps.get(task.id)
        const newDeps = task.depends_on ?? null
        const newHash = DependencyResolverImpl.depsFingerprint(newDeps)

        if (!cached || cached.hash !== newHash) {
          this.depIndex.update(task.id, newDeps)
          this.lastTaskDeps.set(task.id, { deps: newDeps, hash: newHash })
        }
      }

      taskStatusMap = new Map(allTasks.map((t) => [t.id, t.status]))
    } catch (err) {
      this.deps.logger.warn(`[dependency-resolver] Failed to refresh indexes: ${err}`)
    }

    return taskStatusMap
  }

  private static depsFingerprint(deps: TaskDependency[] | null): string {
    if (!deps || deps.length === 0) return ''
    return deps
      .map((d) => `${d.id}:${d.type}`)
      .sort()
      .join(',')
  }
}

export function createDependencyResolver(deps: DependencyResolverDeps): DependencyResolver {
  return new DependencyResolverImpl(deps)
}
