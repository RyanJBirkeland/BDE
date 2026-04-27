import { setSettingJson } from '../settings'
import type { RepoConfig } from '../paths'
import { createSprintTaskRepository } from '../data/sprint-task-repository'
import { createSprintMutations } from '../services/sprint-mutations'

/**
 * Seeds a test bde repo config so integration tests don't silently skip.
 * Also initialises the sprint-mutations factory so calls to `getTask`,
 * `createTask`, etc. work without a full composition-root bootstrap.
 *
 * Call from beforeAll in integration test files.
 *
 * @param localPath - Path used as the repo's `localPath` in settings.
 *   Defaults to `process.cwd()` for backward compat; callers running from a
 *   non-repo cwd should pass the real repo root.
 */
export function seedBdeRepo(localPath: string = process.cwd()): void {
  setSettingJson<RepoConfig[]>('repos', [
    {
      name: 'bde',
      localPath,
      githubOwner: 'test',
      githubRepo: 'bde',
      color: '#00ff88'
    }
  ])
  createSprintMutations(createSprintTaskRepository())
}
