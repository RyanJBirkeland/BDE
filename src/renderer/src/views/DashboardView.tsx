import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useShallow } from 'zustand/react/shallow'
import { useSprintTasks } from '../stores/sprintTasks'
import { useCostDataStore } from '../stores/costData'
import { useDashboardDataStore } from '../stores/dashboardData'
import { useSprintUI, type StatusFilter } from '../stores/sprintUI'
import { usePanelLayoutStore } from '../stores/panelLayout'
import { useDashboardMetrics } from '../hooks/useDashboardMetrics'
import { useVisibilityAwareInterval } from '../hooks/useVisibilityAwareInterval'
import { useBackoffInterval } from '../hooks/useBackoffInterval'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION } from '../lib/motion'
import { POLL_LOAD_AVERAGE } from '../lib/constants'
import { StatusBar, NeonCard } from '../components/neon'
import { neonVar } from '../components/neon/types'
import { partitionSprintTasks } from '../lib/partitionSprintTasks'
import {
  StatusRail,
  FiresStrip,
  CenterColumn,
  ActivitySection,
  MorningBriefing
} from '../components/dashboard'
import '../assets/dashboard.css'
import { Plus } from 'lucide-react'
import { useCommandPaletteStore, type Command } from '../stores/commandPalette'

/**
 * Renders the "X ago" freshness text with its own 10s ticker.
 * Isolated so the ticker doesn't cause full DashboardView re-renders.
 */
function FreshnessLabel({ lastFetchedAt }: { lastFetchedAt: number }): React.JSX.Element | null {
  const [now, setNow] = useState(() => Date.now())
  useVisibilityAwareInterval(() => setNow(Date.now()), 10_000)
  const ago = Math.floor((now - lastFetchedAt) / 1000)
  if (ago < 0) return null
  const text = ago < 10 ? 'just now' : ago < 60 ? `${ago}s ago` : `${Math.floor(ago / 60)}m ago`
  const stale = ago > 120
  return (
    <span className={`dashboard-status-freshness${stale ? ' dashboard-status-freshness--stale' : ''}`}>
      {' · '}
      {text}
    </span>
  )
}

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
  const {
    throughputData,
    loadData,
    feedEvents,
    successTrendData,
    loading,
    cardErrors,
    lastFetchedAt
  } = useDashboardDataStore(
    useShallow((s) => ({
      throughputData: s.throughputData,
      loadData: s.loadData,
      feedEvents: s.feedEvents,
      successTrendData: s.successTrendData,
      loading: s.loading,
      cardErrors: s.cardErrors,
      lastFetchedAt: s.lastFetchedAt
    }))
  )

  // Load average polling — 5s backoff interval
  const fetchLoad = useDashboardDataStore((s) => s.fetchLoad)
  useEffect(() => {
    fetchLoad()
  }, [fetchLoad])
  useBackoffInterval(fetchLoad, POLL_LOAD_AVERAGE)

  // `now` is owned by FreshnessLabel below — DashboardView no longer re-renders every 10s

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

  // Staleness for StatusBar status prop — computed inline (cheap, no state ticker needed).
  // eslint-disable-next-line react-hooks/purity -- Date.now() intentional: recomputes on render after poll
  const dataStale = lastFetchedAt ? Date.now() - lastFetchedAt > 120_000 : false

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

  /** Maps StatusRail's limited 'active'|'queued'|'done' emissions to real StatusFilter values. */
  const handleRailFilter = useCallback(
    (kind: 'active' | 'queued' | 'done') => {
      const mapped: StatusFilter =
        kind === 'active' ? 'in-progress' : kind === 'queued' ? 'todo' : 'done'
      navigateToSprintWithFilter(mapped)
    },
    [navigateToSprintWithFilter]
  )

  const handleFiresClick = useCallback(
    (kind: 'failed' | 'blocked' | 'stuck' | 'load') => {
      if (kind === 'failed') navigateToSprintWithFilter('failed')
      else if (kind === 'blocked') navigateToSprintWithFilter('blocked')
      else if (kind === 'stuck') navigateToSprintWithFilter('in-progress')
      else if (kind === 'load') {
        document
          .querySelector('[data-chart="load-average"]')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    },
    [navigateToSprintWithFilter]
  )

  const partitions = useMemo(() => partitionSprintTasks(tasks), [tasks])

  // Dashboard metrics — extracted to reusable hook
  const {
    stats,
    tokenTrendData,
    tokenAvg,
    recentCompletions,
    tokens24h,
    taskTokenMap,
    stuckCount,
    loadSaturated
  } = useDashboardMetrics()

  const errorCount = useMemo(() => Object.values(cardErrors).filter(Boolean).length, [cardErrors])

  // successTrendData now comes from useDashboardDataStore above

  const transition = reduced ? REDUCED_TRANSITION : SPRINGS.snappy

  return (
    <motion.div
      className="dashboard-root"
      variants={reduced ? undefined : VARIANTS.fadeIn}
      initial={reduced ? undefined : 'initial'}
      animate={reduced ? undefined : 'animate'}
      transition={transition}
    >
      <div className="dashboard-bg-gradient" />

      {/* Content (above effects) */}
      <div className="dashboard-content">
        <StatusBar title="BDE Command Center" status={dataStale ? 'warning' : 'ok'}>
          {loading && !throughputData.length ? (
            <span className="dashboard-status-loading">Loading...</span>
          ) : errorCount > 0 ? (
            <span className="dashboard-status-error" style={{ color: neonVar('red', 'color') }}>
              {errorCount} card
              {errorCount !== 1 ? 's' : ''} failed
            </span>
          ) : (
            <span className="dashboard-status-ok">
              SYS.OK
              {lastFetchedAt && <FreshnessLabel lastFetchedAt={lastFetchedAt} />}
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
          <>
            <FiresStrip
              failed={stats.failed}
              blocked={stats.blocked}
              stuck={stuckCount}
              loadSaturated={loadSaturated}
              onClick={handleFiresClick}
            />
            <div className="dashboard-grid" role="region" aria-label="Dashboard overview">
              <StatusRail
                stats={stats}
                tokens24h={tokens24h}
                onFilterClick={handleRailFilter}
                onNewTaskClick={() => setView('task-workbench')}
              />

              <CenterColumn
                stats={stats}
                partitions={partitions}
                throughputData={throughputData}
                successTrendData={successTrendData}
                loadData={loadData}
                tokenTrendData={tokenTrendData}
                tokenAvg={tokenAvg}
                cardErrors={cardErrors}
                onFilterClick={navigateToSprintWithFilter}
              />

              <ActivitySection
                feedEvents={feedEvents}
                cardErrors={cardErrors}
                recentCompletions={recentCompletions}
                tokenTrendData={tokenTrendData}
                tokenAvg={tokenAvg}
                tokens24h={tokens24h}
                taskTokenMap={taskTokenMap}
                onFeedEventClick={() => setView('agents')}
                onCompletionClick={handleCompletionClick}
              />
            </div>
          </>
        )}
      </div>
    </motion.div>
  )
}
