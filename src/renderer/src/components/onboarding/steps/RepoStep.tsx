import { ArrowRight, ArrowLeft, FolderGit, Check, X, FolderOpen, Plus } from 'lucide-react'
import { useEffect, useState, useCallback } from 'react'
import { Button } from '../../ui/Button'
import { Spinner } from '../../ui/Spinner'
import { toast } from '../../../stores/toasts'
import { usePanelLayoutStore } from '../../../stores/panelLayout'
import { useSettingsNavStore } from '../../../stores/settingsNav'

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
  githubOwner?: string | undefined
  githubRepo?: string | undefined
  color?: string | undefined
}

function repoBasename(fullPath: string): string {
  return fullPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? ''
}

export function RepoStep({ onNext, onBack, isFirst }: StepProps): React.JSX.Element {
  const [reposConfigured, setReposConfigured] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(true)
  const [existingRepos, setExistingRepos] = useState<RepoConfig[]>([])
  const [settingsError, setSettingsError] = useState<string | null>(null)

  // Inline add form state
  const [newName, setNewName] = useState('')
  const [newPath, setNewPath] = useState('')
  const [newOwner, setNewOwner] = useState('')
  const [newRepo, setNewRepo] = useState('')
  const [saving, setSaving] = useState(false)

  const setView = usePanelLayoutStore((s) => s.setView)
  const setActiveSection = useSettingsNavStore((s) => s.setActiveSection)

  const handleOpenConnections = useCallback((): void => {
    setView('settings')
    setActiveSection('connections')
  }, [setView, setActiveSection])

  const checkRepos = async (): Promise<void> => {
    setChecking(true)
    try {
      const raw = await window.api.settings.getJson('repos')
      setReposConfigured(Array.isArray(raw) && raw.length > 0)
      setExistingRepos(Array.isArray(raw) ? (raw as RepoConfig[]) : [])
      setSettingsError(null)
    } catch {
      setReposConfigured(false)
      setExistingRepos([])
      setSettingsError('Failed to read settings — check ~/.bde/bde.log')
    }
    setChecking(false)
  }

  useEffect(() => {
    void checkRepos()
  }, [])

  const handleBrowse = useCallback(async () => {
    const dir = await window.api.fs.openDirDialog()
    if (!dir) return
    setNewPath(dir)
    const name = repoBasename(dir)
    if (!newName.trim() && name) setNewName(name)
    try {
      const detected = await window.api.git.detectRemote(dir)
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
        GitHub remote when you pick a folder. This step is optional — you can{' '}
        <button
          type="button"
          onClick={handleOpenConnections}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            color: 'var(--bde-accent)',
            cursor: 'pointer',
            textDecoration: 'underline',
            font: 'inherit'
          }}
        >
          add repos later in Settings → Repositories
        </button>
        .
      </p>

      <div className="onboarding-step__checks">
        <div className="onboarding-step__check">
          {checking ? (
            <div className="onboarding-step__check-icon">
              <Spinner size="sm" />
            </div>
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

      {existingRepos.length > 0 && (
        <div style={{ marginTop: 'var(--bde-space-2)' }}>
          <p
            style={{
              fontSize: 'var(--bde-size-sm)',
              color: 'var(--bde-text-muted)',
              marginBottom: 'var(--bde-space-1)'
            }}
          >
            Configured repositories:
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {existingRepos.map((r) => (
              <li
                key={r.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--bde-space-2)',
                  padding: '4px 0',
                  fontSize: 'var(--bde-size-sm)'
                }}
              >
                <Check size={14} className="onboarding-step__check-icon--success" />
                <span>{r.name}</span>
                {r.localPath && (
                  <span style={{ color: 'var(--bde-text-muted)' }}>{r.localPath}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {settingsError && (
        <p
          style={{
            color: 'var(--bde-color-error, red)',
            fontSize: 'var(--bde-size-sm)',
            marginTop: 'var(--bde-space-2)'
          }}
        >
          ⚠ {settingsError}
        </p>
      )}

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
              <Button variant="ghost" size="sm" onClick={handleBrowse} title="Browse" type="button">
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
