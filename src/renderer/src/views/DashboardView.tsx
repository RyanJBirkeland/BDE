import { useCallback, useMemo } from 'react'
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
  PipelineFlow,
  MiniChart,
  ActivityFeed,
  ScanlineOverlay,
  ParticleField,
  type PipelineStage,
  type ChartBar
} from '../components/neon'
import { neonVar } from '../components/neon/types'
import '../assets/dashboard-neon.css'
import {
  Activity,
  GitPullRequest,
  CheckCircle,
  DollarSign,
  Zap,
  AlertTriangle,
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
  const { chartData, feedEvents, prCount, loading, cardErrors } = useDashboardDataStore(
    useShallow((s) => ({
      chartData: s.chartData,
      feedEvents: s.feedEvents,
      prCount: s.prCount,
      loading: s.loading,
      cardErrors: s.cardErrors
    }))
  )

  /** Navigate to Sprint Center with a pre-applied status filter. */
  const navigateToSprintWithFilter = useCallback(
    (status: StatusFilter) => {
      setSearchQuery('')
      setStatusFilter(status)
      setView('sprint')
    },
    [setStatusFilter, setSearchQuery, setView]
  )

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

  // Pipeline stages
  const pipelineStages: PipelineStage[] = useMemo(
    () => [
      { label: 'queued', count: stats.queued, accent: 'orange' },
      { label: 'active', count: stats.active, accent: 'cyan' },
      { label: 'blocked', count: stats.blocked, accent: 'red' },
      { label: 'done', count: stats.done, accent: 'blue' }
    ],
    [stats]
  )

  const transition = reduced ? REDUCED_TRANSITION : SPRINGS.snappy

  return (
    <motion.div
      className="dashboard-root"
      variants={VARIANTS.fadeIn}
      initial="initial"
      animate="animate"
      transition={transition}
    >
      {/* Background effects */}
      {!reduced && <ScanlineOverlay />}
      {!reduced && <ParticleField />}
      <div className="dashboard-bg-gradient" />

      {/* Content (above effects) */}
      <div className="dashboard-content">
        <StatusBar title="BDE Command Center" status="ok">
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
            'SYS.OK'
          )}
        </StatusBar>

        {/* 3-column Ops Deck grid */}
        <div className="dashboard-grid">
          {/* Left: Stats Stack */}
          <div className="dashboard-col">
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
              label="PRs"
              value={cardErrors.prs ? 0 : prCount}
              accent={cardErrors.prs ? 'red' : 'blue'}
              icon={<GitPullRequest size={10} />}
              onClick={() => cardErrors.prs ? useDashboardDataStore.getState().fetchAll() : navigateToSprintWithFilter('awaiting-review')}
            />
            <StatCounter
              label="Done"
              value={stats.done}
              accent="cyan"
              icon={<CheckCircle size={10} />}
              onClick={() => navigateToSprintWithFilter('done')}
            />
          </div>

          {/* Center: Main Stage */}
          <div className="dashboard-col dashboard-col--center">
            <NeonCard accent="purple" title="Pipeline" icon={<Activity size={12} />}>
              <PipelineFlow stages={pipelineStages} />
            </NeonCard>

            <NeonCard
              accent="cyan"
              title="Completions / Hour"
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

            <NeonCard accent="orange" title="Cost / Run" icon={<TrendingUp size={12} />}>
              <MiniChart data={costTrendData} height={80} />
              <div className="dashboard-chart-caption">
                last {costTrendData.length} runs
              </div>
            </NeonCard>
          </div>

          {/* Right: Feed + Recent + Cost */}
          <div className="dashboard-col">
            <NeonCard accent="purple" title="Feed" style={{ flex: 1, minHeight: 0 }}>
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
                  <ActivityFeed events={feedEvents} />
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
                    <div key={t.id} className="dashboard-completion-row">
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

            <NeonCard accent="orange" title="Cost 24h" icon={<DollarSign size={12} />}>
              <div className="dashboard-cost-value">
                ${totalCost.toFixed(2)}
              </div>
            </NeonCard>
          </div>
        </div>
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
