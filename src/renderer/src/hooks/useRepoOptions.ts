import { useState, useEffect } from 'react'
import type { RepoOption } from '../lib/constants'

interface RepoConfig {
  name: string
  localPath: string
  githubOwner?: string | undefined
  githubRepo?: string | undefined
  color?: string | undefined
}

function toRepoOptions(configs: RepoConfig[]): RepoOption[] {
  return configs.map((r) => ({
    label: r.name,
    owner: r.githubOwner ?? '',
    color: r.color ?? 'var(--bde-text-dim)'
  }))
}

/**
 * Loads repo options from settings via IPC, returning an empty array
 * while loading to prevent race conditions with stale fallback data.
 */
export function useRepoOptions(): RepoOption[] {
  const [repos, setRepos] = useState<RepoOption[] | null>(null)

  useEffect(() => {
    window.api.settings
      .getJson('repos')
      .then((raw) => {
        const configs = raw as RepoConfig[] | null
        if (configs && configs.length > 0) {
          setRepos(toRepoOptions(configs))
        } else {
          setRepos([])
        }
      })
      .catch(() => {
        setRepos([])
      })
  }, [])

  return repos ?? []
}
