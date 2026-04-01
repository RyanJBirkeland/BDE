import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useShallow } from 'zustand/react/shallow'
import { useSprintTasks } from '../stores/sprintTasks'
import { useCostDataStore } from '../stores/costData'
import { useDashboardDataStore } from '../stores/dashboardData'
import { useSprintUI, type StatusFilter } from '../stores/sprintUI'
import { usePanelLayoutStore } from '../stores/panelLayout'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION } from '../lib/motion'
import {
  StatusBar,
  StatCounter,
  NeonCard,
  SankeyPipeline,
  MiniChart,
  ActivityFeed,
  ParticleField,
  type ChartBar
} from '../components/neon'
import { neonVar } from '../components/neon/types'
import { partitionSprintTasks } from '../lib/partitionSprintTasks'
import '../assets/dashboard-neon.css'
import {
  Activity,
  GitPullRequest,
  CheckCircle,
  DollarSign,
  Zap,
  AlertTriangle,
  XCircle,
  Plus,
  Clock,
  TrendingUp,
  Target
} from 'lucide-react'

export default function DashboardView() {
  const reduced = useReducedMotion()
  const tasks = useSprintTasks((s) => s.tasks)
  const totalCost = useCostDataStore((s) => s.totalCost)
  const localAgents = useCostDataStore((s) => s.localAgents)
  const setStatusFilter = useSprintUI((s) => s.setStatusFilter)
  const setSearchQuery = useSprintUI((s) => s.setSearchQuery)
  const setView = usePanelLayoutStore((s) => s.setView)

  // Dashboard data from centralized polling
  const { chartData, feedEvents, prCount, loading, cardErrors, lastFetchedAt } = useDashboardDataStore(
    useShallow((s) => ({
      chartData: s.chartData,
      feedEvents: s.feedEvents,
      prCount: s.prCount,
      loading: s.loading,
      cardErrors: s.cardErrors,
      lastFetchedAt: s.lastFetchedAt,
    }))
  )

  // Tick counter to re-evaluate freshness every 10s
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setTick(n => n + 1), 10_000)
    return () => clearInterval(interval)
  }, [])

  // Freshness: how long ago data was last fetched, and whether it's stale (>2min)
  const freshness = useMemo(() => {
    if (!lastFetchedAt) return { text: '', stale: false }
    const ago = Math.floor((Date.now() - lastFetchedAt) / 1000)
    const text = ago < 10 ? 'just now' : ago < 60 ? `${ago}s ago` : `${Math.floor(ago / 60)}m ago`
    return { text, stale: ago > 120 }
  }, [lastFetchedAt, tick])

  /** Navigate to Sprint Center with a pre-applied status filter. */
  const navigateToSprintWithFilter = useCallback(
    (status: StatusFilter) => {
      setSearchQuery('')
      setStatusFilter(status)
      setView('sprint')
    },
    [setStatusFilter, setSearchQuery, setView]
  )

  const handleCompletionClick = useCallback((_task: typeof recentCompletions[number]) => {
    navigateToSprintWithFilter('done')
  }, [navigateToSprintWithFilter])

  const partitions = useMemo(() => partitionSprintTasks(tasks), [tasks])

  // Derived stats
  const stats = useMemo(() => {
    const active = tasks.filter((t) => t.status === 'active').length
    const queued = tasks.filter((t) => t.status === 'queued').length
    const blocked = tasks.filter((t) => t.status === 'blocked').length
    const done = tasks.filter((t) => t.status === 'done').length
    const failed = tasks.filter((t) =>
      ['failed', 'error', 'cancelled'].includes(t.status)
    ).length
    return { active, queued, blocked, done, failed }
  }, [tasks])

  // Success rate
  const successRate = useMemo(() => {
    const terminal = stats.done + stats.failed
    if (terminal === 0) return null
    return Math.round((stats.done / terminal) * 100)
  }, [stats])

  // Average duration from agent cost records
  const avgDuration = useMemo(() => {
    const withDuration = localAgents.filter((a) => a.durationMs != null && a.durationMs > 0)
    if (withDuration.length === 0) return null
    const avg = withDuration.reduce((sum, a) => sum + a.durationMs!, 0) / withDuration.length
    return avg
  }, [localAgents])

  // Cost trend sparkline — last 20 agent runs sorted by start time
  const costTrendData = useMemo((): ChartBar[] => {
    const sorted = [...localAgents]
      .filter((a) => a.costUsd != null && a.costUsd > 0)
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
      .slice(-20)
    return sorted.map((a) => ({
      value: a.costUsd!,
      accent: 'orange' as const,
      label: `$${a.costUsd!.toFixed(2)} — ${truncate(a.taskTitle ?? a.id.slice(0, 8), 40)}`
    }))
  }, [localAgents])

  // Recent completions — last 5 done tasks
  const recentCompletions = useMemo(() => {
    return tasks
      .filter((t) => t.status === 'done' && t.completed_at)
      .sort((a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime())
      .slice(0, 5)
  }, [tasks])

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
          ) : Object.values(cardErrors).filter(Boolean).length > 0 ? (
            <span
              className="dashboard-status-error"
              style={{ color: neonVar('red', 'color') }}
            >
              {Object.values(cardErrors).filter(Boolean).length} card{Object.values(cardErrors).filter(Boolean).length !== 1 ? 's' : ''} failed
            </span>
          ) : (
            <span className="dashboard-status-ok">
              SYS.OK
              {freshness.text && (
                <span className={`dashboard-status-freshness${freshness.stale ? ' dashboard-status-freshness--stale' : ''}`}>
                  {' · '}{freshness.text}
                </span>
              )}
            </span>
          )}
        </StatusBar>

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
          {/* Left: Stats Stack */}
          <div className="dashboard-col" role="region" aria-label="Task statistics">
            <StatCounter
              label="Active"
              value={stats.active}
              accent="cyan"
              suffix="live"
              icon={<Zap size={10} />}
              onClick={() => navigateToSprintWithFilter('in-progress')}
            />
            <StatCounter
              label="Queued"
              value={stats.queued}
              accent="orange"
              icon={<Activity size={10} />}
              onClick={() => navigateToSprintWithFilter('todo')}
            />
            <StatCounter
              label="Blocked"
              value={stats.blocked}
              accent="red"
              icon={<AlertTriangle size={10} />}
              onClick={() => navigateToSprintWithFilter('blocked')}
            />
            <StatCounter
              label="Failed"
              value={stats.failed}
              accent="red"
              icon={<XCircle size={10} />}
              onClick={() => navigateToSprintWithFilter('failed')}
            />
            <StatCounter
              label="PRs"
              value={cardErrors.prs ? '—' : prCount}
              accent={cardErrors.prs ? 'red' : 'blue'}
              icon={<GitPullRequest size={10} />}
              onClick={() => navigateToSprintWithFilter('awaiting-review')}
            />
            <StatCounter
              label="Done"
              value={stats.done}
              accent="cyan"
              icon={<CheckCircle size={10} />}
              onClick={() => navigateToSprintWithFilter('done')}
            />
            <button
              className="dashboard-new-task-btn"
              onClick={() => setView('task-workbench')}
            >
              <Plus size={12} /> New Task
            </button>
          </div>

          {/* Center: Main Stage */}
          <div className="dashboard-col dashboard-col--center">
            {(stats.failed > 0 || partitions.awaitingReview.length > 0 || stats.blocked > 0) && (
              <NeonCard accent="red" title="Attention">
                {stats.failed > 0 && (
                  <div className="dashboard-attention-item" role="button" tabIndex={0}
                    onClick={() => navigateToSprintWithFilter('failed')}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateToSprintWithFilter('failed') } }}>
                    <XCircle size={12} />
                    <span>{stats.failed} failed task{stats.failed !== 1 ? 's' : ''}</span>
                  </div>
                )}
                {partitions.awaitingReview.length > 0 && (
                  <div className="dashboard-attention-item" role="button" tabIndex={0}
                    onClick={() => navigateToSprintWithFilter('awaiting-review')}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateToSprintWithFilter('awaiting-review') } }}>
                    <GitPullRequest size={12} />
                    <span>{partitions.awaitingReview.length} PR{partitions.awaitingReview.length !== 1 ? 's' : ''} awaiting review</span>
                  </div>
                )}
                {stats.blocked > 0 && (
                  <div className="dashboard-attention-item" role="button" tabIndex={0}
                    onClick={() => navigateToSprintWithFilter('blocked')}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateToSprintWithFilter('blocked') } }}>
                    <AlertTriangle size={12} />
                    <span>{stats.blocked} blocked task{stats.blocked !== 1 ? 's' : ''}</span>
                  </div>
                )}
              </NeonCard>
            )}

            <NeonCard accent="cyan" title="Pipeline" icon={<Activity size={12} />}>
              <SankeyPipeline
                stages={{
                  queued: partitions.todo.length,
                  active: partitions.inProgress.length,
                  review: partitions.awaitingReview.length,
                  done: partitions.done.length,
                  blocked: partitions.blocked.length,
                  failed: partitions.failed.length,
                }}
                onStageClick={navigateToSprintWithFilter}
              />
            </NeonCard>

            <NeonCard
              accent="cyan"
              title="Completions by Hour"
              icon={<Zap size={12} />}
            >
              {cardErrors.chart ? (
                <div className="dashboard-card-error">
                  <div className="dashboard-card-error__message">{cardErrors.chart}</div>
                  <button
                    className="dashboard-card-error__retry"
                    onClick={() => useDashboardDataStore.getState().fetchAll()}
                    style={{
                      border: `1px solid ${neonVar('red', 'color')}`,
                      color: neonVar('red', 'color')
                    }}
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <>
                  <MiniChart data={chartData} height={120} />
                  <div className="dashboard-chart-caption">last 24 hours</div>
                </>
              )}
            </NeonCard>

            {/* Stats row: Success Rate + Avg Duration */}
            <div className="dashboard-stats-row">
              <NeonCard accent="cyan" title="Success Rate" icon={<Target size={12} />}>
                <SuccessRing rate={successRate} done={stats.done} failed={stats.failed} />
              </NeonCard>

              <NeonCard accent="blue" title="Avg Duration" icon={<Clock size={12} />}>
                <div className="dashboard-duration-value">
                  {avgDuration != null ? formatDuration(avgDuration) : '—'}
                </div>
                <div className="dashboard-duration-meta">
                  {localAgents.filter((a) => a.durationMs != null).length} runs tracked
                </div>
              </NeonCard>
            </div>
          </div>

          {/* Right: Feed + Recent + Cost */}
          <div className="dashboard-col">
            <NeonCard accent="blue" title="Feed" style={{ flex: 1, minHeight: 0 }}>
              {cardErrors.feed ? (
                <div className="dashboard-card-error">
                  <div className="dashboard-card-error__message">{cardErrors.feed}</div>
                  <button
                    className="dashboard-card-error__retry"
                    onClick={() => useDashboardDataStore.getState().fetchAll()}
                    style={{
                      border: `1px solid ${neonVar('red', 'color')}`,
                      color: neonVar('red', 'color')
                    }}
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <div className="dashboard-feed-scroll">
                  <ActivityFeed events={feedEvents} onEventClick={() => setView('agents')} />
                </div>
              )}
            </NeonCard>

            <NeonCard accent="cyan" title="Recent Completions" icon={<CheckCircle size={12} />}>
              <div className="dashboard-completions-list">
                {recentCompletions.length === 0 ? (
                  <div className="dashboard-completions-empty">
                    No completions yet
                  </div>
                ) : (
                  recentCompletions.map((t) => (
                    <div
                      key={t.id}
                      className="dashboard-completion-row"
                      role="button"
                      tabIndex={0}
                      onClick={() => handleCompletionClick(t)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleCompletionClick(t)
                        }
                      }}
                    >
                      <span className="dashboard-completion-title">
                        {t.title}
                      </span>
                      <span className="dashboard-completion-time">
                        {timeAgo(t.completed_at!)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </NeonCard>

            <NeonCard accent="orange" title="Cost / Run" icon={<TrendingUp size={12} />}>
              <MiniChart data={costTrendData} height={80} />
              <div className="dashboard-chart-caption">
                last {costTrendData.length} runs
              </div>
            </NeonCard>

            <NeonCard accent="orange" title="Cost 24h" icon={<DollarSign size={12} />}>
              <div className="dashboard-cost-value">
                ${totalCost.toFixed(2)}
              </div>
            </NeonCard>
          </div>
        </div>
        )}
      </div>
    </motion.div>
  )
}

/** SVG donut ring showing success rate. */
function SuccessRing({
  rate,
  done,
  failed
}: {
  rate: number | null
  done: number
  failed: number
}) {
  if (rate === null) {
    return (
      <div className="dashboard-ring-empty">
        No terminal tasks
      </div>
    )
  }

  const size = 64
  const stroke = 6
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const filled = (rate / 100) * circ
  const accent = rate >= 80 ? 'cyan' : rate >= 50 ? 'orange' : 'red'

  return (
    <div className="dashboard-ring">
      <svg width={size} height={size} className="dashboard-ring__svg">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="dashboard-ring__bg"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={neonVar(accent, 'color')}
          strokeWidth={stroke}
          strokeDasharray={`${filled} ${circ - filled}`}
          strokeLinecap="round"
          style={{
            filter: `drop-shadow(0 0 4px ${neonVar(accent, 'color')})`,
            transition: 'stroke-dasharray 500ms ease'
          }}
        />
      </svg>
      <div>
        <div
          className="dashboard-ring__rate"
          style={{
            color: neonVar(accent, 'color'),
            textShadow: neonVar(accent, 'glow')
          }}
        >
          {rate}%
        </div>
        <div className="dashboard-ring__breakdown">
          {done}✓ {failed}✗
        </div>
      </div>
    </div>
  )
}

/** Format milliseconds to human-readable duration. */
function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  if (m < 60) return `${m}m ${rem}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

/** Truncate a string to maxLen characters, adding ellipsis if needed. */
function truncate(str: string, maxLen: number): string {
  return str.length <= maxLen ? str : str.slice(0, maxLen) + '…'
}

/** Format a timestamp to relative "time ago" string. */
function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = Math.max(0, now - then)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
