import { useEffect, useState, useMemo } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useSprintTasks } from '../stores/sprintTasks'
import { useCostDataStore } from '../stores/costData'
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
  type FeedEvent,
  type PipelineStage,
  type ChartBar,
} from '../components/neon'
import { Activity, GitPullRequest, CheckCircle, DollarSign, Zap } from 'lucide-react'

export default function DashboardView() {
  const reduced = useReducedMotion()
  const tasks = useSprintTasks((s) => s.tasks)
  const totalCost = useCostDataStore((s) => s.totalCost)

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
      { label: 'done', count: stats.done, accent: 'blue' },
    ],
    [stats],
  )

  // Fetch chart data
  useEffect(() => {
    let cancelled = false
    window.api.dashboard
      ?.completionsPerHour()
      ?.then((data) => {
        if (cancelled) return
        const accents: Array<'cyan' | 'pink' | 'blue' | 'orange' | 'purple'> = [
          'cyan',
          'pink',
          'blue',
          'orange',
          'purple',
        ]
        setChartData(
          data.map((d, i) => ({
            value: d.count,
            accent: accents[i % accents.length],
            label: d.hour,
          })),
        )
      })
      ?.catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Fetch events
  useEffect(() => {
    let cancelled = false
    window.api.dashboard
      ?.recentEvents(30)
      ?.then((events) => {
        if (cancelled) return
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
            timestamp: e.timestamp,
          })),
        )
      })
      ?.catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Fetch PR count — using getPrList per preload/index.d.ts
  useEffect(() => {
    let cancelled = false
    window.api
      .getPrList()
      .then((prs) => {
        if (cancelled) return
        setPrCount(prs?.prs?.length ?? 0)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

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
        overflow: 'hidden',
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
          zIndex: 0,
        }}
      />

      {/* Content (above effects) */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
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
            overflow: 'auto',
          }}
        >
          {/* Left: Stats Stack */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <StatCounter
              label="Agents"
              value={stats.active}
              accent="cyan"
              suffix="live"
              icon={<Zap size={10} />}
            />
            <StatCounter
              label="Tasks"
              value={stats.queued + stats.active}
              accent="pink"
              icon={<Activity size={10} />}
            />
            <StatCounter
              label="PRs"
              value={prCount}
              accent="blue"
              icon={<GitPullRequest size={10} />}
            />
            <StatCounter
              label="Done"
              value={stats.done}
              accent="cyan"
              icon={<CheckCircle size={10} />}
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
              <div
                style={{ color: 'rgba(255, 255, 255, 0.3)', fontSize: '9px', marginTop: '6px' }}
              >
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
                  textShadow: 'var(--neon-orange-glow)',
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
