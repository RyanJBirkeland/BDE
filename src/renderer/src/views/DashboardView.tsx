import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useSprintTasks } from '../stores/sprintTasks'
import { useCostDataStore } from '../stores/costData'
import { useSprintUI, type StatusFilter } from '../stores/sprintUI'
import { useUIStore } from '../stores/ui'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION } from '../lib/motion'
import { POLL_DASHBOARD_INTERVAL } from '../lib/constants'
import { useBackoffInterval } from '../hooks/useBackoffInterval'
import { useSprintPolling } from '../hooks/useSprintPolling'
import {
  StatusBar,
  StatCounter,
  NeonCard,
  PipelineFlow,
  MiniChart,
  ActivityFeed,
  ScanlineOverlay,
  ParticleField,
  type FeedEvent,
  type PipelineStage,
  type ChartBar
} from '../components/neon'
import { neonVar } from '../components/neon/types'
import { tokens } from '../design-system/tokens'
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
  const setView = useUIStore((s) => s.setView)

  /** Navigate to Sprint Center with a pre-applied status filter. */
  const navigateToSprintWithFilter = useCallback(
    (status: StatusFilter) => {
      setSearchQuery('')
      setStatusFilter(status)
      setView('sprint')
    },
    [setStatusFilter, setSearchQuery, setView]
  )

  const [chartData, setChartData] = useState<ChartBar[]>([])
  const [feedEvents, setFeedEvents] = useState<FeedEvent[]>([])
  const [prCount, setPrCount] = useState(0)

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

  // Unmount guard for async fetches
  const cancelledRef = useRef(false)
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  // Fetch all dashboard data — errors are caught per-fetch so backoff only
  // triggers on total failure. Jitter prevents thundering herd across views.
  const fetchDashboardData = useCallback(async (): Promise<void> => {
    try {
      const data = await window.api.dashboard?.completionsPerHour()
      if (cancelledRef.current || !data) return
      const accents: Array<'cyan' | 'pink' | 'blue' | 'orange' | 'purple'> = [
        'cyan',
        'pink',
        'blue',
        'orange',
        'purple'
      ]
      setChartData(
        data.map((d, i) => ({
          value: d.count,
          accent: accents[i % accents.length],
          label: d.hour
        }))
      )
    } catch (err) {
      console.error('[Dashboard] Failed to fetch completions:', err)
    }

    try {
      const events = await window.api.dashboard?.recentEvents(30)
      if (cancelledRef.current || !events) return
      setFeedEvents(
        events.map((e) => ({
          id: String(e.id),
          label: `${e.event_type}: ${e.agent_id}`,
          accent:
            e.event_type === 'error'
              ? ('red' as const)
              : e.event_type === 'complete'
                ? ('cyan' as const)
                : ('purple' as const),
          timestamp: e.timestamp
        }))
      )
    } catch (err) {
      console.error('[Dashboard] Failed to fetch events:', err)
    }

    try {
      const prs = await window.api.getPrList()
      if (cancelledRef.current) return
      setPrCount(prs?.prs?.length ?? 0)
    } catch (err) {
      console.error('[Dashboard] Failed to fetch PR list:', err)
    }
  }, [])

  // Keep sprint task stats fresh — polls + reacts to sprint:externalChange IPC
  useSprintPolling()

  // Poll with jitter to prevent thundering herd; backoff on total failure
  useBackoffInterval(fetchDashboardData, POLL_DASHBOARD_INTERVAL)

  // Refresh chart/feed immediately on sprint mutations (not just every 60s)
  useEffect(() => {
    return window.api.onExternalSprintChange(() => {
      fetchDashboardData()
    })
  }, [fetchDashboardData])

  const transition = reduced ? REDUCED_TRANSITION : SPRINGS.snappy

  return (
    <motion.div
      variants={VARIANTS.fadeIn}
      initial="initial"
      animate="animate"
      transition={transition}
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--neon-bg)',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* Background effects */}
      {!reduced && <ScanlineOverlay />}
      {!reduced && <ParticleField />}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--neon-bg-gradient)',
          pointerEvents: 'none',
          zIndex: 0
        }}
      />

      {/* Content (above effects) */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100%'
        }}
      >
        <StatusBar title="BDE Command Center" status="ok">
          SYS.OK
        </StatusBar>

        {/* 3-column Ops Deck grid */}
        <div
          style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: '200px 1fr 240px',
            gap: '12px',
            padding: '12px',
            overflow: 'auto'
          }}
        >
          {/* Left: Stats Stack */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
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
              value={prCount}
              accent="blue"
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
          </div>

          {/* Center: Main Stage */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <NeonCard accent="purple" title="Pipeline" icon={<Activity size={12} />}>
              <PipelineFlow stages={pipelineStages} />
            </NeonCard>

            <NeonCard
              accent="cyan"
              title="Completions / Hour"
              icon={<Zap size={12} />}
            >
              <MiniChart data={chartData} height={120} />
              <div style={{ color: 'rgba(255, 255, 255, 0.3)', fontSize: '9px', marginTop: '6px' }}>
                last 24 hours
              </div>
            </NeonCard>

            {/* Stats row: Success Rate + Avg Duration */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <NeonCard accent="cyan" title="Success Rate" icon={<Target size={12} />}>
                <SuccessRing rate={successRate} done={stats.done} failed={stats.failed} />
              </NeonCard>

              <NeonCard accent="blue" title="Avg Duration" icon={<Clock size={12} />}>
                <div
                  style={{
                    color: tokens.neon.text,
                    fontSize: '20px',
                    fontWeight: 800,
                    textShadow: 'var(--neon-blue-glow)'
                  }}
                >
                  {avgDuration != null ? formatDuration(avgDuration) : '—'}
                </div>
                <div style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: '10px', marginTop: '4px' }}>
                  {localAgents.filter((a) => a.durationMs != null).length} runs tracked
                </div>
              </NeonCard>
            </div>

            <NeonCard accent="orange" title="Cost / Run" icon={<TrendingUp size={12} />}>
              <MiniChart data={costTrendData} height={80} />
              <div style={{ color: 'rgba(255, 255, 255, 0.3)', fontSize: '9px', marginTop: '6px' }}>
                last {costTrendData.length} runs
              </div>
            </NeonCard>
          </div>

          {/* Right: Feed + Recent + Cost */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <NeonCard accent="purple" title="Feed" style={{ flex: 1, minHeight: 0 }}>
              <div style={{ overflow: 'auto', maxHeight: '240px' }}>
                <ActivityFeed events={feedEvents} />
              </div>
            </NeonCard>

            <NeonCard accent="cyan" title="Recent Completions" icon={<CheckCircle size={12} />}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {recentCompletions.length === 0 ? (
                  <div style={{ color: tokens.neon.textDim, fontSize: tokens.size.xs }}>
                    No completions yet
                  </div>
                ) : (
                  recentCompletions.map((t) => (
                    <div
                      key={t.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      <span
                        style={{
                          color: tokens.neon.text,
                          fontSize: '11px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1
                        }}
                      >
                        {t.title}
                      </span>
                      <span
                        style={{
                          color: 'rgba(255, 255, 255, 0.35)',
                          fontSize: '9px',
                          whiteSpace: 'nowrap',
                          flexShrink: 0
                        }}
                      >
                        {timeAgo(t.completed_at!)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </NeonCard>

            <NeonCard accent="orange" title="Cost 24h" icon={<DollarSign size={12} />}>
              <div
                style={{
                  color: '#fff',
                  fontSize: '24px',
                  fontWeight: 800,
                  textShadow: 'var(--neon-orange-glow)'
                }}
              >
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
      <div style={{ color: tokens.neon.textDim, fontSize: tokens.size.xs }}>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255, 255, 255, 0.08)"
          strokeWidth={stroke}
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
          style={{
            color: neonVar(accent, 'color'),
            fontSize: '20px',
            fontWeight: 800,
            textShadow: neonVar(accent, 'glow')
          }}
        >
          {rate}%
        </div>
        <div style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: '9px' }}>
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
