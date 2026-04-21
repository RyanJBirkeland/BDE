import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, Plus, Lock, Globe, Loader2, AlertCircle, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { toast } from '../../stores/toasts'
import { REPO_COLOR_PALETTE } from '../../lib/repo-colors'

interface RepoConfig {
  name: string
  localPath: string
  githubOwner?: string | undefined
  githubRepo?: string | undefined
  color?: string | undefined
}

interface LocalRepoInfo {
  name: string
  localPath: string
  owner?: string | undefined
  repo?: string | undefined
}

interface GithubRepoInfo {
  name: string
  owner: string
  description?: string | undefined
  isPrivate: boolean
  url: string
}

interface CloneState {
  key: string
  lines: string[]
  done: boolean
  error?: string | undefined
  localPath?: string | undefined
}

interface Props {
  open: boolean
  onClose: () => void
  onRepoAdded: (repo: RepoConfig) => void
  repos: RepoConfig[]
}

type Tab = 'local' | 'github'

function nextColor(repos: RepoConfig[]): string {
  const used = new Set(repos.map((r) => r.color))
  return REPO_COLOR_PALETTE.find((c) => !used.has(c)) ?? REPO_COLOR_PALETTE[0] ?? '#ffffff'
}

export function RepoDiscoveryModal({
  open,
  onClose,
  onRepoAdded,
  repos
}: Props): React.JSX.Element | null {
  const [tab, setTab] = useState<Tab>('local')
  const [search, setSearch] = useState('')

  const [localRepos, setLocalRepos] = useState<LocalRepoInfo[]>([])
  const [localLoading, setLocalLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const [ghRepos, setGhRepos] = useState<GithubRepoInfo[]>([])
  const [ghLoading, setGhLoading] = useState(false)
  const [ghError, setGhError] = useState<string | null>(null)
  const [cloneStates, setCloneStates] = useState<Record<string, CloneState>>({})

  const backdropRef = useRef<HTMLDivElement>(null)
  const processedClonesRef = useRef<Set<string>>(new Set())

  const loadLocalRepos = useCallback(async () => {
    setLocalLoading(true)
    setLocalError(null)
    try {
      const scanDirs = (await window.api.settings.getJson('repos.scanDirs')) as string[] | null
      const dirs = scanDirs ?? ['~/projects']
      const results = await window.api.repoDiscovery.scanLocal(dirs)
      setLocalRepos(results)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to scan directories'
      setLocalError(message)
    } finally {
      setLocalLoading(false)
    }
  }, [])

  const loadGhRepos = useCallback(async () => {
    setGhLoading(true)
    setGhError(null)
    try {
      const results = await window.api.repoDiscovery.listGithub()
      setGhRepos(results)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to list GitHub repos'
      setGhError(message)
    } finally {
      setGhLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setSearch('')
    if (tab === 'local') loadLocalRepos()
    else loadGhRepos()
  }, [open, tab, loadLocalRepos, loadGhRepos])

  useEffect(() => {
    if (!open) return
    const unsub = window.api.repoDiscovery.onCloneProgress((data) => {
      const key = `${data.owner}/${data.repo}`
      setCloneStates((prev) => {
        const existing = prev[key] ?? { key, lines: [], done: false }
        const lines = data.line ? [...existing.lines.slice(-20), data.line] : existing.lines
        return {
          ...prev,
          [key]: { key, lines, done: data.done, error: data.error, localPath: data.localPath }
        }
      })
    })
    return unsub
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  const handleAddLocal = useCallback(
    (repo: LocalRepoInfo) => {
      const config: RepoConfig = {
        name: repo.name,
        localPath: repo.localPath,
        githubOwner: repo.owner,
        githubRepo: repo.repo,
        color: nextColor(repos)
      }
      onRepoAdded(config)
      setLocalRepos((prev) => prev.filter((r) => r.localPath !== repo.localPath))
      toast.success(`Added "${repo.name}"`)
    },
    [repos, onRepoAdded]
  )

  const handleClone = useCallback(async (repo: GithubRepoInfo) => {
    const cloneDir =
      ((await window.api.settings.getJson('repos.cloneDir')) as string | null) ?? '~/projects'
    await window.api.repoDiscovery.clone(repo.owner, repo.name, cloneDir)
  }, [])

  useEffect(() => {
    for (const [key, state] of Object.entries(cloneStates)) {
      if (!state.done || state.error || !state.localPath) continue
      if (processedClonesRef.current.has(key)) continue
      processedClonesRef.current.add(key)

      const [owner, name] = key.split('/')
      const ghRepo = ghRepos.find((r) => r.owner === owner && r.name === name)
      if (!ghRepo) continue

      const config: RepoConfig = {
        name: ghRepo.name,
        localPath: state.localPath,
        githubOwner: ghRepo.owner,
        githubRepo: ghRepo.name,
        color: nextColor(repos)
      }
      onRepoAdded(config)
      setGhRepos((prev) => prev.filter((r) => !(r.owner === owner && r.name === name)))
      toast.success(`Cloned and added "${ghRepo.name}"`)
    }
  }, [cloneStates, ghRepos, repos, onRepoAdded])

  const filteredLocal = useMemo(() => {
    if (!search) return localRepos
    const q = search.toLowerCase()
    return localRepos.filter((r) => r.name.toLowerCase().includes(q))
  }, [localRepos, search])

  const filteredGh = useMemo(() => {
    if (!search) return ghRepos
    const q = search.toLowerCase()
    return ghRepos.filter(
      (r) => r.name.toLowerCase().includes(q) || r.owner.toLowerCase().includes(q)
    )
  }, [ghRepos, search])

  if (!open) return null

  return (
    <div
      className="settings-discovery-backdrop"
      ref={backdropRef}
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Add Repository"
    >
      <div className="settings-discovery-modal">
        <div className="settings-discovery-header">
          <h2>Add Repository</h2>
          <button className="settings-discovery-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="settings-discovery-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'local'}
            className={`settings-discovery-tab ${tab === 'local' ? 'settings-discovery-tab--active' : ''}`}
            onClick={() => setTab('local')}
          >
            Local
          </button>
          <button
            role="tab"
            aria-selected={tab === 'github'}
            className={`settings-discovery-tab ${tab === 'github' ? 'settings-discovery-tab--active' : ''}`}
            onClick={() => setTab('github')}
          >
            GitHub
          </button>
        </div>

        <div className="settings-discovery-search">
          <Search size={14} />
          <input
            placeholder="Search repos..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="settings-discovery-list" role="tabpanel">
          {tab === 'local' && (
            <>
              {localLoading && (
                <div className="settings-discovery-empty">
                  <Loader2 size={20} className="settings-discovery-spinner" />
                  Scanning directories...
                </div>
              )}
              {localError && (
                <div className="settings-discovery-error">
                  <AlertCircle size={14} /> {localError}
                </div>
              )}
              {!localLoading && !localError && filteredLocal.length === 0 && (
                <div className="settings-discovery-empty">No unconfigured git repos found</div>
              )}
              {filteredLocal.map((r) => (
                <div key={r.localPath} className="settings-discovery-row">
                  <div className="settings-discovery-row__info">
                    <span className="settings-discovery-row__name">{r.name}</span>
                    <span className="settings-discovery-row__path">{r.localPath}</span>
                    {r.owner && r.repo && (
                      <span className="settings-discovery-row__github">
                        {r.owner}/{r.repo}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleAddLocal(r)}
                    aria-label={`Add ${r.name}`}
                  >
                    <Plus size={14} /> Add
                  </Button>
                </div>
              ))}
            </>
          )}

          {tab === 'github' && (
            <>
              {ghLoading && (
                <div className="settings-discovery-empty">
                  <Loader2 size={20} className="settings-discovery-spinner" />
                  Loading GitHub repos...
                </div>
              )}
              {ghError && (
                <div className="settings-discovery-error">
                  <AlertCircle size={14} /> {ghError}
                </div>
              )}
              {!ghLoading && !ghError && filteredGh.length === 0 && (
                <div className="settings-discovery-empty">No repos found</div>
              )}
              {filteredGh.map((r) => {
                const cloneKey = `${r.owner}/${r.name}`
                const cloning = cloneStates[cloneKey]
                return (
                  <div key={cloneKey} className="settings-discovery-row">
                    <div className="settings-discovery-row__info">
                      <span className="settings-discovery-row__name">
                        {r.isPrivate ? <Lock size={12} /> : <Globe size={12} />} {r.owner}/{r.name}
                      </span>
                      {r.description && (
                        <span className="settings-discovery-row__desc">{r.description}</span>
                      )}
                      {cloning && !cloning.done && (
                        <span className="settings-discovery-row__progress">
                          {cloning.lines[cloning.lines.length - 1] ?? 'Cloning...'}
                        </span>
                      )}
                      {cloning?.error && (
                        <span className="settings-discovery-row__error">{cloning.error}</span>
                      )}
                    </div>
                    {!cloning || cloning.error ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleClone(r)}
                        aria-label={`Clone ${r.name}`}
                      >
                        <Plus size={14} /> {cloning?.error ? 'Retry' : 'Clone'}
                      </Button>
                    ) : !cloning.done ? (
                      <Loader2 size={16} className="settings-discovery-spinner" />
                    ) : null}
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
