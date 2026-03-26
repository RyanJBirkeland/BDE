import { useState, useEffect } from 'react'
import { REPO_OPTIONS, type RepoOption } from '../lib/constants'

interface RepoConfig {
  name: string
  localPath: string
  githubOwner?: string
  githubRepo?: string
  color?: string
}

function toRepoOptions(configs: RepoConfig[]): RepoOption[] {
  return configs.map((r) => ({
    label: r.name,
    owner: r.githubOwner ?? '',
    color: r.color ?? 'var(--bde-text-dim)'
  }))
}

/**
 * Loads repo options from settings via IPC, falling back to the static
 * REPO_OPTIONS constant until the async load completes.
 */
export function useRepoOptions(): RepoOption[] {
  const [repos, setRepos] = useState<RepoOption[]>(REPO_OPTIONS)

  useEffect(() => {
    window.api.settings
      .getJson('repos')
      .then((raw) => {
        const configs = raw as RepoConfig[] | null
        if (configs && configs.length > 0) {
          setRepos(toRepoOptions(configs))
        }
      })
      .catch(() => {
        // Keep fallback
      })
  }, [])

  return repos
}
