import { GitMerge, HeartPulse, LayoutGrid, List, Network, Download } from 'lucide-react'
import { useSprintUI } from '../../stores/sprintUI'
import type { SprintTask } from '../../../../shared/types'
import { useState, useEffect } from 'react'
import { toast } from '../../stores/toasts'

interface StatBadge {
  label: string
  count: number
  filter: 'in-progress' | 'todo' | 'blocked' | 'awaiting-review' | 'failed' | 'done'
}

interface PipelineHeaderProps {
  stats: StatBadge[]
  conflictingTasks: SprintTask[]
  visibleStuckTasks: SprintTask[]
  onFilterClick: (filter: StatBadge['filter']) => void
  onConflictClick: () => void
  onHealthCheckClick: () => void
  onDagToggle?: () => void
  dagOpen?: boolean
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

  return (
    <header className="sprint-pipeline__header">
      <h1 className="sprint-pipeline__title text-gradient-aurora">Task Pipeline</h1>
      <div className="sprint-pipeline__stats">
        {stats.map((stat) => (
          <span
            key={stat.label}
            className={`sprint-pipeline__stat sprint-pipeline__stat--${stat.label} sprint-pipeline__stat--clickable`}
            onClick={() => onFilterClick(stat.filter)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onFilterClick(stat.filter)
            }}
          >
            <b className="sprint-pipeline__stat-count">{stat.count}</b> {stat.label}
          </span>
        ))}
      </div>
      <button
        className="sprint-pipeline__density-toggle"
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
      <div style={{ position: 'relative' }}>
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
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: '4px',
              backgroundColor: 'var(--bde-surface)',
              border: '1px solid var(--bde-border)',
              borderRadius: '4px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              zIndex: 1000,
              minWidth: '80px'
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
