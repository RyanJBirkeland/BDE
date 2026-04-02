import { join, resolve } from 'path'
import { homedir, tmpdir } from 'os'

// --- BDE data directory ---
export const BDE_DIR = join(homedir(), '.bde')
export const BDE_DB_PATH = join(BDE_DIR, 'bde.db')
export const BDE_AGENTS_INDEX = join(BDE_DIR, 'agents.json')
export const BDE_AGENT_LOGS_DIR = join(BDE_DIR, 'agent-logs')
export const BDE_AGENT_TMP_DIR = join(tmpdir(), 'bde-agents')
export const BDE_AGENT_LOG_PATH = join(BDE_DIR, 'agent-manager.log')
export const BDE_MEMORY_DIR = join(BDE_DIR, 'memory')

// --- Dynamic repo configuration (backed by settings table) ---

import { getSettingJson } from './settings'

export interface RepoConfig {
  name: string
  localPath: string
  githubOwner?: string
  githubRepo?: string
  color?: string
}

export function getConfiguredRepos(): RepoConfig[] {
  return getSettingJson<RepoConfig[]>('repos') ?? []
}

export function getRepoPaths(): Record<string, string> {
  const repos = getConfiguredRepos()
  const result: Record<string, string> = {}
  for (const r of repos) {
    result[r.name.toLowerCase()] = r.localPath
  }
  return result
}

export function getGhRepo(repoSlug: string): string | null {
  const repos = getConfiguredRepos()
  const repo = repos.find((r) => r.name.toLowerCase() === repoSlug.toLowerCase())
  if (!repo?.githubOwner || !repo?.githubRepo) return null
  return `${repo.githubOwner}/${repo.githubRepo}`
}

export function getSpecsRoot(): string | null {
  const repos = getConfiguredRepos()
  const bdeRepo = repos.find((r) => r.name.toLowerCase() === 'bde')
  if (!bdeRepo) return null
  return resolve(bdeRepo.localPath, 'docs', 'specs')
}
