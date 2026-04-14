import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import './QuickOpenPalette.css'

interface QuickOpenPaletteProps {
  rootPath: string
  onClose: () => void
  onSelectFile: (filePath: string) => void
}

interface FuzzyMatch {
  path: string
  score: number
  matches: number[]
}

/**
 * Fuzzy match scoring algorithm.
 * Scores based on:
 * - Sequential character matches (higher score)
 * - Position of matches (earlier matches score higher)
 * - Path separator boundaries (matches after / score higher)
 * Returns null if pattern doesn't match.
 */
function fuzzyMatch(pattern: string, str: string): FuzzyMatch | null {
  const patternLower = pattern.toLowerCase()
  const strLower = str.toLowerCase()
  const matches: number[] = []
  let score = 0
  let patternIdx = 0
  let lastMatchIdx = -1

  for (let i = 0; i < strLower.length && patternIdx < patternLower.length; i++) {
    if (strLower[i] === patternLower[patternIdx]) {
      matches.push(i)
      // Sequential bonus
      if (lastMatchIdx === i - 1) {
        score += 10
      }
      // Start of path segment bonus
      if (i === 0 || str[i - 1] === '/') {
        score += 20
      }
      // Earlier match bonus
      score += Math.max(0, 100 - i)
      lastMatchIdx = i
      patternIdx++
    }
  }

  if (patternIdx !== patternLower.length) {
    return null
  }

  return { path: str, score, matches }
}

export function QuickOpenPalette({
  rootPath,
  onClose,
  onSelectFile
}: QuickOpenPaletteProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [allFiles, setAllFiles] = useState<string[]>([])
  const [filteredFiles, setFilteredFiles] = useState<FuzzyMatch[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Load all files on mount
  useEffect(() => {
    void (async () => {
      try {
        const files = await window.api.fs.listFiles(rootPath)
        setAllFiles(files)
        setFilteredFiles(files.slice(0, 50).map((path) => ({ path, score: 0, matches: [] })))
      } catch (err) {
        console.error('Failed to list files:', err)
      } finally {
        setLoading(false)
      }
    })()
  }, [rootPath])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Filter files when query changes
  useEffect(() => {
    if (!query.trim()) {
      setFilteredFiles(allFiles.slice(0, 50).map((path) => ({ path, score: 0, matches: [] })))
      setSelectedIndex(0)
      return
    }

    const matches = allFiles
      .map((path) => fuzzyMatch(query, path))
      .filter((m): m is FuzzyMatch => m !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)

    setFilteredFiles(matches)
    setSelectedIndex(0)
  }, [query, allFiles])

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const selectedEl = list.children[selectedIndex] as HTMLElement | undefined
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, filteredFiles.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && filteredFiles[selectedIndex]) {
        e.preventDefault()
        const fullPath = `${rootPath}/${filteredFiles[selectedIndex].path}`
        onSelectFile(fullPath)
        onClose()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [filteredFiles, selectedIndex, rootPath, onSelectFile, onClose]
  )

  const handleSelect = useCallback(
    (path: string) => {
      const fullPath = `${rootPath}/${path}`
      onSelectFile(fullPath)
      onClose()
    },
    [rootPath, onSelectFile, onClose]
  )

  const renderHighlightedPath = (match: FuzzyMatch): React.JSX.Element => {
    const { path, matches } = match
    const parts: React.JSX.Element[] = []
    let lastIdx = 0

    for (const matchIdx of matches) {
      if (matchIdx > lastIdx) {
        parts.push(<span key={`text-${lastIdx}`}>{path.slice(lastIdx, matchIdx)}</span>)
      }
      parts.push(
        <span key={`match-${matchIdx}`} className="quick-open-palette__match">
          {path[matchIdx]}
        </span>
      )
      lastIdx = matchIdx + 1
    }
    if (lastIdx < path.length) {
      parts.push(<span key={`text-${lastIdx}`}>{path.slice(lastIdx)}</span>)
    }

    return <>{parts}</>
  }

  return (
    <div className="quick-open-palette-overlay" onClick={onClose}>
      <div className="quick-open-palette" onClick={(e) => e.stopPropagation()}>
        <div className="quick-open-palette__header">
          <input
            ref={inputRef}
            className="quick-open-palette__input"
            type="text"
            placeholder="Search files..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="quick-open-palette__close"
            onClick={onClose}
            aria-label="Close quick open"
          >
            <X size={16} />
          </button>
        </div>
        <div className="quick-open-palette__list" ref={listRef}>
          {loading ? (
            <div className="quick-open-palette__empty">Loading files...</div>
          ) : filteredFiles.length === 0 ? (
            <div className="quick-open-palette__empty">No files found</div>
          ) : (
            filteredFiles.map((match, idx) => (
              <div
                key={match.path}
                className={`quick-open-palette__item ${idx === selectedIndex ? 'quick-open-palette__item--selected' : ''}`}
                onClick={() => handleSelect(match.path)}
              >
                {renderHighlightedPath(match)}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
