import { useState } from 'react'
import { RefreshCw, Filter } from 'lucide-react'
import { PanelHeader } from '../PanelHeader'
import { IconBtn } from '../IconBtn'
import { CompactAgentRow } from '../CompactAgentRow'
import type { CompactAgentRowProps } from '../CompactAgentRow'
import { useAgentHistoryStore } from '../../../stores/agentHistory'
import type { AgentMeta } from '../../../stores/agentHistory'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AgentsOnTreePanelProps {
  rootPath: string | null
  onAgentClick: (agentId: string) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_AGENT_ROWS = 20

function toCompactStatus(meta: AgentMeta): CompactAgentRowProps['status'] {
  // AgentMeta.status: 'running' | 'done' | 'failed' | 'cancelled' | 'unknown'
  // CompactAgentRowProps.status: 'running' | 'done' | 'failed' | 'review' | 'cancelled' | 'error'
  if (meta.status === 'unknown') return 'failed'
  return meta.status
}

function rootBasename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

function agentBelongsToWorkspace(agent: AgentMeta, rootPath: string): boolean {
  const workspaceBasename = rootBasename(rootPath)
  const agentRepoBasename = rootBasename(agent.repo)
  return agentRepoBasename.toLowerCase() === workspaceBasename.toLowerCase()
}

function sortAgents(agents: AgentMeta[]): AgentMeta[] {
  return [...agents].sort((a, b) => {
    const aRunning = a.status === 'running'
    const bRunning = b.status === 'running'

    if (aRunning !== bRunning) return aRunning ? -1 : 1

    if (aRunning && bRunning) {
      return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    }

    const aFinished = a.finishedAt ? new Date(a.finishedAt).getTime() : 0
    const bFinished = b.finishedAt ? new Date(b.finishedAt).getTime() : 0
    return bFinished - aFinished
  })
}

// ---------------------------------------------------------------------------
// AgentsOnTreePanel
// ---------------------------------------------------------------------------

export function AgentsOnTreePanel({
  rootPath,
  onAgentClick
}: AgentsOnTreePanelProps): React.JSX.Element {
  const [filterRunning, setFilterRunning] = useState(false)
  const agents = useAgentHistoryStore((s) => s.agents)
  const fetchAgents = useAgentHistoryStore((s) => s.fetchAgents)

  const workspaceAgents = rootPath
    ? agents.filter((agent) => agentBelongsToWorkspace(agent, rootPath))
    : agents

  const visibleAgents = sortAgents(
    filterRunning ? workspaceAgents.filter((a) => a.status === 'running') : workspaceAgents
  ).slice(0, MAX_AGENT_ROWS)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <PanelHeader eyebrow="AGENTS · TREE">
        <IconBtn
          icon={<RefreshCw size={14} />}
          title="Refresh"
          onClick={() => { void fetchAgents() }}
        />
        <IconBtn
          icon={<Filter size={14} />}
          title="Filter: running only"
          active={filterRunning}
          onClick={() => setFilterRunning((v) => !v)}
        />
      </PanelHeader>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--s-1) var(--s-2)',
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--line) transparent'
        }}
      >
        {visibleAgents.length === 0 ? (
          <EmptyState />
        ) : (
          visibleAgents.map((agent) => {
            const totalTokens =
              agent.tokensIn != null && agent.tokensOut != null
                ? agent.tokensIn + agent.tokensOut
                : undefined
            const extraProps = totalTokens !== undefined ? { tokenCount: totalTokens } : {}
            return (
              <CompactAgentRow
                key={agent.id}
                agentId={agent.task || agent.id}
                status={toCompactStatus(agent)}
                {...extraProps}
                onClick={() => onAgentClick(agent.id)}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

function EmptyState(): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 'var(--s-2)',
        padding: 'var(--s-5)',
        textAlign: 'center'
      }}
    >
      <span className="fleet-eyebrow">NO AGENTS HERE</span>
      <span style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-3)' }}>
        Agents working in this workspace will appear here.
      </span>
    </div>
  )
}
