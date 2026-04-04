import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { useSprintTasks } from '../../stores/sprintTasks'
import { formatElapsed } from '../../lib/format'
import type { AgentManagerActiveAgent } from '../../../../shared/types'

/**
 * Floating agent monitor widget — fixed bottom-right position.
 * Shows active agent count (collapsed) or per-agent details (expanded).
 * Auto-hides when no agents are active.
 */
export function AgentMonitor(): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [activeAgents, setActiveAgents] = useState<AgentManagerActiveAgent[]>([])
  const tasks = useSprintTasks((s) => s.tasks)

  // Poll agent manager status every 2s
  useEffect(() => {
    let mounted = true

    const fetchStatus = async (): Promise<void> => {
      try {
        const status = await window.api.agentManager.status()
        if (mounted) {
          setActiveAgents(status.activeAgents ?? [])
        }
      } catch (err) {
        console.error('[AgentMonitor] fetch failed:', err)
      }
    }

    fetchStatus()
    const interval = setInterval(fetchStatus, 2000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  // Force re-render every second for live elapsed time updates
  useEffect(() => {
    const interval = setInterval(() => setActiveAgents((prev) => [...prev]), 1000)
    return () => clearInterval(interval)
  }, [])

  // Auto-hide when no agents active
  if (activeAgents.length === 0) return <></>

  const taskMap = new Map(tasks.map((t) => [t.id, t]))

  return (
    <AnimatePresence>
      <motion.div
        className="agent-monitor"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.2 }}
      >
        {/* Collapsed pill */}
        {!expanded && (
          <button
            className="agent-monitor__pill"
            onClick={() => setExpanded(true)}
            aria-label={`${activeAgents.length} agents running. Click to expand.`}
          >
            <span className="agent-monitor__count">{activeAgents.length}</span>
            <span className="agent-monitor__label">
              agent{activeAgents.length === 1 ? '' : 's'} running
            </span>
            <ChevronUp className="agent-monitor__icon" size={16} />
          </button>
        )}

        {/* Expanded card */}
        {expanded && (
          <motion.div
            className="agent-monitor__card"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="agent-monitor__header">
              <span className="agent-monitor__title">Active Agents</span>
              <button
                className="agent-monitor__collapse-btn"
                onClick={() => setExpanded(false)}
                aria-label="Collapse agent monitor"
              >
                <ChevronDown size={16} />
              </button>
            </div>

            <div className="agent-monitor__list">
              {activeAgents.map((agent) => {
                const task = taskMap.get(agent.taskId)
                const title = task?.title ?? agent.taskId.slice(0, 8)
                const elapsed = formatElapsed(agent.startedAt)
                const cost = agent.costUsd.toFixed(4)

                return (
                  <div key={agent.agentRunId} className="agent-monitor__row">
                    <div className="agent-monitor__task-title">{title}</div>
                    <div className="agent-monitor__meta">
                      <span className="agent-monitor__elapsed">{elapsed}</span>
                      <span className="agent-monitor__cost">${cost}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
