import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useShallow } from 'zustand/react/shallow'
import { useSprintTasks } from '../stores/sprintTasks'
import { useCostDataStore } from '../stores/costData'
import { useDashboardDataStore } from '../stores/dashboardData'
import { useSprintUI, type StatusFilter } from '../stores/sprintUI'
import { usePanelLayoutStore } from '../stores/panelLayout'
import { useDashboardMetrics } from '../hooks/useDashboardMetrics'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION } from '../lib/motion'
import { StatusBar, NeonCard, ParticleField } from '../components/neon'
import { neonVar } from '../components/neon/types'
import { partitionSprintTasks } from '../lib/partitionSprintTasks'
import {
  StatusCounters,
  CenterColumn,
  ActivitySection,
  MorningBriefing
} from '../components/dashboard'
import '../assets/dashboard-neon.css'
import { Plus } from 'lucide-react'
import { useCommandPaletteStore, type Command } from '../stores/commandPalette'

export default function DashboardView(): React.JSX.Element {
  const reduced = useReducedMotion()
  const tasks = useSprintTasks((s) => s.tasks)
  const loadSprintData = useSprintTasks((s) => s.loadData)
  const localAgents = useCostDataStore((s) => s.localAgents)
  const setStatusFilter = useSprintUI((s) => s.setStatusFilter)
  const setSearchQuery = useSprintUI((s) => s.setSearchQuery)
  const setView = usePanelLayoutStore((s) => s.setView)
  const fetchDashboardData = useDashboardDataStore((s) => s.fetchAll)
  const registerCommands = useCommandPaletteStore((s) => s.registerCommands)
  const unregisterCommands = useCommandPaletteStore((s) => s.unregisterCommands)

  // Morning briefing state
  const [showBriefing, setShowBriefing] = useState(false)
  const [briefingTasks, setBriefingTasks] = useState<typeof tasks>([])
  const briefingChecked = useRef(false)

  // Check for new completions when tasks load (runs once)
  useEffect(() => {
    if (briefingChecked.current || tasks.length === 0) return
    briefingChecked.current = true

    const lastClose = localStorage.getItem('bde:last-window-close')
    if (!lastClose) return

    const lastCloseTime = parseInt(lastClose, 10)
    if (isNaN(lastCloseTime)) return

    const newCompletions = tasks.filter((task) => {
      if (!task.completed_at) return false
      return new Date(task.completed_at).getTime() > lastCloseTime
    })

    if (newCompletions.length > 0) {
      // Safe to set state here - guarded by briefingChecked to prevent cascading renders
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBriefingTasks(newCompletions)
      setShowBriefing(true)
    }
  }, [tasks])

  const handleDismissBriefing = useCallback(() => {
    localStorage.setItem('bde:last-window-close', Date.now().toString())
    setShowBriefing(false)
  }, [])

  // Dashboard data from centralized polling
  const { chartData, burndownData, feedEvents, loading, cardErrors, lastFetchedAt } =
    useDashboardDataStore(
      useShallow((s) => ({
        chartData: s.chartData,
        burndownData: s.burndownData,
        feedEvents: s.feedEvents,
        loading: s.loading,
        cardErrors: s.cardErrors,
        lastFetchedAt: s.lastFetchedAt
      }))
    )

  // Timestamp counter to re-evaluate freshness every 10s
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(interval)
  }, [])

  // Register dashboard commands in command palette
  const handleRefreshDashboard = useCallback(() => {
    loadSprintData()
    fetchDashboardData()
  }, [loadSprintData, fetchDashboardData])

  useEffect(() => {
    const commands: Command[] = [
      {
        id: 'dashboard-refresh',
        label: 'Refresh Dashboard',
        category: 'action',
        keywords: ['refresh', 'reload', 'dashboard', 'update'],
        action: handleRefreshDashboard
      }
    ]

    registerCommands(commands)

    return () => {
      unregisterCommands(commands.map((c) => c.id))
    }
  }, [handleRefreshDashboard, registerCommands, unregisterCommands])

  // Freshness: how long ago data was last fetched, and whether it's stale (>2min)
  const freshness = useMemo(() => {
    if (!lastFetchedAt) return { text: '', stale: false }
    const ago = Math.floor((now - lastFetchedAt) / 1000)
    const text = ago < 10 ? 'just now' : ago < 60 ? `${ago}s ago` : `${Math.floor(ago / 60)}m ago`
    return { text, stale: ago > 120 }
  }, [lastFetchedAt, now])

  /** Navigate to Sprint Center with a pre-applied status filter. */
  const navigateToSprintWithFilter = useCallback(
    (status: StatusFilter) => {
      setSearchQuery('')
      setStatusFilter(status)
      setView('sprint')
    },
    [setStatusFilter, setSearchQuery, setView]
  )

  const handleCompletionClick = useCallback(() => {
    navigateToSprintWithFilter('done')
  }, [navigateToSprintWithFilter])

  const partitions = useMemo(() => partitionSprintTasks(tasks), [tasks])

  // Dashboard metrics — extracted to reusable hook
  const {
    stats,
    successRate,
    avgDuration,
    avgTaskDuration,
    taskDurationCount,
    costTrendData,
    costAvg,
    recentCompletions,
    cost24h,
    taskCostMap
  } = useDashboardMetrics()

  const errorCount = useMemo(() => Object.values(cardErrors).filter(Boolean).length, [cardErrors])

  // TODO: Compute actual success trend data
  const successTrendData = useMemo(() => [], [])

  const transition = reduced ? REDUCED_TRANSITION : SPRINGS.snappy

  return (
    <motion.div
      className="dashboard-root"
      variants={reduced ? undefined : VARIANTS.fadeIn}
      initial={reduced ? undefined : 'initial'}
      animate={reduced ? undefined : 'animate'}
      transition={transition}
    >
      {/* Background effects (ScanlineOverlay removed for data readability) */}
      {!reduced && <ParticleField />}
      <div className="dashboard-bg-gradient" />

      {/* Content (above effects) */}
      <div className="dashboard-content">
        <StatusBar title="BDE Command Center" status={freshness.stale ? 'warning' : 'ok'}>
          {loading && !chartData.length ? (
            <span className="dashboard-status-loading">Loading...</span>
          ) : errorCount > 0 ? (
            <span className="dashboard-status-error" style={{ color: neonVar('red', 'color') }}>
              {errorCount} card
              {errorCount !== 1 ? 's' : ''} failed
            </span>
          ) : (
            <span className="dashboard-status-ok">
              SYS.OK
              {freshness.text && (
                <span
                  className={`dashboard-status-freshness${freshness.stale ? ' dashboard-status-freshness--stale' : ''}`}
                >
                  {' · '}
                  {freshness.text}
                </span>
              )}
            </span>
          )}
        </StatusBar>

        {/* Morning briefing card */}
        {showBriefing && briefingTasks.length > 0 && (
          <MorningBriefing
            tasks={briefingTasks}
            localAgents={localAgents}
            onReviewAll={() => {
              setView('code-review')
              handleDismissBriefing()
            }}
            onDismiss={handleDismissBriefing}
          />
        )}

        {/* 3-column Ops Deck grid or onboarding */}
        {tasks.length === 0 ? (
          <div className="dashboard-onboarding">
            <NeonCard accent="cyan" title="Welcome to BDE">
              <div className="dashboard-onboarding__content">
                <p className="dashboard-onboarding__text">
                  Create your first sprint task to see the pipeline in action.
                </p>
                <button
                  className="dashboard-onboarding__cta"
                  onClick={() => setView('task-workbench')}
                >
                  <Plus size={14} /> Create First Task
                </button>
              </div>
            </NeonCard>
          </div>
        ) : (
          <div className="dashboard-grid" role="region" aria-label="Dashboard overview">
            <StatusCounters
              stats={stats}
              awaitingReviewCount={partitions.awaitingReview.length}
              onFilterClick={navigateToSprintWithFilter}
              onNewTaskClick={() => setView('task-workbench')}
            />

            <CenterColumn
              stats={stats}
              partitions={partitions}
              chartData={chartData}
              burndownData={burndownData}
              cardErrors={cardErrors}
              successRate={successRate}
              avgDuration={avgDuration}
              avgTaskDuration={avgTaskDuration}
              taskDurationCount={taskDurationCount}
              localAgents={localAgents}
              successTrendData={successTrendData}
              onFilterClick={navigateToSprintWithFilter}
            />

            <ActivitySection
              feedEvents={feedEvents}
              cardErrors={cardErrors}
              recentCompletions={recentCompletions}
              costTrendData={costTrendData}
              costAvg={costAvg}
              cost24h={cost24h}
              taskCostMap={taskCostMap}
              onFeedEventClick={() => setView('agents')}
              onCompletionClick={handleCompletionClick}
            />
          </div>
        )}
      </div>
    </motion.div>
  )
}
