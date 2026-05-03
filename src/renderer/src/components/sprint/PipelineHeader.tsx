import { GitMerge, HeartPulse, LayoutGrid, List, Network, Download, RefreshCw } from 'lucide-react'
import { useSprintUI } from '../../stores/sprintUI'
import type { SprintTask } from '../../../../shared/types'
import { useState, useEffect, useCallback } from 'react'
import { toast } from '../../stores/toasts'
import { useBackoffInterval } from '../../hooks/useBackoffInterval'

import './PipelineHeader.css'

interface StatBadge {
  label: string
  count: number
  filter: 'in-progress' | 'todo' | 'blocked' | 'review' | 'open-prs' | 'failed' | 'done'
}

interface PipelineHeaderProps {
  stats: StatBadge[]
  conflictingTasks: SprintTask[]
  visibleStuckTasks: SprintTask[]
  onFilterClick: (filter: StatBadge['filter']) => void
  onConflictClick: () => void
  onHealthCheckClick: () => void
  onDagToggle?: (() => void) | undefined
  dagOpen?: boolean | undefined
}

export function PipelineHeader({
  stats,
  conflictingTasks,
  visibleStuckTasks,
  onFilterClick,
  onConflictClick,
  onHealthCheckClick,
  onDagToggle,
  dagOpen
}: PipelineHeaderProps): React.JSX.Element {
  const pipelineDensity = useSprintUI((s) => s.pipelineDensity)
  const setPipelineDensity = useSprintUI((s) => s.setPipelineDensity)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [wipSlots, setWipSlots] = useState<{ active: number; max: number } | null>(null)
  const [triggering, setTriggering] = useState(false)

  const handleExport = async (format: 'json' | 'csv'): Promise<void> => {
    setShowExportMenu(false)
    setExporting(true)
    try {
      const result = await window.api.sprint.exportTasks(format)
      if (!result.canceled && result.filePath) {
        toast.success('Tasks exported')
      }
    } catch (err) {
      console.error('Export failed:', err)
      toast.error('Export failed')
    } finally {
      setExporting(false)
    }
  }

  // Close menu when clicking outside
  useEffect(() => {
    if (!showExportMenu) return

    const handleClickOutside = (): void => setShowExportMenu(false)
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [showExportMenu])

  const fetchStatus = useCallback(async (): Promise<void> => {
    try {
      const status = await window.api.agentManager.status()
      setWipSlots({
        active: status.concurrency.activeCount,
        max: status.concurrency.maxSlots
      })
    } catch {
      // agent manager may not be running — badge stays hidden
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
    <header className="sprint-pipeline__header">
      <h1 className="sprint-pipeline__title text-gradient-aurora">Task Pipeline</h1>
      <button
        className={`sprint-pipeline__badge pipeline-header__trigger-btn${triggering ? ' pipeline-header__trigger-btn--spinning' : ''}`}
        onClick={handleTriggerDrain}
        disabled={triggering}
        title="Trigger drain loop now — check for queued tasks immediately"
        aria-label="Check now"
      >
        <RefreshCw size={12} />
      </button>
      <div className="sprint-pipeline__stats">
        {stats.map((stat) => (
          <button
            key={stat.label}
            type="button"
            className={`sprint-pipeline__stat sprint-pipeline__stat--${stat.label} sprint-pipeline__stat--clickable`}
            onClick={() => onFilterClick(stat.filter)}
          >
            <b className="sprint-pipeline__stat-count">{stat.count}</b> {stat.label}
          </button>
        ))}
        {wipSlots !== null && (
          <span
            className="sprint-pipeline__wip-badge"
            title="Max concurrent agents. Change in Settings → Agents."
            aria-label={`${wipSlots.active} of ${wipSlots.max} agent slots active. Max concurrent agents. Change in Settings → Agents.`}
          >
            <span className="sprint-pipeline__wip-active">{wipSlots.active}</span>
            <span className="sprint-pipeline__wip-sep">/</span>
            <span className="sprint-pipeline__wip-max">{wipSlots.max}</span>
            <span className="sprint-pipeline__wip-label">slots</span>
          </span>
        )}
      </div>
      <button
        className="sprint-pipeline__badge"
        onClick={() => setPipelineDensity(pipelineDensity === 'card' ? 'compact' : 'card')}
        title={pipelineDensity === 'card' ? 'Switch to compact view' : 'Switch to card view'}
        aria-label={pipelineDensity === 'card' ? 'Switch to compact view' : 'Switch to card view'}
      >
        {pipelineDensity === 'card' ? <List size={14} /> : <LayoutGrid size={14} />}
      </button>
      <button
        className={`sprint-pipeline__badge ${dagOpen ? 'sprint-pipeline__badge--active' : ''}`}
        onClick={onDagToggle}
        title="Toggle dependency graph"
        aria-label="Toggle dependency graph visualization"
      >
        <Network size={12} />
        <span>DAG</span>
      </button>
      <div className="sprint-pipeline__export-wrapper">
        <button
          className="sprint-pipeline__badge"
          onClick={() => setShowExportMenu(!showExportMenu)}
          disabled={exporting}
          title="Export tasks"
          aria-label="Export sprint tasks"
        >
          <Download size={12} />
          <span>{exporting ? '...' : 'Export'}</span>
        </button>
        {showExportMenu && (
          <div
            className="sprint-pipeline__export-menu"
            style={{
              backgroundColor: 'var(--fleet-surface)',
              border: '1px solid var(--fleet-border)'
            }}
          >
            <button
              className="sprint-pipeline__export-option"
              onClick={() => handleExport('json')}
              disabled={exporting}
            >
              {exporting ? 'Exporting…' : 'JSON'}
            </button>
            <button
              className="sprint-pipeline__export-option"
              onClick={() => handleExport('csv')}
              disabled={exporting}
            >
              {exporting ? 'Exporting…' : 'CSV'}
            </button>
          </div>
        )}
      </div>
      {conflictingTasks.length > 0 && (
        <button
          className="sprint-pipeline__badge sprint-pipeline__badge--danger"
          onClick={onConflictClick}
          title={`${conflictingTasks.length} PR conflict${conflictingTasks.length > 1 ? 's' : ''}`}
          aria-label={`${conflictingTasks.length} merge conflict${conflictingTasks.length > 1 ? 's' : ''}`}
        >
          <GitMerge size={12} />
          <span>{conflictingTasks.length}</span>
        </button>
      )}
      {visibleStuckTasks.length > 0 && (
        <button
          className="sprint-pipeline__badge sprint-pipeline__badge--warning"
          onClick={onHealthCheckClick}
          title={`${visibleStuckTasks.length} stuck task${visibleStuckTasks.length > 1 ? 's' : ''}`}
          aria-label={`${visibleStuckTasks.length} stuck task${visibleStuckTasks.length > 1 ? 's' : ''}`}
        >
          <HeartPulse size={12} />
          <span>{visibleStuckTasks.length}</span>
        </button>
      )}
    </header>
  )
}
