import { useState, useRef, useEffect, useCallback } from 'react'
import type { TaskDependency, SprintTask } from '../../../../shared/types'
import { NeonBadge } from '../neon/NeonBadge'

interface DependencyPickerProps {
  dependencies: TaskDependency[]
  availableTasks: SprintTask[]
  onChange: (deps: TaskDependency[]) => void
  currentTaskId: string | undefined
}

const MAX_RESULTS = 10

export function DependencyPicker({
  dependencies,
  availableTasks,
  onChange,
  currentTaskId
}: DependencyPickerProps): React.JSX.Element {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedIds = new Set(dependencies.map((d) => d.id))

  const filteredTasks = availableTasks
    .filter((t) => t.id !== currentTaskId && !selectedIds.has(t.id))
    .filter((t) => t.title.toLowerCase().includes(search.toLowerCase()))
    .slice(0, MAX_RESULTS)

  const openDropdown = useCallback(() => {
    setDropdownOpen(true)
    setSearch('')
    // Focus search input on next tick
    setTimeout(() => searchRef.current?.focus(), 0)
  }, [])

  const closeDropdown = useCallback(() => {
    setDropdownOpen(false)
    setSearch('')
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
      onChange(dependencies.map((d) => (d.id === id ? { ...d, condition } : d)))
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
                <NeonBadge accent={dep.type === 'hard' ? 'red' : 'cyan'} label={(dep.type || 'hard').toUpperCase()} />
              </button>
              <select
                className="wb-deps__condition"
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
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search tasks"
            />
            <ul className="wb-deps__results" role="listbox" aria-label="Task results">
              {filteredTasks.length === 0 ? (
                <li className="wb-deps__empty">No matching tasks</li>
              ) : (
                filteredTasks.map((task) => (
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
                ))
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
