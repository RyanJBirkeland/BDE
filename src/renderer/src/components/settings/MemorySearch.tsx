import { Search, X } from 'lucide-react'

interface MemorySearchProps {
  searchQuery: string
  onSearch: (query: string) => void
  onClearSearch: () => void
}

export function MemorySearch({
  searchQuery,
  onSearch,
  onClearSearch
}: MemorySearchProps): React.JSX.Element {
  return (
    <div className="memory-sidebar__search">
      <div className="memory-sidebar__search-input-wrapper">
        <Search size={16} className="memory-sidebar__search-icon" />
        <input
          className="memory-sidebar__search-input"
          value={searchQuery}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search memory files..."
        />
        {searchQuery && (
          <button
            className="memory-sidebar__search-clear"
            onClick={onClearSearch}
            title="Clear search"
            aria-label="Clear search"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
