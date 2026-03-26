/**
 * SprintTaskList — Filterable left-pane task list for Sprint Center redesign.
 * Displays tasks with status badges, search, and filtering capabilities.
 */
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { Badge } from '../ui/Badge'
import { Input } from '../ui/Input'
import { Search, X, ChevronRight } from 'lucide-react'
import { repoColor, repoBadgeVariant, timeAgo } from '../../lib/format'
import { partitionSprintTasks } from '../../lib/partitionSprintTasks'
import { useSprintUI, type StatusFilter } from '../../stores/sprintUI'
import { SEARCH_DEBOUNCE_MS } from '../../lib/constants'
import type { SprintTask } from '../../../../shared/types'

interface SprintTaskListProps {
  tasks: SprintTask[]
  selectedTaskId: string | null
  onSelectTask: (task: SprintTask) => void
  repoFilter?: string | null
}

function getStatusLabel(status: StatusFilter): string {
  switch (status) {
    case 'all':
      return 'All Tasks'
    case 'backlog':
      return 'Backlog'
    case 'todo':
      return 'To Do'
    case 'blocked':
      return 'Blocked'
    case 'in-progress':
      return 'In Progress'
    case 'awaiting-review':
      return 'Awaiting Review'
    case 'done':
      return 'Done'
    case 'failed':
      return 'Failed'
    default:
      return 'All Tasks'
  }
}

function getStatusBadgeVariant(task: SprintTask): 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted' {
  switch (task.status) {
    case 'active':
      return task.pr_status === 'open' ? 'info' : 'warning'
    case 'done':
      return 'success'
    case 'failed':
    case 'error':
    case 'cancelled':
      return 'danger'
    case 'blocked':
      return 'danger'
    case 'queued':
      return 'info'
    case 'backlog':
    default:
      return 'muted'
  }
}

function getStatusDisplay(task: SprintTask): string {
  if (task.status === 'active' && task.pr_status === 'open') {
    return 'Review'
  }
  if (task.status === 'done' && task.pr_status === 'open') {
    return 'Review'
  }
  switch (task.status) {
    case 'active':
      return 'Active'
    case 'queued':
      return 'Todo'
    case 'blocked':
      return 'Blocked'
    case 'backlog':
      return 'Backlog'
    case 'done':
      return 'Done'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
    case 'error':
      return 'Error'
    default:
      return task.status
  }
}

/** Case-insensitive substring match against title, spec, and notes. */
export function matchesSearch(task: SprintTask, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return (
    task.title.toLowerCase().includes(q) ||
    (task.spec ?? '').toLowerCase().includes(q) ||
    (task.notes ?? '').toLowerCase().includes(q)
  )
}

/** Status groups config: order, label, and whether collapsed by default */
const STATUS_GROUPS = [
  { key: 'inProgress', label: 'In Progress', defaultCollapsed: false },
  { key: 'awaitingReview', label: 'Awaiting Review', defaultCollapsed: false },
  { key: 'todo', label: 'Queued', defaultCollapsed: false },
  { key: 'blocked', label: 'Blocked', defaultCollapsed: false },
  { key: 'backlog', label: 'Backlog', defaultCollapsed: false },
  { key: 'done', label: 'Done', defaultCollapsed: true },
  { key: 'failed', label: 'Failed', defaultCollapsed: true },
] as const

type GroupKey = typeof STATUS_GROUPS[number]['key']

export function SprintTaskList({ tasks, selectedTaskId, onSelectTask, repoFilter }: SprintTaskListProps) {
  // Store-backed search & status filter (allows programmatic navigation from Dashboard)
  const searchQuery = useSprintUI((s) => s.searchQuery)
  const setSearchQuery = useSprintUI((s) => s.setSearchQuery)
  const statusFilter = useSprintUI((s) => s.statusFilter)
  const setStatusFilter = useSprintUI((s) => s.setStatusFilter)

  // Collapsed state for status groups (when viewing "all")
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    for (const g of STATUS_GROUPS) {
      initial[g.key] = g.defaultCollapsed
    }
    return initial
  })

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  // Local input state for debounced search
  const [localSearch, setLocalSearch] = useState(searchQuery)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync local input to store with debounce
  const handleSearchChange = useCallback((value: string) => {
    setLocalSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearchQuery(value)
    }, SEARCH_DEBOUNCE_MS)
  }, [setSearchQuery])

  // Sync store → local when store changes externally (e.g. Dashboard drill-down clears search)
  useEffect(() => {
    setLocalSearch(searchQuery)
  }, [searchQuery])

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // Apply repo filter first
  const repoFilteredTasks = useMemo(() => {
    if (!repoFilter) return tasks
    return tasks.filter((t) => t.repo.toLowerCase() === repoFilter.toLowerCase())
  }, [tasks, repoFilter])

  // Partition tasks for status filtering
  const partition = useMemo(() => partitionSprintTasks(repoFilteredTasks), [repoFilteredTasks])

  // Apply status filter
  const statusFilteredTasks = useMemo(() => {
    switch (statusFilter) {
      case 'all':
        return repoFilteredTasks
      case 'backlog':
        return partition.backlog
      case 'todo':
        return partition.todo
      case 'blocked':
        return partition.blocked
      case 'in-progress':
        return partition.inProgress
      case 'awaiting-review':
        return partition.awaitingReview
      case 'done':
        return partition.done
      case 'failed':
        return partition.failed
      default:
        return repoFilteredTasks
    }
  }, [statusFilter, repoFilteredTasks, partition])

  // Apply search filter (uses debounced store value)
  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim()
    if (!q) return statusFilteredTasks
    return statusFilteredTasks.filter((task) => matchesSearch(task, q))
  }, [statusFilteredTasks, searchQuery])

  // Sort by priority (lower number = higher priority) for backlog/todo, by updated_at for others
  const sortedTasks = useMemo(() => {
    return [...filteredTasks].sort((a, b) => {
      if (statusFilter === 'backlog' || statusFilter === 'todo' || statusFilter === 'all') {
        return a.priority - b.priority
      }
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    })
  }, [filteredTasks, statusFilter])

  const statusFilterOptions: StatusFilter[] = [
    'all',
    'backlog',
    'todo',
    'in-progress',
    'awaiting-review',
    'blocked',
    'done',
    'failed',
  ]

  const getFilterCount = (filter: StatusFilter): number => {
    switch (filter) {
      case 'all':
        return repoFilteredTasks.length
      case 'backlog':
        return partition.backlog.length
      case 'todo':
        return partition.todo.length
      case 'blocked':
        return partition.blocked.length
      case 'in-progress':
        return partition.inProgress.length
      case 'awaiting-review':
        return partition.awaitingReview.length
      case 'done':
        return partition.done.length
      case 'failed':
        return partition.failed.length
      default:
        return 0
    }
  }

  return (
    <div className="sprint-task-list">
      <div className="sprint-task-list__header">
        <h2 className="sprint-task-list__title">Tasks</h2>
        <span className="sprint-task-list__count bde-count-badge">{sortedTasks.length}</span>
      </div>

      <div className="sprint-task-list__search">
        <Input
          value={localSearch}
          onChange={handleSearchChange}
          placeholder="Search tasks..."
          prefix={<Search size={14} />}
          suffix={
            localSearch && (
              <button
                className="sprint-task-list__clear-btn"
                onClick={() => { setLocalSearch(''); setSearchQuery('') }}
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )
          }
        />
      </div>

      <div className="sprint-task-list__filters">
        {statusFilterOptions.map((filter) => {
          const count = getFilterCount(filter)
          const isActive = statusFilter === filter
          return (
            <button
              key={filter}
              className={`sprint-task-list__filter-chip ${isActive ? 'sprint-task-list__filter-chip--active' : ''}`}
              onClick={() => setStatusFilter(filter)}
              disabled={count === 0}
            >
              {getStatusLabel(filter)}
              <span className="sprint-task-list__filter-count">{count}</span>
            </button>
          )
        })}
      </div>

      <div className="sprint-task-list__items">
        {sortedTasks.length === 0 ? (
          <div className="sprint-task-list__empty">
            {localSearch ? 'No tasks match your search' : 'No tasks in this category'}
          </div>
        ) : statusFilter === 'all' && !searchQuery.trim() ? (
          STATUS_GROUPS.map((group) => {
            const groupKey = group.key as GroupKey
            const groupTasks = partition[groupKey] || []
            if (groupTasks.length === 0) return null
            const isCollapsed = collapsedGroups[groupKey] ?? group.defaultCollapsed
            return (
              <div key={groupKey} className="sprint-task-list__status-group">
                <button
                  className="sprint-task-list__group-header"
                  onClick={() => toggleGroup(groupKey)}
                >
                  <ChevronRight
                    size={12}
                    className={`sprint-task-list__group-chevron ${!isCollapsed ? 'sprint-task-list__group-chevron--open' : ''}`}
                  />
                  <span>{group.label}</span>
                  <span className="sprint-task-list__group-count">{groupTasks.length}</span>
                </button>
                {!isCollapsed && groupTasks.map((task, index) => (
                  <TaskListItem
                    key={task.id}
                    task={task}
                    isSelected={task.id === selectedTaskId}
                    onSelect={onSelectTask}
                    index={index}
                  />
                ))}
              </div>
            )
          })
        ) : (
          sortedTasks.map((task, index) => (
            <TaskListItem
              key={task.id}
              task={task}
              isSelected={task.id === selectedTaskId}
              onSelect={onSelectTask}
              index={index}
            />
          ))
        )}
      </div>
    </div>
  )
}

function TaskListItem({
  task,
  isSelected,
  onSelect,
  index,
}: {
  task: SprintTask
  isSelected: boolean
  onSelect: (task: SprintTask) => void
  index: number
}) {
  return (
    <button
      className={`sprint-task-list-item ${isSelected ? 'sprint-task-list-item--selected' : ''}`}
      onClick={() => onSelect(task)}
      style={{ '--stagger-index': index } as React.CSSProperties}
    >
      <div className="sprint-task-list-item__header">
        <span
          className="sprint-task-list-item__repo-dot"
          style={{ background: repoColor(task.repo) }}
          title={task.repo}
        />
        <span className="sprint-task-list-item__title">{task.title}</span>
      </div>
      <div className="sprint-task-list-item__meta">
        <Badge variant={getStatusBadgeVariant(task)} size="sm">
          {getStatusDisplay(task)}
        </Badge>
        <Badge variant={repoBadgeVariant(task.repo)} size="sm">
          {task.repo}
        </Badge>
        {task.priority <= 2 && (
          <Badge variant="danger" size="sm">
            P{task.priority}
          </Badge>
        )}
      </div>
      <div className="sprint-task-list-item__footer">
        <span className="sprint-task-list-item__time">{timeAgo(task.updated_at)}</span>
        {task.pr_number && (
          <span className="sprint-task-list-item__pr" title={`PR #${task.pr_number}`}>
            #{task.pr_number}
          </span>
        )}
      </div>
    </button>
  )
}
