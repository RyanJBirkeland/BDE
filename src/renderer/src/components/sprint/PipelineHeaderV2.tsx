import React, { useState } from 'react'
import { GitMerge, HeartPulse, LayoutGrid, List, Network, RefreshCw, Plus } from 'lucide-react'
import { useSprintUI } from '../../stores/sprintUI'
import { useAgentManagerStatus } from '../../hooks/useAgentManagerStatus'
import { ExportDropdown, type ExportFormat } from './ExportDropdown'
import type { SprintTask } from '../../../../shared/types'

interface StatBadge {
  label: string
  count: number
  filter: 'in-progress' | 'todo' | 'blocked' | 'review' | 'open-prs' | 'failed' | 'done'
}

interface PipelineHeaderV2Props {
  stats: StatBadge[]
  conflictingTasks: SprintTask[]
  visibleStuckTasks: SprintTask[]
  onFilterClick: (filter: StatBadge['filter']) => void
  activeFilter?: string | undefined
  onConflictClick: () => void
  onHealthCheckClick: () => void
  onDagToggle?: (() => void) | undefined
  dagOpen?: boolean | undefined
  onOpenWorkbench: () => void
  onExportTasks: (format: ExportFormat) => Promise<void>
  onTriggerDrain: () => Promise<void>
}

const ICON_BTN_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '0 var(--s-2)',
  height: 28,
  background: 'none',
  border: '1px solid var(--line)',
  borderRadius: 'var(--r-md)',
  color: 'var(--fg-2)',
  fontSize: 12,
  cursor: 'pointer',
  flexShrink: 0,
  whiteSpace: 'nowrap',
}

const DANGER_BTN_STYLE: React.CSSProperties = {
  ...ICON_BTN_STYLE,
  borderColor: 'color-mix(in oklch, var(--st-failed) 40%, transparent)',
  color: 'var(--st-failed)',
}

const WARNING_BTN_STYLE: React.CSSProperties = {
  ...ICON_BTN_STYLE,
  borderColor: 'color-mix(in oklch, var(--st-blocked) 40%, transparent)',
  color: 'var(--st-blocked)',
}

interface StatChipsProps {
  stats: StatBadge[]
  activeFilter?: string | undefined
  onFilterClick: (filter: StatBadge['filter']) => void
}

function StatChips({ stats, activeFilter, onFilterClick }: StatChipsProps): React.JSX.Element {
  const { activeCount, maxSlots } = useAgentManagerStatus()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-1)', flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'hidden' }}>
      {stats.map((stat) => (
        <button
          key={stat.label}
          type="button"
          onClick={() => onFilterClick(stat.filter)}
          aria-pressed={activeFilter === stat.filter}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '0 var(--s-2)',
            height: 22,
            background: 'var(--surf-1)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-md)',
            color: 'var(--fg-3)',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            cursor: 'pointer',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ color: 'var(--fg)', fontWeight: 600 }}>{stat.count}</span>
          <span>{stat.label}</span>
        </button>
      ))}
      <SlotIndicator activeCount={activeCount} maxSlots={maxSlots} />
    </div>
  )
}

interface SlotIndicatorProps {
  activeCount: number
  maxSlots: number
}

function SlotIndicator({ activeCount, maxSlots }: SlotIndicatorProps): React.JSX.Element {
  return (
    <span
      title="Max concurrent agents. Change in Settings → Agents."
      aria-label={`${activeCount} of ${maxSlots} agent slots active`}
      style={{
        padding: '0 var(--s-2)',
        height: 22,
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        color: 'var(--fg-3)',
        background: 'var(--surf-1)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        flexShrink: 0,
      }}
    >
      <span style={{ color: 'var(--st-running)' }}>{activeCount}</span>
      <span>/</span>
      <span>{maxSlots}</span>
      <span>slots</span>
    </span>
  )
}

interface PipelineActionsProps {
  conflictingTasks: SprintTask[]
  visibleStuckTasks: SprintTask[]
  pipelineDensity: string
  dagOpen?: boolean | undefined
  triggering: boolean
  onConflictClick: () => void
  onHealthCheckClick: () => void
  onDensityToggle: () => void
  onDagToggle?: (() => void) | undefined
  onExport: (format: ExportFormat) => Promise<void>
  onTriggerDrain: () => void
  onOpenWorkbench: () => void
}

function PipelineActions({
  conflictingTasks,
  visibleStuckTasks,
  pipelineDensity,
  dagOpen,
  triggering,
  onConflictClick,
  onHealthCheckClick,
  onDensityToggle,
  onDagToggle,
  onExport,
  onTriggerDrain,
  onOpenWorkbench
}: PipelineActionsProps): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-1)', flexShrink: 0 }}>
      {conflictingTasks.length > 0 && (
        <button
          onClick={onConflictClick}
          title={`${conflictingTasks.length} PR conflict${conflictingTasks.length > 1 ? 's' : ''}`}
          aria-label={`${conflictingTasks.length} merge conflict${conflictingTasks.length > 1 ? 's' : ''}`}
          style={DANGER_BTN_STYLE}
        >
          <GitMerge size={12} />
          <span>{conflictingTasks.length}</span>
        </button>
      )}
      {visibleStuckTasks.length > 0 && (
        <button
          onClick={onHealthCheckClick}
          title={`${visibleStuckTasks.length} stuck task${visibleStuckTasks.length > 1 ? 's' : ''}`}
          aria-label={`${visibleStuckTasks.length} stuck task${visibleStuckTasks.length > 1 ? 's' : ''}`}
          style={WARNING_BTN_STYLE}
        >
          <HeartPulse size={12} />
          <span>{visibleStuckTasks.length}</span>
        </button>
      )}
      <button
        onClick={onDensityToggle}
        title={pipelineDensity === 'card' ? 'Switch to compact view' : 'Switch to card view'}
        aria-label={pipelineDensity === 'card' ? 'Switch to compact view' : 'Switch to card view'}
        style={ICON_BTN_STYLE}
      >
        {pipelineDensity === 'card' ? <List size={13} /> : <LayoutGrid size={13} />}
      </button>
      <button
        onClick={onDagToggle}
        title="Toggle dependency graph"
        aria-label="Toggle dependency graph visualization"
        style={dagOpen
          ? { ...ICON_BTN_STYLE, borderColor: 'var(--accent-line)', color: 'var(--accent)', background: 'var(--accent-soft)' }
          : ICON_BTN_STYLE
        }
      >
        <Network size={13} />
        <span>DAG</span>
      </button>
      <ExportDropdown onExport={onExport} />
      <button
        onClick={onTriggerDrain}
        disabled={triggering}
        title="Check for queued tasks now"
        aria-label="Check now"
        style={triggering ? { ...ICON_BTN_STYLE, opacity: 0.5 } : ICON_BTN_STYLE}
      >
        <RefreshCw size={13} style={triggering ? { animation: 'spin 0.8s linear infinite' } : undefined} />
      </button>
      <button
        onClick={onOpenWorkbench}
        title="New task"
        aria-label="Create new task"
        style={{
          ...ICON_BTN_STYLE,
          background: 'var(--accent)',
          borderColor: 'var(--accent)',
          color: 'var(--accent-fg)',
        }}
      >
        <Plus size={13} />
        <span>New Task</span>
      </button>
    </div>
  )
}

export function PipelineHeaderV2({
  stats,
  conflictingTasks,
  visibleStuckTasks,
  onFilterClick,
  activeFilter,
  onConflictClick,
  onHealthCheckClick,
  onDagToggle,
  dagOpen,
  onOpenWorkbench,
  onExportTasks,
  onTriggerDrain
}: PipelineHeaderV2Props): React.JSX.Element {
  const pipelineDensity = useSprintUI((s) => s.pipelineDensity)
  const setPipelineDensity = useSprintUI((s) => s.setPipelineDensity)
  const [triggering, setTriggering] = useState(false)

  const handleTriggerDrain = (): void => {
    setTriggering(true)
    void onTriggerDrain().finally(() => {
      setTimeout(() => setTriggering(false), 1500)
    })
  }

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-2)',
        padding: '0 var(--s-4)',
        height: 52,
        borderBottom: '1px solid var(--line)',
        flexShrink: 0,
        background: 'var(--bg)',
        overflow: 'hidden',
        minWidth: 0,
      }}
    >
      <span className="fleet-eyebrow" style={{ marginRight: 'var(--s-1)', flexShrink: 0 }}>Pipeline</span>

      <StatChips stats={stats} activeFilter={activeFilter} onFilterClick={onFilterClick} />

      <PipelineActions
        conflictingTasks={conflictingTasks}
        visibleStuckTasks={visibleStuckTasks}
        pipelineDensity={pipelineDensity}
        dagOpen={dagOpen}
        triggering={triggering}
        onConflictClick={onConflictClick}
        onHealthCheckClick={onHealthCheckClick}
        onDensityToggle={() => setPipelineDensity(pipelineDensity === 'card' ? 'compact' : 'card')}
        onDagToggle={onDagToggle}
        onExport={onExportTasks}
        onTriggerDrain={handleTriggerDrain}
        onOpenWorkbench={onOpenWorkbench}
      />
    </header>
  )
}
