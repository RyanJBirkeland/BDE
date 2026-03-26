import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useSprintTasks } from '../stores/sprintTasks'
import { useCostDataStore } from '../stores/costData'
import { useSprintUI, type StatusFilter } from '../stores/sprintUI'
import { useUIStore } from '../stores/ui'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION } from '../lib/motion'
import { POLL_DASHBOARD_INTERVAL } from '../lib/constants'
import { useBackoffInterval } from '../hooks/useBackoffInterval'
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
import { Activity, GitPullRequest, CheckCircle, DollarSign, Zap, AlertTriangle } from 'lucide-react'

export default function DashboardView() {
  const reduced = useReducedMotion()
  const tasks = useSprintTasks((s) => s.tasks)
  const totalCost = useCostDataStore((s) => s.totalCost)
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
    return { active, queued, blocked, done }
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

  // Poll with jitter to prevent thundering herd; backoff on total failure
  useBackoffInterval(fetchDashboardData, POLL_DASHBOARD_INTERVAL)

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
              accent="purple"
              title="Completions / Hour"
              icon={<Zap size={12} />}
              style={{ flex: 1 }}
            >
              <MiniChart data={chartData} height={120} />
              <div style={{ color: 'rgba(255, 255, 255, 0.3)', fontSize: '9px', marginTop: '6px' }}>
                last 24 hours
              </div>
            </NeonCard>
          </div>

          {/* Right: Feed + Cost */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <NeonCard accent="purple" title="Feed" style={{ flex: 1, minHeight: 0 }}>
              <div style={{ overflow: 'auto', maxHeight: '300px' }}>
                <ActivityFeed events={feedEvents} />
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
