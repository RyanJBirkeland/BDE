import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { TaskGroup } from '../../../../shared/types'
import { tokens } from '../../design-system/tokens'
import { EmptyState } from '../ui/EmptyState'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'

interface EpicListProps {
  groups: TaskGroup[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreateNew: () => void
}

interface GroupCounts {
  total: number
  done: number
}

export function EpicList({
  groups,
  selectedId,
  onSelect,
  onCreateNew
}: EpicListProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const [counts, setCounts] = useState<Map<string, GroupCounts>>(new Map())

  // Load task counts for each group
  useEffect(() => {
    const loadCounts = async (): Promise<void> => {
      const newCounts = new Map<string, GroupCounts>()

      for (const group of groups) {
        try {
          const tasks = await window.api.groups.getGroupTasks(group.id)
          const total = tasks.length
          const done = tasks.filter((t): boolean => t.status === 'done').length
          newCounts.set(group.id, { total, done })
        } catch {
          newCounts.set(group.id, { total: 0, done: 0 })
        }
      }

      setCounts(newCounts)
    }

    if (groups.length > 0) {
      loadCounts()
    }
  }, [groups])

  const getStatusColor = (status: TaskGroup['status']): string => {
    switch (status) {
      case 'completed':
        return tokens.color.accent
      case 'in-pipeline':
        return tokens.status.review
      case 'ready':
        return tokens.color.accent
      case 'draft':
      default:
        return tokens.color.textMuted
    }
  }

  const getStatusLabel = (status: TaskGroup['status']): string => {
    switch (status) {
      case 'completed':
        return 'Completed'
      case 'in-pipeline':
        return 'In Pipeline'
      case 'ready':
        return 'Ready'
      case 'draft':
      default:
        return 'Draft'
    }
  }

  const getProgressPercent = (groupId: string): number => {
    const groupCounts = counts.get(groupId)
    if (!groupCounts || groupCounts.total === 0) return 0
    return Math.round((groupCounts.done / groupCounts.total) * 100)
  }

  const getProgressColor = (percent: number): string => {
    if (percent === 100) return tokens.color.accent
    if (percent >= 50) return tokens.status.review
    if (percent > 0) return tokens.color.warning
    return tokens.color.textDim
  }

  const activeGroups = groups.filter((g) => g.status !== 'completed')
  const completedGroups = groups.filter((g) => g.status === 'completed')
  const [completedExpanded, setCompletedExpanded] = useState(false)

  const renderEpicItem = (group: TaskGroup): React.JSX.Element => {
    const isSelected = group.id === selectedId
    const groupCounts = counts.get(group.id) || { total: 0, done: 0 }
    const progressPercent = getProgressPercent(group.id)
    const progressColor = getProgressColor(progressPercent)

    return (
      <motion.button
        key={group.id}
        className={`planner-epic-item ${isSelected ? 'planner-epic-item--selected' : ''}`}
        onClick={() => onSelect(group.id)}
        type="button"
        variants={VARIANTS.staggerChild}
        transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
      >
        {isSelected && (
          <div className="planner-epic-item__accent" style={{ background: group.accent_color }} />
        )}

        <div
          className="planner-epic-item__icon"
          style={{
            background: `${group.accent_color}20`,
            color: group.accent_color,
            borderColor: `${group.accent_color}40`
          }}
        >
          {group.icon.charAt(0).toUpperCase()}
        </div>

        <div className="planner-epic-item__content">
          <div className="planner-epic-item__row">
            <span className="planner-epic-item__name" title={group.name}>{group.name}</span>
            <span
              className="planner-epic-item__status"
              style={{ color: getStatusColor(group.status) }}
            >
              {getStatusLabel(group.status)}
            </span>
          </div>

          <div className="planner-epic-item__row">
            <span className="planner-epic-item__tasks">
              {groupCounts.done}/{groupCounts.total} tasks
            </span>
          </div>

          <div
            className="planner-epic-item__progress-track"
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${group.name} progress: ${progressPercent}%`}
          >
            <div
              className="planner-epic-item__progress-fill"
              style={{
                width: `${progressPercent}%`,
                background: progressColor
              }}
            />
          </div>
        </div>
      </motion.button>
    )
  }

  return (
    <div className="planner-epic-list">
      <div className="planner-epic-list__header">
        <span className="planner-epic-list__title">Epics</span>
        <span className="planner-epic-list__count">{activeGroups.length}</span>
      </div>

      <motion.div
        className="planner-epic-list__scroll"
        variants={VARIANTS.staggerContainer}
        initial="initial"
        animate="animate"
      >
        {activeGroups.length === 0 && <EmptyState message="No active epics" />}
        {activeGroups.map(renderEpicItem)}

        {completedGroups.length > 0 && (
          <>
            <button
              className="planner-epic-list__section-toggle"
              onClick={() => setCompletedExpanded(!completedExpanded)}
              type="button"
            >
              <span className="planner-epic-list__section-chevron">
                {completedExpanded ? '\u25BC' : '\u25B6'}
              </span>
              <span>Completed</span>
              <span className="planner-epic-list__section-count">{completedGroups.length}</span>
            </button>
            {completedExpanded && completedGroups.map(renderEpicItem)}
          </>
        )}
      </motion.div>

      <div className="planner-epic-list__footer">
        <button className="planner-epic-list__new-button" onClick={onCreateNew} type="button">
          + New Epic
        </button>
      </div>
    </div>
  )
}
