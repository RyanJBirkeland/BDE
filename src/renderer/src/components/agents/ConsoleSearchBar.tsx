/**
 * ConsoleSearchBar — Search/filter bar for console events with match highlighting
 */
import { useRef, useEffect } from 'react'
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react'
import './ConsoleSearchBar.css'

interface ConsoleSearchBarProps {
  value: string
  onSearch: (query: string) => void
  onClose: () => void
  matchCount: number
  activeMatch: number
  onNext: () => void
  onPrev: () => void
}

export function ConsoleSearchBar({
  value,
  onSearch,
  onClose,
  matchCount,
  activeMatch,
  onNext,
  onPrev
}: ConsoleSearchBarProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Auto-focus when mounted
    inputRef.current?.focus()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        onPrev()
      } else {
        onNext()
      }
    }
  }

  return (
    <div className="console-search-bar">
      <Search size={14} className="console-search-bar__icon" />
      <input
        ref={inputRef}
        type="text"
        className="console-search-bar__input"
        placeholder="Search console output..."
        value={value}
        onChange={(e) => onSearch(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {matchCount > 0 && (
        <span className="console-search-bar__count">
          {activeMatch} of {matchCount}
        </span>
      )}
      <div className="console-search-bar__nav">
        <button
          className="console-search-bar__nav-btn"
          onClick={onPrev}
          disabled={matchCount === 0}
          aria-label="Previous match"
        >
          <ChevronUp size={14} />
        </button>
        <button
          className="console-search-bar__nav-btn"
          onClick={onNext}
          disabled={matchCount === 0}
          aria-label="Next match"
        >
          <ChevronDown size={14} />
        </button>
      </div>
      <button className="console-search-bar__close-btn" onClick={onClose} aria-label="Close search">
        <X size={14} />
      </button>
    </div>
  )
}
