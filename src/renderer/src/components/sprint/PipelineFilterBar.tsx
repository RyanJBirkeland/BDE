import { useMemo, useState, useRef, useCallback } from 'react'
import { Search, X } from 'lucide-react'
import { useSprintFilters } from '../../stores/sprintFilters'
import { useFilterPresets } from '../../stores/filterPresets'
import { PromptModal } from '../ui/PromptModal'
import type { SprintTask } from '../../../../shared/types'

const SEARCH_DEBOUNCE_MS = 150

interface PipelineFilterBarProps {
  tasks: SprintTask[]
}

export function PipelineFilterBar({ tasks }: PipelineFilterBarProps): React.JSX.Element | null {
  const searchQuery = useSprintFilters((s) => s.searchQuery)
  const setSearchQuery = useSprintFilters((s) => s.setSearchQuery)
  const repoFilter = useSprintFilters((s) => s.repoFilter)
  const setRepoFilter = useSprintFilters((s) => s.setRepoFilter)
  const statusFilter = useSprintFilters((s) => s.statusFilter)
  const setStatusFilter = useSprintFilters((s) => s.setStatusFilter)
  const tagFilter = useSprintFilters((s) => s.tagFilter)

  const presets = useFilterPresets((s) => s.presets)
  const savePreset = useFilterPresets((s) => s.savePreset)
  const loadPreset = useFilterPresets((s) => s.loadPreset)
  const deletePreset = useFilterPresets((s) => s.deletePreset)
  const [showSavePrompt, setShowSavePrompt] = useState(false)

  // Local input value so the text field responds instantly while the store
  // update (which triggers re-partitioning) is debounced by 150ms.
  const [localSearch, setLocalSearch] = useState(searchQuery)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearchChange = useCallback(
    (value: string): void => {
      setLocalSearch(value)
      if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(() => {
        setSearchQuery(value)
        debounceTimerRef.current = null
      }, SEARCH_DEBOUNCE_MS)
    },
    [setSearchQuery]
  )

  const repos = useMemo(() => {
    const set = new Set(tasks.map((t) => t.repo))
    return Array.from(set).sort()
  }, [tasks])

  const hasActiveFilters = !!(searchQuery || repoFilter || tagFilter || statusFilter !== 'all')
  const presetNames = Object.keys(presets)

  // Always show if there are presets, multiple repos, or active search
  if (repos.length <= 1 && !searchQuery && presetNames.length === 0) return null

  const handleSaveView = (): void => {
    setShowSavePrompt(true)
  }

  return (
    <div className="pipeline-filter-bar">
      <div className="pipeline-filter-bar__search">
        <Search size={12} />
        <input
          type="text"
          value={localSearch}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search tasks\u2026"
          className="pipeline-filter-bar__input"
          aria-label="Search tasks"
        />
      </div>
      {repos.length > 1 && (
        <div className="pipeline-filter-bar__chips">
          <button
            className={`pipeline-filter-bar__chip${!repoFilter ? ' pipeline-filter-bar__chip--active' : ''}`}
            onClick={() => setRepoFilter(null)}
            aria-pressed={!repoFilter}
          >
            All
          </button>
          {repos.map((repo) => (
            <button
              key={repo}
              className={`pipeline-filter-bar__chip${repoFilter === repo ? ' pipeline-filter-bar__chip--active' : ''}`}
              onClick={() => setRepoFilter(repoFilter === repo ? null : repo)}
              aria-pressed={repoFilter === repo}
            >
              {repo}
            </button>
          ))}
        </div>
      )}
      {presetNames.length > 0 && (
        <div className="pipeline-filter-bar__presets">
          {presetNames.map((name) => (
            <span key={name} className="pipeline-filter-bar__preset">
              <button
                className="pipeline-filter-bar__preset-name"
                onClick={() => {
                  const preset = loadPreset(name)
                  if (preset) {
                    setRepoFilter(preset.repoFilter)
                    setSearchQuery(preset.searchQuery)
                    setStatusFilter(preset.statusFilter)
                  }
                }}
              >
                {name}
              </button>
              <button
                className="pipeline-filter-bar__preset-delete"
                onClick={() => deletePreset(name)}
                aria-label={`Delete preset "${name}"`}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      {hasActiveFilters && (
        <button className="pipeline-filter-bar__save" onClick={handleSaveView}>
          Save View
        </button>
      )}
      <PromptModal
        open={showSavePrompt}
        title="Save Filter Preset"
        message="Enter a name for this filter preset:"
        placeholder="e.g. Active BDE tasks"
        confirmLabel="Save"
        onConfirm={(name) => {
          savePreset(name, { repoFilter, searchQuery, statusFilter })
          setShowSavePrompt(false)
        }}
        onCancel={() => setShowSavePrompt(false)}
      />
    </div>
  )
}
