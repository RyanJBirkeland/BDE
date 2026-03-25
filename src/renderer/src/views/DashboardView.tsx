import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { useSprintTasks } from '../stores/sprintTasks'
import { useCostDataStore } from '../stores/costData'
import { ActiveTasksCard } from '../components/dashboard/ActiveTasksCard'
import { RecentCompletionsCard } from '../components/dashboard/RecentCompletionsCard'
import { CostSummaryCard } from '../components/dashboard/CostSummaryCard'
import { OpenPRsCard } from '../components/dashboard/OpenPRsCard'
import { tokens } from '../design-system/tokens'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'

export default function DashboardView(): React.JSX.Element {
  const reduced = useReducedMotion()
  const loadData = useSprintTasks((s) => s.loadData)
  const fetchLocalAgents = useCostDataStore((s) => s.fetchLocalAgents)

  useEffect(() => {
    loadData()
    fetchLocalAgents()
  }, [loadData, fetchLocalAgents])

  return (
    <motion.div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflowY: 'auto',
        boxSizing: 'border-box',
        fontFamily: tokens.font.ui,
      }}
      variants={VARIANTS.fadeIn}
      initial="initial"
      animate="animate"
      transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: `${tokens.space[2]} ${tokens.space[4]}`,
          flexShrink: 0,
        }}
      >
        <span className="text-gradient-aurora" style={{
          fontSize: tokens.size.xs,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          Dashboard
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gridTemplateRows: 'auto auto',
          gap: tokens.space[4],
          padding: `0 ${tokens.space[4]} ${tokens.space[4]}`,
          alignContent: 'start',
          flex: 1,
        }}
      >
        <ActiveTasksCard />
        <RecentCompletionsCard />
        <CostSummaryCard />
        <OpenPRsCard />
      </div>
    </motion.div>
  )
}
