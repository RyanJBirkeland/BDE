import { useState, useEffect } from 'react'
import { RefreshCw, ExternalLink } from 'lucide-react'
import { PanelHeader } from '../PanelHeader'
import { IconBtn } from '../IconBtn'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScmFile {
  path: string
  status: string
}

interface ScmStatus {
  staged: ScmFile[]
  unstaged: ScmFile[]
}

interface ScmPanelProps {
  rootPath: string | null
}

// ---------------------------------------------------------------------------
// Status letter → color
// ---------------------------------------------------------------------------

function statusColor(letter: string): string {
  if (letter === 'M') return 'var(--st-running)'
  if (letter === 'A') return 'var(--st-done)'
  if (letter === 'D') return 'var(--st-failed)'
  return 'var(--fg-3)'
}

// ---------------------------------------------------------------------------
// Internal helpers — git:status response parsing
// The channel returns { files: { path, status, staged }[], branch }
// IPC delivers single-character status values — use status[0] directly.
// ---------------------------------------------------------------------------

function parseGitStatus(files: { path: string; status: string; staged: boolean }[]): ScmStatus {
  const staged: ScmFile[] = []
  const unstaged: ScmFile[] = []

  for (const file of files) {
    const letter = file.status[0] ?? '?'
    if (file.staged) {
      staged.push({ path: file.path, status: letter })
    } else {
      unstaged.push({ path: file.path, status: letter })
    }
  }

  return { staged, unstaged }
}

// ---------------------------------------------------------------------------
// SectionLabel
// ---------------------------------------------------------------------------

interface SectionLabelProps {
  label: string
  count: number
}

function SectionLabel({ label, count }: SectionLabelProps): React.JSX.Element {
  return (
    <div
      style={{
        height: 22,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-2)',
        padding: '0 var(--s-3)'
      }}
    >
      <span className="fleet-eyebrow">{label}</span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--t-2xs)',
          color: 'var(--fg-4)'
        }}
      >
        {count}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ScmRow
// ---------------------------------------------------------------------------

interface ScmRowProps {
  file: ScmFile
  type: 'staged' | 'unstaged'
}

function ScmRow({ file, type }: ScmRowProps): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  const fileName = file.path.split('/').pop() ?? file.path
  const actionLabel = type === 'staged' ? 'Unstage' : 'Stage'

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 24,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-2)',
        padding: '0 var(--s-3)',
        background: hovered ? 'var(--surf-2)' : 'transparent'
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--t-xs)',
          color: statusColor(file.status),
          flexShrink: 0,
          width: 10
        }}
      >
        {file.status}
      </span>

      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 'var(--t-sm)',
          color: 'var(--fg-2)'
        }}
        title={file.path}
      >
        {fileName}
      </span>

      {hovered && (
        <button
          onClick={() => {
            // TODO: wire git:stage / git:unstage
          }}
          style={{
            height: 20,
            padding: '0 var(--s-2)',
            fontSize: 'var(--t-2xs)',
            fontFamily: 'var(--font-ui)',
            color: 'var(--fg-3)',
            background: 'transparent',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-sm)',
            cursor: 'pointer',
            flexShrink: 0
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CommitArea
// ---------------------------------------------------------------------------

interface CommitAreaProps {
  stagedCount: number
  rootPath: string
  onStatusReload: () => void
}

function CommitArea({ stagedCount, rootPath, onStatusReload }: CommitAreaProps): React.JSX.Element {
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [committing, setCommitting] = useState(false)

  const canCommit = stagedCount > 0 && message.trim().length > 0 && !committing

  async function handleCommit(): Promise<void> {
    if (!canCommit) return
    setCommitting(true)
    setError(null)
    try {
      await window.api.git.commit(rootPath, message.trim())
      setMessage('')
      onStatusReload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Commit failed')
    } finally {
      setCommitting(false)
    }
  }

  return (
    <div style={{ margin: 'var(--s-2) var(--s-3)' }}>
      <textarea
        rows={3}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Commit message…"
        aria-label="Commit message"
        style={{
          width: '100%',
          resize: 'none',
          background: 'var(--surf-3)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-md)',
          padding: 'var(--s-2)',
          fontSize: 'var(--t-sm)',
          color: 'var(--fg)',
          fontFamily: 'var(--font-ui)',
          boxSizing: 'border-box',
          outline: 'none'
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-line)' }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line)' }}
      />

      <div style={{ display: 'flex', gap: 'var(--s-2)', marginTop: 'var(--s-2)' }}>
        <GhostButton
          label="Stage All"
          onClick={() => {
            // TODO: stage all — git:stage takes individual file paths, no bulk IPC yet
          }}
        />
        <GhostButton
          label={committing ? 'Committing…' : 'Commit'}
          disabled={!canCommit}
          onClick={() => { void handleCommit() }}
        />
      </div>

      {error && (
        <div
          style={{
            marginTop: 'var(--s-2)',
            fontSize: 'var(--t-sm)',
            color: 'var(--st-failed)'
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// GhostButton — small secondary action button
// ---------------------------------------------------------------------------

interface GhostButtonProps {
  label: string
  disabled?: boolean
  onClick: () => void
}

function GhostButton({ label, disabled = false, onClick }: GhostButtonProps): React.JSX.Element {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        flex: 1,
        height: 26,
        fontSize: 'var(--t-sm)',
        fontFamily: 'var(--font-ui)',
        color: disabled ? 'var(--fg-4)' : 'var(--fg-2)',
        background: 'transparent',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        cursor: disabled ? 'not-allowed' : 'pointer'
      }}
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

interface EmptyStateProps {
  eyebrow: string
  subtitle: string
}

function EmptyState({ eyebrow, subtitle }: EmptyStateProps): React.JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--s-2)',
        padding: 'var(--s-5)',
        textAlign: 'center'
      }}
    >
      <span className="fleet-eyebrow">{eyebrow}</span>
      <span style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-3)' }}>{subtitle}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ScmPanel
// ---------------------------------------------------------------------------

export function ScmPanel({ rootPath }: ScmPanelProps): React.JSX.Element {
  const [status, setStatus] = useState<ScmStatus>({ staged: [], unstaged: [] })
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!rootPath) return
    const path: string = rootPath
    async function fetchStatus(): Promise<void> {
      try {
        const result = await window.api.git.status(path)
        setStatus(parseGitStatus(result.files))
      } catch {
        setStatus({ staged: [], unstaged: [] })
      }
    }
    void fetchStatus()
  }, [rootPath, refreshKey])

  function triggerRefresh(): void {
    setRefreshKey((k) => k + 1)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <PanelHeader eyebrow="SOURCE CONTROL">
        <IconBtn
          icon={<RefreshCw size={14} />}
          title="Refresh"
          onClick={triggerRefresh}
        />
        <IconBtn
          icon={<ExternalLink size={14} />}
          title="Open Source Control"
          onClick={() => {
            // TODO: navigate to Source Control view
          }}
        />
      </PanelHeader>

      {rootPath && (
        <CommitArea
          stagedCount={status.staged.length}
          rootPath={rootPath}
          onStatusReload={triggerRefresh}
        />
      )}

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--line) transparent'
        }}
      >
        {!rootPath ? (
          <EmptyState eyebrow="NO FOLDER OPEN" subtitle="Open a folder to see source control." />
        ) : (
          <>
            <SectionLabel label="STAGED" count={status.staged.length} />
            {status.staged.map((file) => (
              <ScmRow key={file.path} file={file} type="staged" />
            ))}

            <SectionLabel label="CHANGES" count={status.unstaged.length} />
            {status.unstaged.map((file) => (
              <ScmRow key={file.path} file={file} type="unstaged" />
            ))}

            {status.staged.length === 0 && status.unstaged.length === 0 && (
              <EmptyState eyebrow="CLEAN" subtitle="No pending changes." />
            )}
          </>
        )}
      </div>
    </div>
  )
}
