import { useMemo } from 'react'
import { Search } from 'lucide-react'
import { useSprintUI } from '../../stores/sprintUI'
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
    </div>
  )
}
