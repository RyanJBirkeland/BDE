import { useState, useEffect, useMemo } from 'react'
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
 * Loads repo options from settings via IPC, returning an empty array
 * while loading to prevent race conditions with stale fallback data.
 */
export function useRepoOptions(): RepoOption[] {
  const [repos, setRepos] = useState<RepoOption[] | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    window.api.settings
      .getJson('repos')
      .then((raw) => {
        const configs = raw as RepoConfig[] | null
        if (configs && configs.length > 0) {
          setRepos(toRepoOptions(configs))
        } else {
          setRepos(REPO_OPTIONS)
        }
        setLoaded(true)
      })
      .catch(() => {
        // Use fallback on error
        setRepos(REPO_OPTIONS)
        setLoaded(true)
      })
  }, [])

  // Memoize to prevent reference instability causing unnecessary re-renders
  return useMemo(() => {
    if (!loaded || !repos) return []
    return repos
  }, [loaded, repos])
}
