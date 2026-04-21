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
        message: `Remove repository "${name}" from BDE?`,
        confirmLabel: 'Remove',
        variant: 'danger'
      })
      if (!ok) return
      setDeletingName(name)
      try {
        const updated = repos.filter((r) => r.name !== name)
        await saveRepos(updated)
        toast.success(`Removed "${name}"`)
      } finally {
        setDeletingName(null)
      }
    },
    [repos, saveRepos, confirm]
  )

  const handleManualAdd = useCallback(async () => {
    if (!newName.trim() || !newPath.trim()) return
    setSaving(true)
    try {
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

        {repos.map((r) => (
          <SettingsCard
            key={r.name}
            title={r.name}
            subtitle={r.localPath}
            icon={
              <span
                className="settings-repo__dot"
                style={{ background: r.color ?? 'var(--bde-text-dim)' }}
              />
            }
            footer={
              <div className="settings-card-footer-actions">
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
          </SettingsCard>
        ))}

        {showManual && (
          <SettingsCard title="Add Repository (Manual)">
            <div className="settings-repo-form">
              <div className="settings-repo-form__row">
                <input
                  className="settings-field__input"
                  placeholder="Name"
                  aria-label="Repository name (e.g. bde)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <div className="settings-repo-form__path-row">
                  <input
                    className="settings-field__input"
                    placeholder="Local path"
                    aria-label="Local path"
                    value={newPath}
                    onChange={(e) => setNewPath(e.target.value)}
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
