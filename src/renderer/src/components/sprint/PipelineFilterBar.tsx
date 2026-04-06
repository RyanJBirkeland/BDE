import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useSprintUI } from '../../stores/sprintUI'
import { useFilterPresets } from '../../stores/filterPresets'
import { PromptModal } from '../ui/PromptModal'
import type { SprintTask } from '../../../../shared/types'

interface PipelineFilterBarProps {
  tasks: SprintTask[]
}

export function PipelineFilterBar({ tasks }: PipelineFilterBarProps): React.JSX.Element | null {
  const searchQuery = useSprintUI((s) => s.searchQuery)
  const setSearchQuery = useSprintUI((s) => s.setSearchQuery)
  const repoFilter = useSprintUI((s) => s.repoFilter)
  const setRepoFilter = useSprintUI((s) => s.setRepoFilter)
  const statusFilter = useSprintUI((s) => s.statusFilter)

  const presets = useFilterPresets((s) => s.presets)
  const savePreset = useFilterPresets((s) => s.savePreset)
  const loadPreset = useFilterPresets((s) => s.loadPreset)
  const deletePreset = useFilterPresets((s) => s.deletePreset)
  const [showSavePrompt, setShowSavePrompt] = useState(false)

  const repos = useMemo(() => {
    const set = new Set(tasks.map((t) => t.repo))
    return Array.from(set).sort()
  }, [tasks])

  const hasActiveFilters = !!(searchQuery || repoFilter || statusFilter !== 'all')
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
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
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
              <button className="pipeline-filter-bar__preset-name" onClick={() => loadPreset(name)}>
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
          savePreset(name)
          setShowSavePrompt(false)
        }}
        onCancel={() => setShowSavePrompt(false)}
      />
    </div>
  )
}
