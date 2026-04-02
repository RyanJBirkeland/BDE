import { ChevronDown } from 'lucide-react'

export interface PRFilters {
  repo: string | null
  sort: 'updated' | 'created' | 'title'
}

interface PRStationFiltersProps {
  filters: PRFilters
  repos: string[]
  onChange: (filters: PRFilters) => void
}

const SORT_OPTIONS: { value: PRFilters['sort']; label: string }[] = [
  { value: 'updated', label: 'Last updated' },
  { value: 'created', label: 'Created' },
  { value: 'title', label: 'Title' }
]

export function PRStationFilters({ filters, repos, onChange }: PRStationFiltersProps) {
  function handleRepoClick(repo: string | null) {
    onChange({ ...filters, repo })
  }

  function handleSortChange(e: React.ChangeEvent<HTMLSelectElement>) {
    onChange({ ...filters, sort: e.target.value as PRFilters['sort'] })
  }

  return (
    <div className="pr-station-filters" role="group" aria-label="Filter pull requests">
      <div className="pr-station-filters__repos">
        <button
          className={`bde-btn bde-btn--sm ${filters.repo === null ? 'bde-btn--primary' : 'bde-btn--ghost'}`}
          onClick={() => handleRepoClick(null)}
          aria-pressed={filters.repo === null}
        >
          All
        </button>
        {repos.map((repo) => (
          <button
            key={repo}
            className={`bde-btn bde-btn--sm ${filters.repo === repo ? 'bde-btn--primary' : 'bde-btn--ghost'}`}
            onClick={() => handleRepoClick(repo)}
            aria-pressed={filters.repo === repo}
          >
            {repo}
          </button>
        ))}
      </div>

      <div className="pr-station-filters__sort">
        <label className="pr-station-filters__sort-label" htmlFor="pr-sort-select">
          Sort
        </label>
        <div className="pr-station-filters__sort-wrap">
          <select
            id="pr-sort-select"
            className="pr-station-filters__sort-select"
            value={filters.sort}
            onChange={handleSortChange}
            aria-label="Sort pull requests by"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown size={12} className="pr-station-filters__sort-icon" aria-hidden="true" />
        </div>
      </div>
    </div>
  )
}
