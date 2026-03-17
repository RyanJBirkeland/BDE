import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Users } from 'lucide-react'
import { AgentRow } from './AgentRow'
import { EmptyState } from '../ui/EmptyState'
import type { UnifiedAgent } from '../../hooks/useUnifiedAgents'
import { useUnifiedAgents, groupUnifiedAgents } from '../../hooks/useUnifiedAgents'
import { useSessionsStore } from '../../stores/sessions'
import { useLocalAgentsStore } from '../../stores/localAgents'
import { useAgentHistoryStore } from '../../stores/agentHistory'
import { useUIStore } from '../../stores/ui'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'

export interface AgentListProps {
  filter?: string
  selectedId: string | null
  onSelect: (id: string) => void
  onKill: (agent: UnifiedAgent) => void
  onSteer: (agent: UnifiedAgent) => void
  onSpawn?: () => void
}

const HISTORY_LIMIT = 20

export function AgentList({
  filter,
  selectedId,
  onSelect,
  onKill,
  onSteer,
  onSpawn
}: AgentListProps): React.JSX.Element {
  const agents = useUnifiedAgents()
  const reduced = useReducedMotion()
  const loading = useSessionsStore((s) => s.loading)
  const followMode = useSessionsStore((s) => s.followMode)
  const setFollowMode = useSessionsStore((s) => s.setFollowMode)
  const [historyOpen, setHistoryOpen] = useState(false)

  // Poll local agent processes (ps aux) and history — only when sessions view is active
  const activeView = useUIStore((s) => s.activeView)
  const fetchProcesses = useLocalAgentsStore((s) => s.fetchProcesses)
  const fetchAgents = useAgentHistoryStore((s) => s.fetchAgents)
  useEffect(() => {
    if (activeView !== 'sessions') return
    fetchProcesses()
    fetchAgents()
    const processInterval = setInterval(fetchProcesses, 15_000)
    const historyInterval = setInterval(fetchAgents, 10_000)
    return () => {
      clearInterval(processInterval)
      clearInterval(historyInterval)
    }
  }, [fetchProcesses, fetchAgents, activeView])

  const toggleHistory = useCallback(() => setHistoryOpen((v) => !v), [])
  const toggleFollow = useCallback(
    () => setFollowMode(!followMode),
    [followMode, setFollowMode]
  )

  const trimmedFilter = (filter ?? '').trim().toLowerCase()

  const filtered = useMemo(() => {
    if (!trimmedFilter) return agents
    return agents.filter(
      (a) =>
        a.label.toLowerCase().includes(trimmedFilter) ||
        (a.task && a.task.toLowerCase().includes(trimmedFilter))
    )
  }, [agents, trimmedFilter])

  // Loading skeletons during initial fetch
  if (loading && agents.length === 0) {
    return (
      <div className="agent-list">
        <div className="session-list__loading">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bde-skeleton session-list__skeleton" />
          ))}
        </div>
      </div>
    )
  }

  // Filter active with no matches
  if (trimmedFilter && filtered.length === 0) {
    return (
      <div className="agent-list">
        <div className="agent-list__empty">
          No agents match &apos;{filter!.trim()}&apos;
        </div>
      </div>
    )
  }

  // No agents at all
  if (agents.length === 0) {
    return (
      <div className="agent-list">
        <EmptyState
          icon={<Users size={24} />}
          title="No active sessions"
          description="Spawn an agent to get started"
          action={onSpawn ? { label: 'Spawn Agent', onClick: onSpawn } : undefined}
        />
      </div>
    )
  }

  const { active, recent, history } = groupUnifiedAgents(filtered)
  const historyVisible = historyOpen ? history.slice(0, HISTORY_LIMIT) : []

  return (
    <div className="agent-list">
      {/* ACTIVE — hidden when empty */}
      {active.length > 0 && (
        <div className="agent-list__group">
          <div className="agent-list__group-header">
            <span>ACTIVE ({active.length})</span>
            <button
              className={`agent-list__follow-btn ${followMode ? 'agent-list__follow-btn--on' : ''}`}
              onClick={toggleFollow}
              title={followMode ? 'Auto-follow ON' : 'Auto-follow OFF'}
            >
              {followMode ? '\uD83D\uDCCC Following' : '\uD83D\uDCCC Follow'}
            </button>
          </div>
          <motion.ul
            variants={VARIANTS.staggerContainer}
            initial="initial"
            animate="animate"
          >
            {active.map((a) => (
              <motion.li
                key={a.id}
                variants={VARIANTS.slideUp}
                transition={reduced ? REDUCED_TRANSITION : SPRINGS.default}
              >
                <AgentRow
                  agent={a}
                  isSelected={a.id === selectedId}
                  onSelect={() => onSelect(a.id)}
                  onKill={() => onKill(a)}
                  onSteer={() => onSteer(a)}
                />
              </motion.li>
            ))}
          </motion.ul>
        </div>
      )}

      {/* RECENT — hidden when empty */}
      {recent.length > 0 && (
        <div className="agent-list__group">
          <div className="agent-list__group-header">
            <span>RECENT ({recent.length})</span>
          </div>
          <motion.ul
            variants={VARIANTS.staggerContainer}
            initial="initial"
            animate="animate"
          >
            {recent.map((a) => (
              <motion.li
                key={a.id}
                variants={VARIANTS.slideUp}
                transition={reduced ? REDUCED_TRANSITION : SPRINGS.default}
              >
                <AgentRow
                  agent={a}
                  isSelected={a.id === selectedId}
                  onSelect={() => onSelect(a.id)}
                  onKill={() => onKill(a)}
                  onSteer={() => onSteer(a)}
                />
              </motion.li>
            ))}
          </motion.ul>
        </div>
      )}

      {/* HISTORY — header always shown, collapsed by default */}
      <div className="agent-list__group">
        <div
          className="agent-list__group-header agent-list__group-header--collapsible"
          onClick={toggleHistory}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') toggleHistory()
          }}
        >
          <span>
            {historyOpen ? '\u25BE' : '\u25B8'} HISTORY ({history.length})
          </span>
        </div>
        <motion.ul
          variants={VARIANTS.staggerContainer}
          initial="initial"
          animate="animate"
        >
          {historyVisible.map((a) => (
            <motion.li
              key={a.id}
              variants={VARIANTS.slideUp}
              transition={reduced ? REDUCED_TRANSITION : SPRINGS.default}
            >
              <AgentRow
                agent={a}
                isSelected={a.id === selectedId}
                onSelect={() => onSelect(a.id)}
                onKill={() => onKill(a)}
                onSteer={() => onSteer(a)}
              />
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </div>
  )
}
