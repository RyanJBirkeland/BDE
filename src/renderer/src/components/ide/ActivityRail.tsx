import { useEffect, useRef, useState } from 'react'
import { Bot, Files, GitBranch, List, PanelRight, Search } from 'lucide-react'
import { useAgentHistoryStore } from '../../stores/agentHistory'
import { useIDEStore } from '../../stores/ide'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActivityMode = 'files' | 'search' | 'scm' | 'outline' | 'agents'

interface ActivityRailProps {
  activity: ActivityMode
  onChange: (mode: ActivityMode) => void
  insightOpen: boolean
  onToggleInsight: () => void
}

// ---------------------------------------------------------------------------
// Mode button config
// ---------------------------------------------------------------------------

interface ModeButton {
  id: ActivityMode
  label: string
  icon: React.ReactNode
  shortcut: string
}

const MODE_BUTTONS: ModeButton[] = [
  { id: 'files', label: 'Files', icon: <Files size={16} />, shortcut: '⌘1' },
  { id: 'search', label: 'Search', icon: <Search size={16} />, shortcut: '⌘⇧F' },
  { id: 'scm', label: 'Source Control', icon: <GitBranch size={16} />, shortcut: '⌘⇧G' },
  { id: 'outline', label: 'Outline', icon: <List size={16} />, shortcut: '⌘⇧O' },
  { id: 'agents', label: 'Agents', icon: <Bot size={16} />, shortcut: '⌘⇧A' }
]

// ---------------------------------------------------------------------------
// Unread dot logic
// ---------------------------------------------------------------------------

type DotColor = 'running' | 'failed' | 'done' | null

function useAgentUnreadDot(activity: ActivityMode): DotColor {
  const agents = useAgentHistoryStore((s) => s.agents)
  const rootPath = useIDEStore((s) => s.rootPath)

  // Track when the Agents panel was last opened
  const lastOpenedAtRef = useRef<number>(Date.now())

  useEffect(() => {
    if (activity === 'agents') {
      lastOpenedAtRef.current = Date.now()
    }
  }, [activity])

  if (activity === 'agents') {
    // Panel is open — no dot to show
    return null
  }

  // Filter agents by repo basename matching the IDE root
  const repoBasename = rootPath ? rootPath.split('/').pop() : null
  const workspaceAgents =
    repoBasename != null
      ? agents.filter((a) => a.repo.toLowerCase() === repoBasename.toLowerCase())
      : agents

  const lastOpenedAt = lastOpenedAtRef.current

  // Any agent that finished after the panel was last opened
  const hasNewlyFinished = workspaceAgents.some((a) => {
    if (a.status === 'running') return false
    if (a.finishedAt == null) return false
    const finishedMs = new Date(a.finishedAt).getTime()
    return finishedMs > lastOpenedAt
  })

  if (!hasNewlyFinished) return null

  // Determine dot color: running > failed > done
  const hasRunning = workspaceAgents.some((a) => a.status === 'running')
  if (hasRunning) return 'running'

  const hasFailed = workspaceAgents.some(
    (a) =>
      (a.status === 'failed' || a.status === 'cancelled') &&
      a.finishedAt != null &&
      new Date(a.finishedAt).getTime() > lastOpenedAt
  )
  if (hasFailed) return 'failed'

  return 'done'
}

function resolveDotColor(dot: NonNullable<DotColor>): string {
  if (dot === 'running') return 'var(--st-running)'
  if (dot === 'failed') return 'var(--st-failed)'
  return 'var(--st-done)'
}

// ---------------------------------------------------------------------------
// Individual mode button
// ---------------------------------------------------------------------------

interface RailButtonProps {
  mode: ModeButton
  isActive: boolean
  onClick: () => void
  dotColor?: DotColor | undefined
}

function RailButton({ mode, isActive, onClick, dotColor }: RailButtonProps): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)

  const backgroundColor = isActive ? 'var(--accent-soft)' : hovered ? 'var(--surf-2)' : 'transparent'
  const color = isActive ? 'var(--accent)' : hovered ? 'var(--fg-2)' : 'var(--fg-3)'
  const outline = focused ? '2px solid var(--accent-line)' : 'none'

  return (
    <button
      title={`${mode.label} (${mode.shortcut})`}
      aria-label={`${mode.label} (${mode.shortcut})`}
      aria-pressed={isActive}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        position: 'relative',
        width: 36,
        height: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 'var(--r-md)',
        border: 'none',
        background: backgroundColor,
        color,
        cursor: 'pointer',
        padding: 0,
        flexShrink: 0,
        outline,
        outlineOffset: outline !== 'none' ? '2px' : '0px',
        transition: `background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)`
      }}
    >
      {isActive && (
        <span
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 2,
            background: 'var(--accent)',
            borderRadius: '0 2px 2px 0'
          }}
        />
      )}

      {mode.icon}

      {dotColor != null && (
        <span
          style={{
            position: 'absolute',
            bottom: 4,
            right: 4,
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: resolveDotColor(dotColor)
          }}
        />
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Insight toggle button (footer)
// ---------------------------------------------------------------------------

interface InsightToggleProps {
  insightOpen: boolean
  onToggle: () => void
}

function InsightToggle({ insightOpen, onToggle }: InsightToggleProps): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)

  const backgroundColor = insightOpen
    ? 'var(--accent-soft)'
    : hovered
      ? 'var(--surf-2)'
      : 'transparent'
  const color = insightOpen ? 'var(--accent)' : hovered ? 'var(--fg-2)' : 'var(--fg-3)'
  const outline = focused ? '2px solid var(--accent-line)' : 'none'

  return (
    <button
      title="Insight Rail (⌘⌥I)"
      aria-label="Insight Rail (⌘⌥I)"
      aria-pressed={insightOpen}
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        position: 'relative',
        width: 36,
        height: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 'var(--r-md)',
        border: 'none',
        background: backgroundColor,
        color,
        cursor: 'pointer',
        padding: 0,
        flexShrink: 0,
        marginTop: 'auto',
        outline,
        outlineOffset: outline !== 'none' ? '2px' : '0px',
        transition: `background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)`
      }}
    >
      <PanelRight size={16} />
    </button>
  )
}

// ---------------------------------------------------------------------------
// ActivityRail
// ---------------------------------------------------------------------------

export function ActivityRail({
  activity,
  onChange,
  insightOpen,
  onToggleInsight
}: ActivityRailProps): React.JSX.Element {
  const agentDotColor = useAgentUnreadDot(activity)

  return (
    <nav
      aria-label="IDE activity modes"
      style={{
        width: 44,
        height: '100%',
        flexShrink: 0,
        background: 'var(--surf-1)',
        borderRight: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 'var(--s-2) 0',
        gap: 'var(--s-1)'
      }}
    >
      {MODE_BUTTONS.map((mode) => (
        <RailButton
          key={mode.id}
          mode={mode}
          isActive={activity === mode.id}
          onClick={() => onChange(mode.id)}
          dotColor={mode.id === 'agents' ? agentDotColor : undefined}
        />
      ))}

      <InsightToggle insightOpen={insightOpen} onToggle={onToggleInsight} />
    </nav>
  )
}
