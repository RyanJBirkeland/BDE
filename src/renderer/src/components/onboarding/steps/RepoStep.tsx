import { ArrowRight, ArrowLeft, FolderGit, Check, X, FolderOpen, Plus } from 'lucide-react'
import { useEffect, useState, useCallback } from 'react'
import { Button } from '../../ui/Button'
import { toast } from '../../../stores/toasts'

interface StepProps {
  onNext: () => void
  onBack: () => void
  onComplete: () => void
  isFirst: boolean
  isLast: boolean
}

interface RepoConfig {
  name: string
  localPath: string
  githubOwner?: string
  githubRepo?: string
  color?: string
}

export function RepoStep({ onNext, onBack, isFirst }: StepProps): React.JSX.Element {
  const [reposConfigured, setReposConfigured] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(true)

  // Inline add form state
  const [newName, setNewName] = useState('')
  const [newPath, setNewPath] = useState('')
  const [newOwner, setNewOwner] = useState('')
  const [newRepo, setNewRepo] = useState('')
  const [saving, setSaving] = useState(false)

  const checkRepos = async (): Promise<void> => {
    setChecking(true)
    try {
      const raw = await window.api.settings.getJson('repos')
      setReposConfigured(Array.isArray(raw) && raw.length > 0)
    } catch {
      setReposConfigured(false)
    }
    setChecking(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void checkRepos()
  }, [])

  const handleBrowse = useCallback(async () => {
    const dir = await window.api.openDirectoryDialog()
    if (!dir) return
    setNewPath(dir)
    const basename = dir.split('/').filter(Boolean).pop() ?? ''
    if (!newName.trim() && basename) setNewName(basename)
    try {
      const detected = await window.api.gitDetectRemote(dir)
      if (detected.isGitRepo && detected.owner && detected.repo) {
        if (!newOwner.trim()) setNewOwner(detected.owner)
        if (!newRepo.trim()) setNewRepo(detected.repo)
        toast.success(`Detected ${detected.owner}/${detected.repo}`)
      } else if (!detected.isGitRepo) {
        toast.info('Not a git repository — you can still add it manually')
      }
    } catch {
      // Ignore detection errors
    }
  }, [newName, newOwner, newRepo])

  const handleAdd = useCallback(async () => {
    if (!newName.trim() || !newPath.trim()) return
    setSaving(true)
    try {
      const rawExisting = await window.api.settings.getJson('repos')
      const existing: RepoConfig[] = Array.isArray(rawExisting) ? (rawExisting as RepoConfig[]) : []
      const updated: RepoConfig[] = [
        ...existing,
        {
          name: newName.trim(),
          localPath: newPath.trim(),
          githubOwner: newOwner.trim() || undefined,
          githubRepo: newRepo.trim() || undefined
        }
      ]
      await window.api.settings.setJson('repos', updated)
      toast.success(`Added "${newName.trim()}"`)
      setNewName('')
      setNewPath('')
      setNewOwner('')
      setNewRepo('')
      await checkRepos()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add repository')
    } finally {
      setSaving(false)
    }
  }, [newName, newPath, newOwner, newRepo])

  return (
    <div className="onboarding-step">
      <div className="onboarding-step__icon">
        <FolderGit size={48} />
      </div>

      <h1 className="onboarding-step__title">Repository Configuration</h1>

      <p className="onboarding-step__description">
        Add a repository so BDE can dispatch agents to work on it. We&apos;ll auto-detect the
        GitHub remote when you pick a folder. This step is optional — you can add repos later in
        Settings.
      </p>

      <div className="onboarding-step__checks">
        <div className="onboarding-step__check">
          {checking ? (
            <div className="onboarding-step__check-icon">⏳</div>
          ) : reposConfigured ? (
            <Check size={20} className="onboarding-step__check-icon--success" />
          ) : (
            <X size={20} className="onboarding-step__check-icon--error" />
          )}
          <span>
            {reposConfigured ? 'Repositories configured' : 'No repositories configured (optional)'}
          </span>
        </div>
      </div>

      <div className="onboarding-step__repo-form" style={{ marginTop: '1rem' }}>
        <div className="settings-repo-form">
          <div className="settings-repo-form__row">
            <input
              className="settings-field__input"
              placeholder="Name (e.g. my-project)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              aria-label="Repository name"
            />
            <div className="settings-repo-form__path-row">
              <input
                className="settings-field__input"
                placeholder="Local path"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                aria-label="Local path"
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
              placeholder="GitHub owner (auto-detected)"
              value={newOwner}
              onChange={(e) => setNewOwner(e.target.value)}
              aria-label="GitHub owner"
            />
            <input
              className="settings-field__input"
              placeholder="GitHub repo (auto-detected)"
              value={newRepo}
              onChange={(e) => setNewRepo(e.target.value)}
              aria-label="GitHub repo"
            />
          </div>
          <div className="settings-repo-form__row">
            <div />
            <div className="settings-repo-form__actions">
              <Button
                variant="primary"
                size="sm"
                onClick={handleAdd}
                disabled={!newName.trim() || !newPath.trim() || saving}
                loading={saving}
                type="button"
              >
                <Plus size={14} /> {saving ? 'Adding...' : 'Add Repository'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="onboarding-step__actions">
        {!isFirst && (
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={16} />
            Back
          </Button>
        )}
        <Button variant="ghost" onClick={onNext}>
          Skip for now
          <ArrowRight size={16} />
        </Button>
        <Button variant="primary" onClick={onNext} disabled={!reposConfigured}>
          Next
          <ArrowRight size={16} />
        </Button>
      </div>
    </div>
  )
}
