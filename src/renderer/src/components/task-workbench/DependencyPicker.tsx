import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { TaskDependency, SprintTask } from '../../../../shared/types'
import { NeonBadge } from '../neon/NeonBadge'
import './DependencyPicker.css'

interface DependencyPickerProps {
  dependencies: TaskDependency[]
  availableTasks: SprintTask[]
  onChange: (deps: TaskDependency[]) => void
  currentTaskId: string | undefined
}

const MAX_RESULTS = 30

export function DependencyPicker({
  dependencies,
  availableTasks,
  onChange,
  currentTaskId
}: DependencyPickerProps): React.JSX.Element {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedIds = useMemo(() => new Set(dependencies.map((d) => d.id)), [dependencies])

  // Compute the complete match list once; slicing for the visible window happens below.
  const allMatches = useMemo(() => {
    const searchLower = search.toLowerCase()
    const results: SprintTask[] = []

    for (const task of availableTasks) {
      if (task.id === currentTaskId || selectedIds.has(task.id)) {
        continue
      }
      if (searchLower && !task.title.toLowerCase().includes(searchLower)) {
        continue
      }
      results.push(task)
    }

    return results
  }, [availableTasks, currentTaskId, selectedIds, search])

  const totalMatches = allMatches.length
  const visibleTasks = showAll ? allMatches : allMatches.slice(0, MAX_RESULTS)
  const hasMore = totalMatches > MAX_RESULTS && !showAll

  // Reset show-all whenever the search text changes so each query starts windowed.
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    setShowAll(false)
  }, [])

  const openDropdown = useCallback(() => {
    setDropdownOpen(true)
    setSearch('')
    setShowAll(false)
    // Focus search input on next tick
    setTimeout(() => searchRef.current?.focus(), 0)
  }, [])

  const closeDropdown = useCallback(() => {
    setDropdownOpen(false)
    setSearch('')
    setShowAll(false)
  }, [])

  const handleAddTask = useCallback(
    (task: SprintTask) => {
      onChange([...dependencies, { id: task.id, type: 'hard' }])
      closeDropdown()
    },
    [dependencies, onChange, closeDropdown]
  )

  const handleRemove = useCallback(
    (id: string) => {
      onChange(dependencies.filter((d) => d.id !== id))
    },
    [dependencies, onChange]
  )

  const handleToggleType = useCallback(
    (id: string) => {
      onChange(
        dependencies.map((d) =>
          d.id === id ? { ...d, type: d.type === 'hard' ? 'soft' : 'hard' } : d
        )
      )
    },
    [dependencies, onChange]
  )

  const handleChangeCondition = useCallback(
    (id: string, condition: 'on_success' | 'on_failure' | 'always' | undefined) => {
      onChange(
        dependencies.map((d) => {
          if (d.id !== id) return d
          return condition === undefined ? { ...d, condition: undefined } : { ...d, condition }
        })
      )
    },
    [dependencies, onChange]
  )

  // Close on outside click
  useEffect(() => {
    if (!dropdownOpen) return
    const handleMouseDown = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeDropdown()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [dropdownOpen, closeDropdown])

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeDropdown()
      }
    },
    [closeDropdown]
  )

  const getTaskTitle = (id: string): string => {
    return availableTasks.find((t) => t.id === id)?.title ?? id
  }

  return (
    <div className="wb-deps" ref={containerRef} role="group" aria-labelledby="wb-deps-label">
      <div id="wb-deps-label" className="wb-form__label">
        Dependencies
      </div>
      <p className="wb-deps__help" id="wb-deps-help">
        Hard = blocks on upstream failure · Soft = unblocks regardless.
      </p>

      {dependencies.length > 0 && (
        <ul className="wb-deps__list" aria-label="Selected dependencies">
          {dependencies.map((dep) => (
            <li key={dep.id} className="wb-deps__item">
              <span className="wb-deps__title" title={getTaskTitle(dep.id)}>
                {getTaskTitle(dep.id)}
              </span>
              <button
                type="button"
                className="wb-deps__type-btn"
                onClick={() => handleToggleType(dep.id)}
                aria-label={`${dep.type} — click to toggle`}
                title={`${dep.type === 'hard' ? 'Hard: blocks if upstream fails' : 'Soft: unblocks regardless of upstream outcome'} — click to toggle`}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                <NeonBadge
                  accent={dep.type === 'hard' ? 'red' : 'cyan'}
                  label={(dep.type || 'hard').toUpperCase()}
                />
              </button>
              <select
                className="wb-deps__condition bde-select"
                value={dep.condition ?? ''}
                onChange={(e) =>
                  handleChangeCondition(
                    dep.id,
                    e.target.value === ''
                      ? undefined
                      : (e.target.value as 'on_success' | 'on_failure' | 'always')
                  )
                }
                aria-label="Dependency condition"
                title="When should this dependency be satisfied?"
              >
                <option value="">Default (type-based)</option>
                <option value="on_success">On Success</option>
                <option value="on_failure">On Failure</option>
                <option value="always">Always (any terminal status)</option>
              </select>
              <button
                type="button"
                className="wb-deps__remove"
                onClick={() => handleRemove(dep.id)}
                aria-label="Remove dependency"
                title="Remove dependency"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="wb-deps__picker-wrap">
        {!dropdownOpen && (
          <button
            type="button"
            className="wb-deps__add"
            onClick={openDropdown}
            aria-label="Add dependency"
          >
            + Add dependency
          </button>
        )}

        {dropdownOpen && (
          <div className="wb-deps__picker" onKeyDown={handleKeyDown}>
            <input
              ref={searchRef}
              type="text"
              className="wb-deps__search"
              placeholder="Search tasks…"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              aria-label="Search tasks"
            />
            <ul className="wb-deps__results" role="listbox" aria-label="Task results">
              {visibleTasks.length === 0 ? (
                <li className="wb-deps__empty">No matching tasks</li>
              ) : (
                <>
                  {visibleTasks.map((task) => (
                    <li key={task.id}>
                      <button
                        type="button"
                        className="wb-deps__result"
                        role="option"
                        aria-selected={false}
                        onClick={() => handleAddTask(task)}
                      >
                        <span className="wb-deps__result-title">{task.title}</span>
                        <span className="wb-deps__result-status">{task.status}</span>
                      </button>
                    </li>
                  ))}
                  {hasMore && (
                    <li className="wb-deps__more">
                      <button
                        type="button"
                        className="wb-deps__show-all"
                        onClick={() => setShowAll(true)}
                      >
                        Showing {MAX_RESULTS} of {totalMatches} — Show all
                      </button>
                    </li>
                  )}
                </>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
