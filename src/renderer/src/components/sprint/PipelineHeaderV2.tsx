import React, { useCallback, useEffect, useState } from 'react'
import { GitMerge, HeartPulse, LayoutGrid, List, Network, Download, RefreshCw, Plus } from 'lucide-react'
import { useSprintUI } from '../../stores/sprintUI'
import { useBackoffInterval } from '../../hooks/useBackoffInterval'
import { toast } from '../../stores/toasts'
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
  onConflictClick: () => void
  onHealthCheckClick: () => void
  onDagToggle?: (() => void) | undefined
  dagOpen?: boolean | undefined
  onOpenWorkbench: () => void
}

function ExportDropdown(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!open) return
    const handleOutsideClick = (): void => setOpen(false)
    document.addEventListener('click', handleOutsideClick)
    return () => document.removeEventListener('click', handleOutsideClick)
  }, [open])

  const handleExport = async (format: 'json' | 'csv'): Promise<void> => {
    setOpen(false)
    setExporting(true)
    try {
      const result = await window.api.sprint.exportTasks(format)
      if (!result.canceled && result.filePath) {
        toast.success('Tasks exported')
      }
    } catch {
      toast.error('Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        disabled={exporting}
        title="Export tasks"
        aria-label="Export sprint tasks"
        style={ICON_BTN_STYLE}
      >
        <Download size={13} />
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + var(--s-1))',
          right: 0,
          background: 'var(--surf-2)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-md)',
          padding: 'var(--s-1)',
          zIndex: 50,
          minWidth: 80,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}>
          {(['json', 'csv'] as const).map((fmt) => (
            <button
              key={fmt}
              onClick={() => void handleExport(fmt)}
              disabled={exporting}
              style={{
                padding: '3px var(--s-2)',
                background: 'none',
                border: 'none',
                borderRadius: 'var(--r-sm)',
                color: 'var(--fg)',
                fontSize: 12,
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'var(--surf-3)' }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'none' }}
            >
              {fmt.toUpperCase()}
            </button>
          ))}
        </div>
      )}
    </div>
  )
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

export function PipelineHeaderV2({
  stats,
  conflictingTasks,
  visibleStuckTasks,
  onFilterClick,
  onConflictClick,
  onHealthCheckClick,
  onDagToggle,
  dagOpen,
  onOpenWorkbench,
}: PipelineHeaderV2Props): React.JSX.Element {
  const pipelineDensity = useSprintUI((s) => s.pipelineDensity)
  const setPipelineDensity = useSprintUI((s) => s.setPipelineDensity)
  const [wipSlots, setWipSlots] = useState<{ active: number; max: number } | null>(null)
  const [triggering, setTriggering] = useState(false)

  const fetchStatus = useCallback(async (): Promise<void> => {
    try {
      const status = await window.api.agentManager.status()
      setWipSlots({ active: status.concurrency.activeCount, max: status.concurrency.maxSlots })
    } catch {
      // agent manager may not be running
    }
  }, [])

  useBackoffInterval(fetchStatus, 5000)

  const handleTriggerDrain = useCallback(async (): Promise<void> => {
    setTriggering(true)
    try {
      await window.api.agentManager.triggerDrain()
    } finally {
      setTimeout(() => setTriggering(false), 1500)
    }
  }, [])

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

      {/* Stat chips — scrollable at narrow viewports */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-1)', flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'hidden' }}>
        {stats.map((stat) => (
          <button
            key={stat.label}
            type="button"
            onClick={() => onFilterClick(stat.filter)}
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
        {wipSlots !== null && (
          <span
            title="Max concurrent agents. Change in Settings → Agents."
            aria-label={`${wipSlots.active} of ${wipSlots.max} agent slots active`}
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
            <span style={{ color: 'var(--st-running)' }}>{wipSlots.active}</span>
            <span>/</span>
            <span>{wipSlots.max}</span>
            <span>slots</span>
          </span>
        )}
      </div>

      {/* Right-side controls */}
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
          onClick={() => setPipelineDensity(pipelineDensity === 'card' ? 'compact' : 'card')}
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
        <ExportDropdown />
        <button
          onClick={() => void handleTriggerDrain()}
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
    </header>
  )
}
