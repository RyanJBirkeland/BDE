import { useEffect, useState } from 'react'
import type * as monacoEditor from 'monaco-editor'
import * as monacoApi from 'monaco-editor'
import { SectionHead } from './SectionHead'
import { CompactAgentRow } from './CompactAgentRow'
import { useIDEStore } from '../../stores/ide'
import { useSprintTasks } from '../../stores/sprintTasks'
import type { InsightSectionKey } from '../../stores/ide'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InsightSectionsProps {
  activeFilePath: string
  editorRef: React.RefObject<monacoEditor.editor.IStandaloneCodeEditor | null>
  rootPath: string | null
}

// ---------------------------------------------------------------------------
// Language display name map
// ---------------------------------------------------------------------------

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
  return LANGUAGE_DISPLAY_NAMES[languageId] ?? capitalize(languageId)
}

function capitalize(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function basenameOf(filePath: string): string {
  return filePath.split('/').pop() ?? filePath
}

// ---------------------------------------------------------------------------
// Shared mini-stat primitive (inline per spec)
// ---------------------------------------------------------------------------

function IDEMiniStat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-1)' }}>
      <span className="fleet-eyebrow">{label}</span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--t-xs)',
          color: 'var(--fg)'
        }}
      >
        {value}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// InsightSections — all five sections
// ---------------------------------------------------------------------------

export function InsightSections({
  activeFilePath,
  editorRef,
  rootPath: _rootPath
}: InsightSectionsProps): React.JSX.Element {
  const insightSections = useIDEStore((s) => s.uiState.insightSectionsOpen)
  const setInsightSectionOpen = useIDEStore((s) => s.setInsightSectionOpen)

  function toggle(key: InsightSectionKey): void {
    setInsightSectionOpen(key, !insightSections[key])
  }

  return (
    <>
      <ThisFileSection
        editorRef={editorRef}
        open={insightSections.thisFile}
        onToggle={() => toggle('thisFile')}
      />
      <AgentsOnFileSection
        open={insightSections.agents}
        onToggle={() => toggle('agents')}
      />
      <TasksReferencingSection
        activeFilePath={activeFilePath}
        open={insightSections.tasks}
        onToggle={() => toggle('tasks')}
      />
      <RecentCommitsSection
        open={insightSections.commits}
        onToggle={() => toggle('commits')}
      />
      <ProblemsSection
        editorRef={editorRef}
        activeFilePath={activeFilePath}
        open={insightSections.problems}
        onToggle={() => toggle('problems')}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Section 1: THIS FILE
// ---------------------------------------------------------------------------

interface ThisFileSectionProps {
  editorRef: React.RefObject<monacoEditor.editor.IStandaloneCodeEditor | null>
  open: boolean
  onToggle: () => void
}

function ThisFileSection({
  editorRef,
  open,
  onToggle
}: ThisFileSectionProps): React.JSX.Element {
  const rawLanguageId = editorRef.current?.getModel()?.getLanguageId() ?? 'plaintext'
  const language = toLanguageDisplayName(rawLanguageId)
  const lineCount = editorRef.current?.getModel()?.getLineCount() ?? 0
  // TODO(phase-6.5): wire agent-file-touch count from the agent-file index
  const agentCount = 0

  return (
    <div style={{ borderBottom: '1px solid var(--line)' }}>
      <SectionHead eyebrow="THIS FILE" open={open} onToggle={onToggle} />
      {open && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 'var(--s-3)',
            padding: 'var(--s-3)'
          }}
        >
          <IDEMiniStat label="STATUS" value="Open" />
          <IDEMiniStat label="LANGUAGE" value={language} />
          <IDEMiniStat label="LINES" value={String(lineCount)} />
          <IDEMiniStat label="AGENTS" value={String(agentCount)} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section 2: AGENTS ON THIS FILE
// ---------------------------------------------------------------------------

interface AgentsOnFileSectionProps {
  open: boolean
  onToggle: () => void
}

function AgentsOnFileSection({ open, onToggle }: AgentsOnFileSectionProps): React.JSX.Element {
  // TODO(phase-6.5): filter by files-touched when agent-file index is available.
  // CompactAgentRow is imported and ready; the list is stubbed empty until the
  // signal exists.
  const agentsOnFile: React.ComponentProps<typeof CompactAgentRow>[] = []

  return (
    <div style={{ borderBottom: '1px solid var(--line)' }}>
      <SectionHead eyebrow="AGENTS ON THIS FILE" open={open} onToggle={onToggle} />
      {open && (
        <div style={{ padding: 'var(--s-1) 0' }}>
          {agentsOnFile.length === 0 ? (
            <span
              style={{
                display: 'block',
                padding: 'var(--s-3)',
                color: 'var(--fg-3)',
                fontSize: 'var(--t-sm)'
              }}
            >
              No agents are touching this file right now.
            </span>
          ) : (
            agentsOnFile.map((props) => <CompactAgentRow key={props.agentId} {...props} />)
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section 3: TASKS REFERENCING
// ---------------------------------------------------------------------------

interface TasksReferencingSectionProps {
  activeFilePath: string
  open: boolean
  onToggle: () => void
}

function TasksReferencingSection({
  activeFilePath,
  open,
  onToggle
}: TasksReferencingSectionProps): React.JSX.Element {
  const allTasks = useSprintTasks((s) => s.tasks)
  const basename = basenameOf(activeFilePath)

  // TODO(phase-6.5): dedicated IPC for file-task index
  const matchingTasks = allTasks
    .filter((t) => {
      const haystack = `${t.title} ${t.spec ?? ''}`
      return haystack.includes(basename)
    })
    .slice(0, 5)

  return (
    <div style={{ borderBottom: '1px solid var(--line)' }}>
      <SectionHead eyebrow="TASKS REFERENCING" open={open} onToggle={onToggle} />
      {open && (
        <div style={{ padding: 'var(--s-1) 0' }}>
          {matchingTasks.length === 0 ? (
            <span
              style={{
                display: 'block',
                padding: 'var(--s-3)',
                color: 'var(--fg-3)',
                fontSize: 'var(--t-sm)'
              }}
            >
              No tasks reference this file.
            </span>
          ) : (
            matchingTasks.map((task) => (
              <div
                key={task.id}
                style={{
                  height: 28,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--s-2)',
                  padding: '0 var(--s-3)',
                  cursor: 'pointer'
                }}
                onClick={() => {
                  /* TODO: open task drawer */
                }}
              >
                <span
                  className={`fleet-dot fleet-dot--${task.status}`}
                  style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0 }}
                />
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 'var(--t-sm)',
                    color: 'var(--fg-2)'
                  }}
                >
                  {task.title}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--t-2xs)',
                    color: 'var(--fg-4)'
                  }}
                >
                  {task.id.slice(0, 8)}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section 4: RECENT COMMITS
// ---------------------------------------------------------------------------

interface RecentCommitsSectionProps {
  open: boolean
  onToggle: () => void
}

function RecentCommitsSection({ open, onToggle }: RecentCommitsSectionProps): React.JSX.Element {
  // TODO(phase-6.5): wire git:fileLog --follow -n 5 -- <path>
  return (
    <div style={{ borderBottom: '1px solid var(--line)' }}>
      <SectionHead eyebrow="RECENT COMMITS" open={open} onToggle={onToggle} />
      {open && (
        <div
          style={{
            padding: 'var(--s-3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--s-2)'
          }}
        >
          <span className="fleet-eyebrow">COMING SOON</span>
          <span style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-3)' }}>
            Recent commits for this file will appear here.
          </span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section 5: PROBLEMS
// ---------------------------------------------------------------------------

interface ProblemsSectionProps {
  editorRef: React.RefObject<monacoEditor.editor.IStandaloneCodeEditor | null>
  activeFilePath: string
  open: boolean
  onToggle: () => void
}

function ProblemsSection({
  editorRef,
  activeFilePath,
  open,
  onToggle
}: ProblemsSectionProps): React.JSX.Element {
  const [markers, setMarkers] = useState<monacoEditor.editor.IMarker[]>([])

  function readMarkers(): void {
    const model = editorRef.current?.getModel()
    if (!model) {
      setMarkers([])
      return
    }
    const all = monacoApi.editor.getModelMarkers({ resource: model.uri })
    setMarkers(all)
  }

  // Re-read markers when the file changes and on a 5-second interval
  useEffect(() => {
    readMarkers()
    const id = setInterval(readMarkers, 5_000)
    return () => clearInterval(id)
  }, [activeFilePath]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ borderBottom: '1px solid var(--line)' }}>
      <SectionHead eyebrow="PROBLEMS" open={open} onToggle={onToggle} />
      {open && (
        <div style={{ padding: 'var(--s-1) 0' }}>
          {markers.length === 0 ? (
            <span
              style={{
                display: 'block',
                padding: 'var(--s-3)',
                color: 'var(--fg-3)',
                fontSize: 'var(--t-sm)'
              }}
            >
              ✓ No problems found.
            </span>
          ) : (
            markers.map((marker) => (
              <div
                key={`${marker.startLineNumber}-${marker.startColumn}`}
                style={{
                  height: 28,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--s-2)',
                  padding: '0 var(--s-3)',
                  cursor: 'pointer'
                }}
                onClick={() => editorRef.current?.revealLineInCenter(marker.startLineNumber)}
              >
                <span
                  style={{
                    color:
                      marker.severity === monacoApi.MarkerSeverity.Error
                        ? 'var(--st-failed)'
                        : 'var(--st-queued)',
                    fontSize: 'var(--t-sm)',
                    flexShrink: 0
                  }}
                >
                  {marker.severity === monacoApi.MarkerSeverity.Error ? '⊘' : '⚠'}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--t-xs)',
                    color: 'var(--fg-3)',
                    flexShrink: 0
                  }}
                >
                  :{marker.startLineNumber}
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
                >
                  {marker.message}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
