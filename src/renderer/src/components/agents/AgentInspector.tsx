import './AgentInspector.css'
import { FileText } from 'lucide-react'
import type { AgentMeta, AgentEvent } from '../../../../shared/types'
import { MiniStat } from '../sprint/primitives/MiniStat'
import { MicroSpark } from '../dashboard/primitives/MicroSpark'
import { formatDuration, formatElapsed } from '../../lib/format'

interface AgentInspectorProps {
  agent: AgentMeta
  events: AgentEvent[]
}

interface SectionProps {
  eyebrow: string
  title: string
  right?: React.ReactNode
  children: React.ReactNode
}

function Section({ eyebrow, title, right, children }: SectionProps): React.JSX.Element {
  return (
    <div style={{ padding: 'var(--s-3) var(--s-4)', borderBottom: '1px solid var(--line)' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 'var(--s-2)',
        }}
      >
        <div>
          <div className="fleet-eyebrow">{eyebrow}</div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg)', marginTop: 2 }}>
            {title}
          </div>
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

function deriveFilesTouched(events: AgentEvent[]): string[] {
  const seen = new Set<string>()
  const files: string[] = []

  for (const event of events) {
    if (event.type !== 'agent:tool_call') continue
    const input = event.input as Record<string, unknown> | null | undefined
    if (input == null) continue
    const path =
      typeof input['path'] === 'string'
        ? input['path']
        : typeof input['file_path'] === 'string'
          ? input['file_path']
          : null
    if (path == null || path.length === 0) continue
    if (seen.has(path)) continue
    seen.add(path)
    files.push(path)
    if (files.length >= 15) break
  }

  return files
}

function deriveTokenSparkPoints(events: AgentEvent[]): number[] {
  return events
    .filter((e): e is Extract<AgentEvent, { type: 'agent:completed' }> => e.type === 'agent:completed')
    .map((e) => e.tokensIn)
    .slice(-20)
}

function mapEventToStatusClass(event: AgentEvent): string {
  if (event.type === 'agent:tool_call' || event.type === 'agent:tool_result') return 'running'
  if (event.type === 'agent:completed') return 'done'
  if (event.type === 'agent:error') return 'failed'
  return 'queued'
}

function deriveElapsed(agent: AgentMeta): string {
  if (agent.status === 'running') return formatElapsed(agent.startedAt)
  return formatDuration(agent.startedAt, agent.finishedAt) || '—'
}

export function AgentInspector({ agent, events }: AgentInspectorProps): React.JSX.Element {
  const elapsed = deriveElapsed(agent)
  const totalTokens = (agent.tokensIn ?? 0) + (agent.tokensOut ?? 0)
  const toolCallCount = events.filter((e) => e.type === 'agent:tool_call').length
  const filesTouched = deriveFilesTouched(events)
  const tokenSparkPoints = deriveTokenSparkPoints(events)
  const recentEvents = [...events].reverse().slice(0, 10)
  const branchLabel = agent.branch ?? `agent/${agent.id.slice(0, 8)}`

  return (
    <div className="agent-inspector">

      {/* §6.1 Task prompt — the text passed to the agent at spawn time */}
      <Section eyebrow="SENT TO AGENT" title="Task prompt">
        <pre
          style={{
            background: 'var(--surf-1)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-md)',
            padding: 'var(--s-2) var(--s-3)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--fg-2)',
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 100,
            overflowY: 'auto',
            margin: 0,
          }}
        >
          {/* TODO(verify): agent.task is the short label — the full spawn-time prompt
              is not yet stored on AgentMeta. Replace with the actual prompt field
              once it is surfaced via IPC (sprint:getAgentPrompt or similar). */}
          {agent.task ?? 'No prompt recorded'}
        </pre>
      </Section>

      {/* §6.2 Task spec — the spec file on disk in the worktree */}
      <Section
        eyebrow="ON DISK"
        title="Task spec"
        right={
          <button
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--accent)',
              fontSize: 11,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            Open in IDE
          </button>
        }
      >
        {/* TODO(verify): spec file path is inferred from worktreePath — the actual
            spec filename/location depends on pipeline conventions. Confirm and
            update once the IPC layer exposes this directly. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
          <FileText size={12} style={{ color: 'var(--fg-4)', flexShrink: 0 }} />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--fg-2)',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {agent.worktreePath != null
              ? `${agent.worktreePath}/spec.md`
              : 'No spec file'}
          </span>
        </div>
      </Section>

      {/* §6.3 Worktree — git context for the agent's isolated workspace */}
      <Section eyebrow="WORKSPACE" title="Worktree">
        {/* TODO(verify): branch + diff stats are placeholders; live data requires
            a git:status call against agent.worktreePath. */}
        {(
          [
            { key: 'branch', value: branchLabel },
            { key: 'base', value: 'main · ↑0 ↓0' },
            { key: 'path', value: agent.worktreePath ?? '—' },
            { key: 'diff', value: '+0 −0 · 0 files' },
          ] as const
        ).map(({ key, value }) => (
          <div
            key={key}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: 'var(--s-1) 0',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
            }}
          >
            <span style={{ color: 'var(--fg-3)' }}>{key}</span>
            <span
              style={{
                color: 'var(--fg)',
                maxWidth: 160,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {value}
            </span>
          </div>
        ))}
      </Section>

      {/* §6.4 Files touched — unique file paths seen in tool_call events */}
      <Section
        eyebrow="SCOPE"
        title="Files touched"
        right={
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-3)' }}>
            {filesTouched.length}
          </span>
        }
      >
        {filesTouched.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--fg-4)' }}>No file events yet</div>
        ) : (
          filesTouched.map((path, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '5px 0',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
              }}
            >
              <span
                style={{
                  flex: 1,
                  color: 'var(--fg-2)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {path}
              </span>
            </div>
          ))
        )}
      </Section>

      {/* §6.5 Run metrics — token usage, cost, tools called, elapsed time */}
      <Section eyebrow="TELEMETRY" title="Run metrics">
        {tokenSparkPoints.length >= 2 && (
          <div style={{ marginBottom: 'var(--s-2)' }}>
            <MicroSpark accent="running" points={tokenSparkPoints} />
          </div>
        )}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 'var(--s-2)',
          }}
        >
          <MiniStat
            label="tokens"
            value={totalTokens > 0 ? `${Math.round(totalTokens / 1_000)}k` : '—'}
          />
          <MiniStat
            label="cost"
            value={agent.costUsd != null ? `$${agent.costUsd.toFixed(4)}` : '—'}
          />
          <MiniStat label="tools" value={String(toolCallCount)} />
          <MiniStat label="elapsed" value={elapsed} />
        </div>
      </Section>

      {/* §6.6 Recent timeline — last 10 events, most recent first */}
      <Section eyebrow="TRACE" title="Recent timeline">
        {recentEvents.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--fg-4)' }}>No events yet</div>
        ) : (
          recentEvents.map((event, i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '60px 8px 1fr',
                gap: 'var(--s-2)',
                padding: 'var(--s-1) 0',
                alignItems: 'center',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
              }}
            >
              <span style={{ color: 'var(--fg-4)' }}>
                {new Date(event.timestamp).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
              <span
                className={`fleet-dot--${mapEventToStatusClass(event)}`}
                style={{ width: 6, height: 6 }}
              />
              <span
                style={{
                  color: 'var(--fg-2)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {event.type.replace('agent:', '')}
              </span>
            </div>
          ))
        )}
      </Section>
    </div>
  )
}
