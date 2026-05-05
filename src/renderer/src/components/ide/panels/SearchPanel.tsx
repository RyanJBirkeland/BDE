import { useState, useRef } from 'react'
import { ChevronDown, ChevronRight, CaseSensitive, Regex, Replace } from 'lucide-react'
import { PanelHeader } from '../PanelHeader'
import { IconBtn } from '../IconBtn'
import { useIDEStore } from '../../../stores/ide'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchMatch {
  line: number
  text: string
  matchStart: number
  matchEnd: number
}

interface SearchResult {
  filePath: string
  matches: SearchMatch[]
}

// ---------------------------------------------------------------------------
// Result group (one per file)
// ---------------------------------------------------------------------------

interface ResultGroupProps {
  result: SearchResult
  query: string
}

function ResultGroup({ result, query }: ResultGroupProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)

  const fileName = result.filePath.split('/').pop() ?? result.filePath
  const matchCount = result.matches.length

  return (
    <div>
      {/* Group header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded((v) => !v)
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-1)',
          height: 28,
          cursor: 'pointer',
          padding: '0 var(--s-1)',
          borderRadius: 'var(--r-sm)',
          outline: 'none'
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surf-2)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        onFocus={(e) => { e.currentTarget.style.outline = '2px solid var(--accent-line)' }}
        onBlur={(e) => { e.currentTarget.style.outline = 'none' }}
        aria-expanded={expanded}
      >
        <span style={{ color: 'var(--fg-3)', display: 'flex', alignItems: 'center' }}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--fg-2)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
          title={result.filePath}
        >
          {fileName}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-3)' }}>
          {matchCount}
        </span>
      </div>

      {/* Match rows */}
      {expanded && result.matches.map((match, idx) => (
        <MatchRow key={idx} match={match} query={query} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Individual match row
// ---------------------------------------------------------------------------

interface MatchRowProps {
  match: SearchMatch
  query: string
}

function MatchRow({ match }: MatchRowProps): React.JSX.Element {
  const before = match.text.slice(0, match.matchStart)
  const highlighted = match.text.slice(match.matchStart, match.matchEnd)
  const after = match.text.slice(match.matchEnd)

  return (
    <div
      style={{
        height: 22,
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 'var(--s-4)',
        paddingRight: 'var(--s-2)',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: 'var(--fg-2)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        cursor: 'default'
      }}
    >
      {before}
      <mark
        style={{
          background: 'var(--accent-soft)',
          color: 'var(--accent)',
          textDecoration: 'none',
          fontStyle: 'normal'
        }}
      >
        {highlighted}
      </mark>
      {after}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SearchPanel
// ---------------------------------------------------------------------------

export function SearchPanel(): React.JSX.Element {
  const rootPath = useIDEStore((s) => s.rootPath)
  const [query, setQuery] = useState('')
  const [replaceValue, setReplaceValue] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [matchCase, setMatchCase] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleQueryChange(newQuery: string): void {
    setQuery(newQuery)

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    if (!newQuery.trim()) {
      setResults([])
      setLoading(false)
      return
    }

    setLoading(true)
    debounceTimerRef.current = setTimeout(() => {
      void runSearch(newQuery)
    }, 300)
  }

  async function runSearch(searchQuery: string): Promise<void> {
    if (!rootPath || !searchQuery.trim()) {
      setResults([])
      setLoading(false)
      return
    }

    try {
      // TODO(phase-6.5): wire to search IPC — workbench:researchRepo expects
      // { query, repo } (repo name, not path). The IDE search panel needs a
      // path-based IPC that accepts rootPath directly. Stubbing empty results
      // until that channel is added.
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  const hasQuery = query.trim().length > 0

  return (
    <>
      <PanelHeader eyebrow="SEARCH">
        <IconBtn
          icon={<Replace size={14} />}
          title="Toggle Replace"
          active={showReplace}
          onClick={() => setShowReplace((v) => !v)}
        />
        <IconBtn
          icon={<CaseSensitive size={14} />}
          title="Match Case"
          active={matchCase}
          onClick={() => setMatchCase((v) => !v)}
        />
        <IconBtn
          icon={<Regex size={14} />}
          title="Use Regex"
          active={useRegex}
          onClick={() => setUseRegex((v) => !v)}
        />
      </PanelHeader>

      {/* Search input */}
      <div style={{ padding: 'var(--s-2) var(--s-3)' }}>
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Search files…"
          aria-label="Search files"
          style={{
            width: '100%',
            height: 28,
            background: 'var(--surf-3)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-md)',
            padding: '0 var(--s-2)',
            fontSize: 'var(--t-sm)',
            color: 'var(--fg)',
            outline: 'none',
            boxSizing: 'border-box'
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--accent-line)'
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--line)'
          }}
        />
      </div>

      {/* Replace input */}
      {showReplace && (
        <div style={{ padding: '0 var(--s-3) var(--s-2)' }}>
          <input
            type="text"
            value={replaceValue}
            onChange={(e) => setReplaceValue(e.target.value)}
            placeholder="Replace…"
            aria-label="Replace"
            style={{
              width: '100%',
              height: 28,
              background: 'var(--surf-3)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)',
              padding: '0 var(--s-2)',
              fontSize: 'var(--t-sm)',
              color: 'var(--fg)',
              outline: 'none',
              boxSizing: 'border-box'
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent-line)'
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--line)'
            }}
          />
        </div>
      )}

      {/* Results area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 var(--s-2) var(--s-2)',
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--line) transparent'
        }}
      >
        {!hasQuery && (
          <StatusMessage text="Type to search" />
        )}
        {hasQuery && loading && (
          <StatusMessage text="Searching…" />
        )}
        {hasQuery && !loading && results.length === 0 && (
          <StatusMessage text="No results" />
        )}
        {hasQuery && !loading && results.length > 0 && (
          <div>
            {results.map((result) => (
              <ResultGroup key={result.filePath} result={result} query={query} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Shared centered status text
// ---------------------------------------------------------------------------

function StatusMessage({ text }: { text: string }): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 'var(--s-6)',
        color: 'var(--fg-3)',
        fontSize: 'var(--t-sm)'
      }}
    >
      {text}
    </div>
  )
}
