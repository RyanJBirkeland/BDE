import { useMemo } from 'react'
import { Search, Bookmark, X } from 'lucide-react'
import { useSprintUI } from '../../stores/sprintUI'
import { useFilterPresets } from '../../stores/filterPresets'
import type { SprintTask } from '../../../../shared/types'

interface PipelineFilterBarProps {
  tasks: SprintTask[]
}

export function PipelineFilterBar({ tasks }: PipelineFilterBarProps): React.JSX.Element | null {
  const searchQuery = useSprintUI((s) => s.searchQuery)
  const setSearchQuery = useSprintUI((s) => s.setSearchQuery)
  const repoFilter = useSprintUI((s) => s.repoFilter)
  const setRepoFilter = useSprintUI((s) => s.setRepoFilter)
  const tagFilter = useSprintUI((s) => s.tagFilter)
  const setTagFilter = useSprintUI((s) => s.setTagFilter)
||||||| 4bec9e91
  const statusFilter = useSprintUI((s) => s.statusFilter)

  const presets = useFilterPresets((s) => s.presets)
  const savePreset = useFilterPresets((s) => s.savePreset)
  const loadPreset = useFilterPresets((s) => s.loadPreset)
  const deletePreset = useFilterPresets((s) => s.deletePreset)

  const presetNames = useMemo(() => Object.keys(presets), [presets])

  const repos = useMemo(() => {
    const set = new Set(tasks.map((t) => t.repo))
    return Array.from(set).sort()
  }, [tasks])

  const allTags = useMemo(() => {
    const set = new Set<string>()
    tasks.forEach((t) => {
      if (t.tags) {
        t.tags.forEach((tag) => set.add(tag))
      }
    })
    return Array.from(set).sort()
  }, [tasks])

  if (repos.length <= 1 && allTags.length === 0 && !searchQuery) return null
||||||| 4bec9e91
  if (repos.length <= 1 && !searchQuery) return null
  const hasActiveFilters = searchQuery !== '' || repoFilter !== null || statusFilter !== 'all'

  const handleSavePreset = (): void => {
    const name = window.prompt('Enter a name for this filter preset:')
    if (name) {
      savePreset(name)
    }
  }

  if (repos.length <= 1 && !searchQuery && presetNames.length === 0) return null

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
      {allTags.length > 0 && (
        <div className="pipeline-filter-bar__chips">
          <span className="pipeline-filter-bar__label">Tags:</span>
          <button
            className={`pipeline-filter-bar__chip${!tagFilter ? ' pipeline-filter-bar__chip--active' : ''}`}
            onClick={() => setTagFilter(null)}
            aria-pressed={!tagFilter}
          >
            All
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              className={`pipeline-filter-bar__chip${tagFilter === tag ? ' pipeline-filter-bar__chip--active' : ''}`}
              onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
              aria-pressed={tagFilter === tag}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
||||||| 4bec9e91
      {presetNames.length > 0 && (
        <div className="pipeline-filter-bar__presets">
          {presetNames.map((name) => (
            <div key={name} className="pipeline-filter-bar__preset">
              <button
                className="pipeline-filter-bar__preset-btn"
                onClick={() => loadPreset(name)}
              >
                <Bookmark size={12} />
                {name}
              </button>
              <button
                className="pipeline-filter-bar__preset-delete"
                onClick={() => deletePreset(name)}
                aria-label={`Delete preset "${name}"`}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      {hasActiveFilters && (
        <button className="pipeline-filter-bar__save" onClick={handleSavePreset}>
          <Bookmark size={12} />
          Save View
        </button>
      )}
    </div>
  )
}
