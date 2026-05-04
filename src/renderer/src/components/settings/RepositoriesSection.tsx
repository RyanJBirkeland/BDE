/**
 * RepositoriesSection — CRUD for repository configurations.
 */
import './RepositoriesSection.css'
import { useCallback, useEffect, useState } from 'react'
import { Trash2, Plus, FolderOpen } from 'lucide-react'
import { toast } from '../../stores/toasts'
import { Button } from '../ui/Button'
import { ConfirmModal, useConfirm } from '../ui/ConfirmModal'
import { SettingsCard } from './SettingsCard'
import { RepoDiscoveryModal } from './RepoDiscoveryModal'
import { REPO_COLOR_PALETTE } from '../../lib/repo-colors'

interface RepoConfig {
  name: string
  localPath: string
  githubOwner?: string | undefined
  githubRepo?: string | undefined
  color?: string | undefined
  envVars?: Record<string, string> | undefined
}

function envVarsToArray(envVars: Record<string, string> | undefined): Array<{ key: string; value: string }> {
  return Object.entries(envVars ?? {}).map(([key, value]) => ({ key, value }))
}

function arrayToEnvVars(pairs: Array<{ key: string; value: string }>): Record<string, string> | undefined {
  const result: Record<string, string> = {}
  for (const { key, value } of pairs) {
    if (key.trim()) result[key.trim()] = value
  }
  return Object.keys(result).length > 0 ? result : undefined
}

export function RepositoriesSection(): React.JSX.Element {
  const { confirm, confirmProps } = useConfirm()
  const [repos, setRepos] = useState<RepoConfig[]>([])
  const [showManual, setShowManual] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [scanDirs, setScanDirs] = useState('')
  const [cloneDir, setCloneDir] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingName, setDeletingName] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newPath, setNewPath] = useState('')
  const [newOwner, setNewOwner] = useState('')
  const [newRepo, setNewRepo] = useState('')
  const [newColor, setNewColor] = useState(REPO_COLOR_PALETTE[0])
  const [expandedEnvRepo, setExpandedEnvRepo] = useState<string | null>(null)
  const [editingEnvPairs, setEditingEnvPairs] = useState<Array<{ key: string; value: string }>>([])
  const [pathError, setPathError] = useState<string | null>(null)
  const [pathWarning, setPathWarning] = useState<string | null>(null)

  useEffect(() => {
    window.api.settings.getJson('repos').then((raw) => {
      if (Array.isArray(raw)) setRepos(raw as RepoConfig[])
    })
    window.api.settings.getJson('repos.scanDirs').then((raw) => {
      if (typeof raw === 'string') setScanDirs(raw)
    })
    window.api.settings.getJson('repos.cloneDir').then((raw) => {
      if (typeof raw === 'string') setCloneDir(raw)
    })
  }, [])

  const saveRepos = useCallback(async (updated: RepoConfig[]) => {
    await window.api.settings.setJson('repos', updated)
    setRepos(updated)
  }, [])

  const handleRemove = useCallback(
    async (name: string) => {
      const ok = await confirm({
        message: `Remove repository "${name}" from FLEET?`,
        confirmLabel: 'Remove',
        variant: 'danger'
      })
      if (!ok) return
      setDeletingName(name)
      try {
        const updated = repos.filter((r) => r.name !== name)
        await saveRepos(updated)
        if (expandedEnvRepo === name) setExpandedEnvRepo(null)
        toast.success(`Removed "${name}"`)
      } finally {
        setDeletingName(null)
      }
    },
    [repos, saveRepos, confirm, expandedEnvRepo]
  )

  const handleManualAdd = useCallback(async () => {
    if (!newName.trim() || !newPath.trim()) return

    setPathError(null)
    setPathWarning(null)
    setSaving(true)

    try {
      const detected = await window.api.git.detectRemote(newPath.trim())

      if (!detected.isGitRepo) {
        setPathError('Not a git repository. Verify the path.')
        return
      }

      const basename = newPath.trim().split('/').filter(Boolean).pop() ?? ''
      if (basename.toLowerCase() !== newName.trim().toLowerCase()) {
        setPathWarning("Directory name doesn't match repo name — double-check this is the right path.")
      }

      const updated = [
        ...repos,
        {
          name: newName.trim(),
          localPath: newPath.trim(),
          githubOwner: newOwner.trim() || undefined,
          githubRepo: newRepo.trim() || undefined,
          color: newColor
        }
      ]
      await saveRepos(updated)
      setShowManual(false)
      setNewName('')
      setNewPath('')
      setNewOwner('')
      setNewRepo('')
      setNewColor(REPO_COLOR_PALETTE[0])
      setPathError(null)
      setPathWarning(null)
      toast.success(`Added "${newName.trim()}"`)
    } finally {
      setSaving(false)
    }
  }, [repos, newName, newPath, newOwner, newRepo, newColor, saveRepos])

  const handleRepoAdded = useCallback(
    async (repo: RepoConfig) => {
      const updated = [...repos, repo]
      await saveRepos(updated)
    },
    [repos, saveRepos]
  )

  const handleSaveScanDirs = useCallback(async () => {
    await window.api.settings.setJson('repos.scanDirs', scanDirs)
  }, [scanDirs])

  const handleSaveCloneDir = useCallback(async () => {
    await window.api.settings.setJson('repos.cloneDir', cloneDir)
  }, [cloneDir])

  const handleBrowse = useCallback(async () => {
    const dir = await window.api.fs.openDirDialog()
    if (!dir) return
    setNewPath(dir)

    // Auto-derive the local name from the directory basename when the user
    // hasn't typed one yet.
    const basename = dir.split('/').filter(Boolean).pop() ?? ''
    if (!newName.trim() && basename) {
      setNewName(basename)
    }

    // Best-effort: detect GitHub remote and pre-fill owner/repo.
    try {
      const detected = await window.api.git.detectRemote(dir)
      if (detected.isGitRepo && detected.owner && detected.repo) {
        if (!newOwner.trim()) setNewOwner(detected.owner)
        if (!newRepo.trim()) setNewRepo(detected.repo)
        toast.success(`Detected ${detected.owner}/${detected.repo}`)
      } else if (!detected.isGitRepo) {
        toast.info('Not a git repository (you can still add it manually)')
      }
    } catch {
      // Non-fatal — user can still fill fields manually.
    }
  }, [newName, newOwner, newRepo])

  const handleToggleEnvVars = useCallback(
    (repoName: string, currentEnvVars: Record<string, string> | undefined) => {
      if (expandedEnvRepo === repoName) {
        setExpandedEnvRepo(null)
      } else {
        setExpandedEnvRepo(repoName)
        setEditingEnvPairs(envVarsToArray(currentEnvVars))
      }
    },
    [expandedEnvRepo]
  )

  const handleSaveEnvVars = useCallback(
    async (repoName: string) => {
      const envVars = arrayToEnvVars(editingEnvPairs)
      const updated = repos.map((r) => (r.name === repoName ? { ...r, envVars } : r))
      await saveRepos(updated)
      setExpandedEnvRepo(null)
    },
    [repos, editingEnvPairs, saveRepos]
  )

  return (
    <>
      <ConfirmModal {...confirmProps} />
      <RepoDiscoveryModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onRepoAdded={handleRepoAdded}
        repos={repos}
      />
      <div className="settings-discovery-config">
        <div className="settings-discovery-config__row">
          <label className="settings-field__label">Scan directories</label>
          <div className="settings-discovery-config__input-row">
            <input
              className="settings-field__input"
              value={scanDirs}
              onChange={(e) => setScanDirs(e.target.value)}
              placeholder="~/projects"
              onBlur={handleSaveScanDirs}
            />
          </div>
          <span className="settings-field__hint">Comma-separated. Used by Local tab.</span>
        </div>
        <div className="settings-discovery-config__row">
          <label className="settings-field__label">Clone directory</label>
          <div className="settings-discovery-config__input-row">
            <input
              className="settings-field__input"
              value={cloneDir}
              onChange={(e) => setCloneDir(e.target.value)}
              placeholder="~/projects"
              onBlur={handleSaveCloneDir}
            />
          </div>
          <span className="settings-field__hint">Where GitHub repos are cloned to.</span>
        </div>
      </div>
      <div className="settings-cards-list">
        {repos.length === 0 && !showManual && (
          <span className="settings-repos__empty">No repositories configured</span>
        )}

        {repos.map((r) => {
          const envCount = Object.keys(r.envVars ?? {}).length
          const isExpanded = expandedEnvRepo === r.name

          return (
            <SettingsCard
              key={r.name}
              title={r.name}
              subtitle={r.localPath}
              icon={
                <span
                  className="settings-repo__dot"
                  style={{ background: r.color ?? 'var(--fleet-text-dim)' }}
                />
              }
              footer={
                <div className="settings-card-footer-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleToggleEnvVars(r.name, r.envVars)}
                    type="button"
                    aria-expanded={isExpanded}
                  >
                    {`Env vars${envCount > 0 ? ` (${envCount})` : ''}`}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemove(r.name)}
                    disabled={deletingName === r.name}
                    loading={deletingName === r.name}
                    title="Remove repository"
                    aria-label="Remove repository"
                    type="button"
                  >
                    <Trash2 size={14} /> {deletingName === r.name ? 'Deleting...' : 'Delete'}
                  </Button>
                </div>
              }
            >
              {r.githubOwner && r.githubRepo && (
                <span className="settings-repo__github">
                  {r.githubOwner}/{r.githubRepo}
                </span>
              )}
              {isExpanded && (
                <div className="settings-repo__env-editor">
                  <p className="settings-repo__env-warning">
                    Values are stored unencrypted in the app database. Do not store secrets you
                    would not write to <code>.npmrc</code> or a <code>.env</code> file.
                  </p>
                  {editingEnvPairs.map((pair, i) => (
                    <div key={i} className="settings-repo__env-row">
                      <input
                        className="settings-field__input"
                        placeholder="KEY"
                        aria-label={`Environment variable key ${i + 1}`}
                        value={pair.key}
                        onChange={(e) => {
                          const updated = [...editingEnvPairs]
                          updated[i] = { key: e.target.value, value: pair.value }
                          setEditingEnvPairs(updated)
                        }}
                      />
                      <input
                        className="settings-field__input"
                        placeholder="value"
                        aria-label={`Environment variable value ${i + 1}`}
                        value={pair.value}
                        onChange={(e) => {
                          const updated = [...editingEnvPairs]
                          updated[i] = { key: pair.key, value: e.target.value }
                          setEditingEnvPairs(updated)
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        aria-label="Remove variable"
                        onClick={() => setEditingEnvPairs(editingEnvPairs.filter((_, j) => j !== i))}
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                  <div className="settings-repo__env-actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => setEditingEnvPairs([...editingEnvPairs, { key: '', value: '' }])}
                    >
                      + Add variable
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      type="button"
                      onClick={() => handleSaveEnvVars(r.name)}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              )}
            </SettingsCard>
          )
        })}

        {showManual && (
          <SettingsCard title="Add Repository (Manual)">
            <div className="settings-repo-form">
              <div className="settings-repo-form__row">
                <input
                  className="settings-field__input"
                  placeholder="Name"
                  aria-label="Repository name (e.g. fleet)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <div className="settings-repo-form__path-col">
                  <div className="settings-repo-form__path-row">
                    <input
                      className={`settings-field__input${pathError ? ' settings-field__input--error' : ''}`}
                      placeholder="Local path"
                      aria-label="Local path"
                      aria-describedby={pathError ? 'path-error' : pathWarning ? 'path-warning' : undefined}
                      value={newPath}
                      onChange={(e) => {
                        setNewPath(e.target.value)
                        setPathError(null)
                        setPathWarning(null)
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleBrowse}
                      title="Browse"
                      type="button"
                    >
                      <FolderOpen size={14} />
                    </Button>
                  </div>
                  {pathError && (
                    <p id="path-error" className="settings-repo-form__path-error" role="alert">
                      {pathError}
                    </p>
                  )}
                  {!pathError && pathWarning && (
                    <p id="path-warning" className="settings-repo-form__path-warning" role="status">
                      {pathWarning}
                    </p>
                  )}
                </div>
              </div>
              <div className="settings-repo-form__row">
                <input
                  className="settings-field__input"
                  placeholder="GitHub owner (optional)"
                  aria-label="GitHub owner"
                  value={newOwner}
                  onChange={(e) => setNewOwner(e.target.value)}
                />
                <input
                  className="settings-field__input"
                  placeholder="GitHub repo (optional)"
                  aria-label="GitHub repo"
                  value={newRepo}
                  onChange={(e) => setNewRepo(e.target.value)}
                />
              </div>
              <div className="settings-repo-form__row">
                <div className="settings-colors">
                  {REPO_COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      className={`settings-color ${newColor === c ? 'settings-color--active' : ''}`}
                      style={{ background: c }}
                      onClick={() => setNewColor(c)}
                      aria-label={`Color ${c}`}
                      type="button"
                    />
                  ))}
                </div>
                <div className="settings-repo-form__actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowManual(false)}
                    type="button"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleManualAdd}
                    disabled={!newName.trim() || !newPath.trim() || saving}
                    loading={saving}
                    type="button"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              </div>
            </div>
          </SettingsCard>
        )}

        {!showManual && (
          <div className="settings-repos__actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowModal(true)}
              type="button"
              className="settings-repos__add-btn"
            >
              <Plus size={14} /> Add Repository
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowManual(true)}
              type="button"
              className="settings-repos__manual-btn"
            >
              Manual
            </Button>
          </div>
        )}
      </div>
    </>
  )
}
