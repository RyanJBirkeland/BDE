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

  const repos = useMemo(() => {
    const set = new Set(tasks.map((t) => t.repo))
    return Array.from(set).sort()
  }, [tasks])

  if (repos.length <= 1 && !searchQuery) return null

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
    </div>
  )
}
