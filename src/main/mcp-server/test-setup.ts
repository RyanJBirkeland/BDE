import { setSettingJson } from '../settings'
import type { RepoConfig } from '../paths'

/**
 * Seeds a test bde repo config so integration tests don't silently skip.
 * Call from beforeAll in integration test files.
 */
export function seedBdeRepo(): void {
  const existingRepos = [] // Start fresh in tests
  setSettingJson<RepoConfig[]>('repos', [
    ...existingRepos,
    {
      name: 'bde',
      localPath: process.cwd(),
      githubOwner: 'test',
      githubRepo: 'bde',
      color: '#00ff88'
    }
  ])
}
