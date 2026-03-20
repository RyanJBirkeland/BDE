/**
 * RepositoriesSection — CRUD for repository configurations.
 */
import { useCallback, useEffect, useState } from 'react'
import { Trash2, Plus, FolderOpen } from 'lucide-react'
import { toast } from '../../stores/toasts'
import { Button } from '../ui/Button'

const REPO_COLOR_PALETTE = [
  '#6C8EEF', '#00D37F', '#FF8A00', '#EF4444', '#8B5CF6',
  '#3B82F6', '#F97316', '#06B6D4',
]

interface RepoConfig {
  name: string
  localPath: string
  githubOwner?: string
  githubRepo?: string
  color?: string
}

export function RepositoriesSection(): React.JSX.Element {
  const [repos, setRepos] = useState<RepoConfig[]>([])
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPath, setNewPath] = useState('')
  const [newOwner, setNewOwner] = useState('')
  const [newRepo, setNewRepo] = useState('')
  const [newColor, setNewColor] = useState(REPO_COLOR_PALETTE[0])

  useEffect(() => {
    window.api.settings.getJson('repos').then((raw) => {
      if (Array.isArray(raw)) setRepos(raw as RepoConfig[])
    })
  }, [])

  const saveRepos = useCallback(async (updated: RepoConfig[]) => {
    await window.api.settings.setJson('repos', updated)
    setRepos(updated)
  }, [])

  const handleRemove = useCallback(
    (name: string) => {
      const updated = repos.filter((r) => r.name !== name)
      saveRepos(updated)
      toast.success(`Removed "${name}"`)
    },
    [repos, saveRepos]
  )

  const handleAdd = useCallback(async () => {
    if (!newName.trim() || !newPath.trim()) return
    const updated = [
      ...repos,
      {
        name: newName.trim(),
        localPath: newPath.trim(),
        githubOwner: newOwner.trim() || undefined,
        githubRepo: newRepo.trim() || undefined,
        color: newColor,
      },
    ]
    await saveRepos(updated)
    setAdding(false)
    setNewName('')
    setNewPath('')
    setNewOwner('')
    setNewRepo('')
    setNewColor(REPO_COLOR_PALETTE[0])
    toast.success(`Added "${newName.trim()}"`)
  }, [repos, newName, newPath, newOwner, newRepo, newColor, saveRepos])

  const handleBrowse = useCallback(async () => {
    const dir = await window.api.openDirectoryDialog()
    if (dir) setNewPath(dir)
  }, [])

  return (
    <section className="settings-section">
      <h2 className="settings-section__title bde-section-title">Repositories</h2>
      <div className="settings-repos">
        {repos.map((r) => (
          <div key={r.name} className="settings-repo">
            <span
              className="settings-repo__dot"
              style={{ background: r.color ?? 'var(--bde-text-dim)' }}
            />
            <span className="settings-repo__name">{r.name}</span>
            <span className="settings-repo__path">{r.localPath}</span>
            {r.githubOwner && r.githubRepo && (
              <span className="settings-repo__github">
                {r.githubOwner}/{r.githubRepo}
              </span>
            )}
            <Button
              variant="icon"
              size="sm"
              onClick={() => handleRemove(r.name)}
              title="Remove repository"
              type="button"
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
        {repos.length === 0 && !adding && (
          <span className="settings-repos__empty">No repositories configured</span>
        )}
      </div>

      {adding ? (
        <div className="settings-repo-form">
          <div className="settings-repo-form__row">
            <input
              className="settings-field__input"
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <div className="settings-repo-form__path-row">
              <input
                className="settings-field__input"
                placeholder="Local path"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
              />
              <Button variant="ghost" size="sm" onClick={handleBrowse} title="Browse" type="button">
                <FolderOpen size={14} />
              </Button>
            </div>
          </div>
          <div className="settings-repo-form__row">
            <input
              className="settings-field__input"
              placeholder="GitHub owner (optional)"
              value={newOwner}
              onChange={(e) => setNewOwner(e.target.value)}
            />
            <input
              className="settings-field__input"
              placeholder="GitHub repo (optional)"
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
                  type="button"
                />
              ))}
            </div>
            <div className="settings-repo-form__actions">
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)} type="button">
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleAdd}
                disabled={!newName.trim() || !newPath.trim()}
                type="button"
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAdding(true)}
          type="button"
          className="settings-repos__add-btn"
        >
          <Plus size={14} /> Add Repository
        </Button>
      )}
    </section>
  )
}
