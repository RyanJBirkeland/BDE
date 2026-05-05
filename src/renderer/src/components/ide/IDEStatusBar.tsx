import { useEffect, useState } from 'react'
import type * as monaco from 'monaco-editor'
import { useGitTreeStore } from '../../stores/gitTree'
import { useSprintTasks, selectActiveTaskCount } from '../../stores/sprintTasks'
import { Sep } from './Sep'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// TODO(phase-6.5): import from package.json once Vite JSON imports are wired.
const APP_VERSION = '0.1.1'

const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  rust: 'Rust',
  go: 'Go',
  css: 'CSS',
  scss: 'SCSS',
  html: 'HTML',
  xml: 'XML',
  yaml: 'YAML',
  toml: 'TOML',
  shell: 'Shell',
  c: 'C',
  cpp: 'C++',
  java: 'Java',
  ruby: 'Ruby',
  php: 'PHP',
  swift: 'Swift',
  kotlin: 'Kotlin',
  sql: 'SQL',
  graphql: 'GraphQL',
  markdown: 'Markdown',
  json: 'JSON',
  plaintext: 'Plain Text'
}

function toLanguageDisplayName(languageId: string): string {
  const display = LANGUAGE_DISPLAY_NAMES[languageId]
  if (display) return display
  if (!languageId) return 'Plain Text'
  return languageId.charAt(0).toUpperCase() + languageId.slice(1)
}

// ---------------------------------------------------------------------------
// Cursor position tracking
// ---------------------------------------------------------------------------

interface CursorPosition {
  line: number
  column: number
}

function useCursorPosition(
  editorRef: React.RefObject<monaco.editor.IStandaloneCodeEditor | null>
): CursorPosition | null {
  const [position, setPosition] = useState<CursorPosition | null>(null)

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const initial = editor.getPosition()
    if (initial) {
      setPosition({ line: initial.lineNumber, column: initial.column })
    }

    const disposable = editor.onDidChangeCursorPosition((event) => {
      setPosition({ line: event.position.lineNumber, column: event.position.column })
    })

    return () => disposable.dispose()
  }, [editorRef])

  return position
}

// ---------------------------------------------------------------------------
// Language tracking
// ---------------------------------------------------------------------------

function useEditorLanguage(
  editorRef: React.RefObject<monaco.editor.IStandaloneCodeEditor | null>
): string | null {
  const [language, setLanguage] = useState<string | null>(null)

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const readLanguage = (): void => {
      const model = editor.getModel()
      setLanguage(model?.getLanguageId() ?? null)
    }

    readLanguage()
    const disposable = editor.onDidChangeModel(readLanguage)
    return () => disposable.dispose()
  }, [editorRef])

  return language
}

// ---------------------------------------------------------------------------
// Status bar segments
// ---------------------------------------------------------------------------

interface BranchSegmentProps {
  branch: string
}

function BranchSegment({ branch }: BranchSegmentProps): React.JSX.Element {
  return (
    <button
      // TODO: open SCM panel on click
      onClick={() => {}}
      title="Current branch"
      style={{
        background: 'transparent',
        border: 'none',
        color: 'var(--fg-3)',
        font: 'inherit',
        cursor: 'pointer',
        padding: 0,
        display: 'inline-flex',
        alignItems: 'center'
      }}
    >
      <span style={{ marginRight: 'var(--s-1)' }}>⎇</span>
      {branch}
    </button>
  )
}

interface AgentActivitySegmentProps {
  count: number
}

function AgentActivitySegment({ count }: AgentActivitySegmentProps): React.JSX.Element {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--s-1)',
        color: 'var(--st-running)'
      }}
    >
      <span
        className="fleet-pulse"
        aria-hidden
        style={{ width: 6, height: 6, borderRadius: '50%' }}
      />
      {count} running
    </span>
  )
}

function DrainPausedSegment(): React.JSX.Element {
  return <span style={{ color: 'var(--st-failed)' }}>⏸ Drain paused</span>
}

interface CursorSegmentProps {
  position: CursorPosition
}

function CursorSegment({ position }: CursorSegmentProps): React.JSX.Element {
  return (
    <span>
      Ln {position.line}, Col {position.column}
    </span>
  )
}

interface LanguageSegmentProps {
  languageId: string
  onClick: () => void
}

function LanguageSegment({ languageId, onClick }: LanguageSegmentProps): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      title="Change language mode"
      style={{
        background: 'transparent',
        border: 'none',
        color: 'var(--fg-3)',
        font: 'inherit',
        cursor: 'pointer',
        padding: 0
      }}
    >
      {toLanguageDisplayName(languageId)}
    </button>
  )
}

// ---------------------------------------------------------------------------
// IDEStatusBar
// ---------------------------------------------------------------------------

export interface IDEStatusBarProps {
  editorRef: React.RefObject<monaco.editor.IStandaloneCodeEditor | null>
}

export function IDEStatusBar({ editorRef }: IDEStatusBarProps): React.JSX.Element {
  const branch = useGitTreeStore((s) => s.branch)
  const activeAgentCount = useSprintTasks(selectActiveTaskCount)
  const cursorPosition = useCursorPosition(editorRef)
  const languageId = useEditorLanguage(editorRef)

  // TODO: read drain state from a renderer-side store once one exists.
  const drainPaused = false

  const branchLabel = branch || 'main'

  function handleChangeLanguage(): void {
    const editor = editorRef.current
    if (!editor) return
    editor.getAction('editor.action.changeLanguageMode')?.run()
  }

  return (
    <footer
      role="status"
      aria-label="IDE status bar"
      style={{
        height: 28,
        background: 'var(--surf-2)',
        borderTop: '1px solid var(--line)',
        padding: '0 var(--s-3)',
        display: 'flex',
        alignItems: 'center',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-xs)',
        color: 'var(--fg-3)',
        flexShrink: 0
      }}
    >
      <BranchSegment branch={branchLabel} />

      {activeAgentCount > 0 && (
        <>
          <Sep />
          <AgentActivitySegment count={activeAgentCount} />
        </>
      )}

      {drainPaused && (
        <>
          <Sep />
          <DrainPausedSegment />
        </>
      )}

      {cursorPosition && (
        <>
          <Sep />
          <CursorSegment position={cursorPosition} />
        </>
      )}

      <Sep />
      {/* TODO(phase-6.5): read indent setting from Monaco model options */}
      <span>Spaces: 2</span>

      <Sep />
      <span>UTF-8</span>

      <Sep />
      <span>LF</span>

      <span style={{ flex: 1 }} />

      {languageId && (
        <>
          <LanguageSegment languageId={languageId} onClick={handleChangeLanguage} />
          <Sep />
        </>
      )}

      <span style={{ color: 'var(--fg-4)' }}>FLEET v{APP_VERSION}</span>
    </footer>
  )
}
