import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronUp, ChevronDown, X } from 'lucide-react'
import { useTerminalStore } from '../../stores/terminal'
import { getSearchAddon } from './TerminalPane'

export function FindBar(): React.JSX.Element | null {
  const showFind = useTerminalStore((s) => s.showFind)
  const setShowFind = useTerminalStore((s) => s.setShowFind)
  const activeTabId = useTerminalStore((s) => s.activeTabId)
  const [query, setQuery] = useState('')
  const [resultIndex, setResultIndex] = useState(-1)
  const [resultCount, setResultCount] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input when find bar opens
  useEffect(() => {
    if (showFind) {
      inputRef.current?.focus()
      inputRef.current?.select()
    } else {
      setQuery('')
      setResultIndex(-1)
      setResultCount(0)
      if (activeTabId) {
        getSearchAddon(activeTabId)?.clearDecorations()
      }
    }
  }, [showFind, activeTabId])

  // Listen for search result changes
  useEffect(() => {
    if (!activeTabId) return
    const addon = getSearchAddon(activeTabId)
    if (!addon) return

    const disposable = addon.onDidChangeResults((e) => {
      setResultIndex(e.resultIndex)
      setResultCount(e.resultCount)
    })
    return () => disposable.dispose()
  }, [activeTabId])

  // Trigger search when query changes
  useEffect(() => {
    if (!activeTabId) return
    const addon = getSearchAddon(activeTabId)
    if (!addon) return

    if (query) {
      addon.findNext(query, { incremental: true })
    } else {
      addon.clearDecorations()
      setResultIndex(-1)
      setResultCount(0)
    }
  }, [query, activeTabId])

  const findNext = useCallback(() => {
    if (!activeTabId || !query) return
    getSearchAddon(activeTabId)?.findNext(query)
  }, [activeTabId, query])

  const findPrevious = useCallback(() => {
    if (!activeTabId || !query) return
    getSearchAddon(activeTabId)?.findPrevious(query)
  }, [activeTabId, query])

  const close = useCallback(() => {
    setShowFind(false)
  }, [setShowFind])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (e.shiftKey) findPrevious()
        else findNext()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    },
    [findNext, findPrevious, close]
  )

  if (!showFind) return null

  const countLabel =
    query && resultCount > 0
      ? `${resultIndex + 1} of ${resultCount}`
      : query
        ? 'No results'
        : ''

  return (
    <div className="terminal-find">
      <input
        ref={inputRef}
        className="terminal-find__input"
        type="text"
        placeholder="Find…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <span className="terminal-find__count">{countLabel}</span>
      <button
        className="terminal-find__btn"
        onClick={findPrevious}
        title="Previous match (Shift+Enter)"
      >
        <ChevronUp size={14} />
      </button>
      <button
        className="terminal-find__btn"
        onClick={findNext}
        title="Next match (Enter)"
      >
        <ChevronDown size={14} />
      </button>
      <button className="terminal-find__btn" onClick={close} title="Close (Escape)">
        <X size={14} />
      </button>
    </div>
  )
}
