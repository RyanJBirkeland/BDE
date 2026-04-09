import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DiffFile, DiffLine } from '../../lib/diff-parser'
import { countDiffLines } from '../../lib/diff-parser'
import { usePanelLayoutStore } from '../../stores/panelLayout'
import { useDiffSelection } from '../../hooks/useDiffSelection'
import { EmptyState } from '../ui/EmptyState'
import { DIFF_VIRTUALIZE_THRESHOLD } from '../../lib/constants'
import type { PrComment } from '../../../../shared/types'
import type { PendingComment } from '../../stores/pendingReview'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { DiffFileList } from './DiffFileList'
import { PlainDiffContent } from './PlainDiffContent'

export interface LineRange {
  file: string
  startLine: number
  endLine: number
  side: 'LEFT' | 'RIGHT'
}

interface HunkAddress {
  fileIndex: number
  hunkIndex: number
}

// --- Row types for the flat virtualized list ---

interface FileHeaderRow {
  kind: 'file-header'
  file: DiffFile
  fileIndex: number
}

interface HunkHeaderRow {
  kind: 'hunk-header'
  header: string
  fileIndex: number
  hunkIndex: number
}

interface LineRow {
  kind: 'line'
  line: DiffLine
  lineIndex: number
}

type FlatRow = FileHeaderRow | HunkHeaderRow | LineRow

const ROW_HEIGHT = 20
const FILE_HEADER_HEIGHT = 36
const HUNK_HEADER_HEIGHT = 28
const OVERSCAN = 20

function rowHeight(row: FlatRow): number {
  if (row.kind === 'file-header') return FILE_HEADER_HEIGHT
  if (row.kind === 'hunk-header') return HUNK_HEADER_HEIGHT
  return ROW_HEIGHT
}

// ─── Virtualized diff content ────────────────────────────

function VirtualizedDiffContent({
  rows,
  totalHeight,
  offsets,
  activeFileIndex,
  activeHunk,
  containerRef
}: {
  rows: FlatRow[]
  totalHeight: number
  offsets: number[]
  activeFileIndex: number
  activeHunk: HunkAddress | null
  containerRef: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(800)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = (): void => setScrollTop(el.scrollTop)
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportHeight(entry.contentRect.height)
      }
    })
    el.addEventListener('scroll', onScroll, { passive: true })
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- containerRef identity is stable

  // Binary search for first visible row
  const startIdx = useMemo(() => {
    let lo = 0
    let hi = offsets.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (offsets[mid] + rowHeight(rows[mid]) <= scrollTop) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    return Math.max(0, lo - OVERSCAN)
  }, [offsets, rows, scrollTop])

  const endIdx = useMemo(() => {
    const bottom = scrollTop + viewportHeight + OVERSCAN * ROW_HEIGHT
    let i = startIdx
    while (i < rows.length && offsets[i] < bottom) i++
    return Math.min(i, rows.length)
  }, [offsets, rows, scrollTop, viewportHeight, startIdx])

  const visibleRows = rows.slice(startIdx, endIdx)
  const offsetTop = startIdx < offsets.length ? offsets[startIdx] : 0

  return (
    <div style={{ height: totalHeight, position: 'relative' }}>
      <div style={{ position: 'absolute', top: offsetTop, left: 0, right: 0 }}>
        {visibleRows.map((row, i) => {
          const globalIdx = startIdx + i
          if (row.kind === 'file-header') {
            return (
              <div
                key={`fh-${row.fileIndex}`}
                className={`diff-file__header ${activeFileIndex === row.fileIndex ? 'diff-file--active' : ''}`}
                style={{ height: FILE_HEADER_HEIGHT }}
              >
                <span className="diff-file__path">{row.file.path}</span>
                <span className="diff-file__stats">
                  {row.file.additions > 0 && (
                    <span className="diff-file__stats-add">+{row.file.additions}</span>
                  )}
                  {row.file.deletions > 0 && (
                    <span className="diff-file__stats-del">-{row.file.deletions}</span>
                  )}
                </span>
              </div>
            )
          }
          if (row.kind === 'hunk-header') {
            const isFocused =
              activeHunk?.fileIndex === row.fileIndex && activeHunk?.hunkIndex === row.hunkIndex
            return (
              <div
                key={`hh-${row.fileIndex}-${row.hunkIndex}`}
                className={`diff-hunk__header ${isFocused ? 'diff-hunk--focused' : ''}`}
                style={{ height: HUNK_HEADER_HEIGHT }}
              >
                {row.header}
              </div>
            )
          }
          // line row
          const line = row.line
          return (
            <div key={`l-${globalIdx}`} className={`diff-line diff-line--${line.type}`}>
              <span className="diff-line__gutter diff-line__gutter--old">
                {line.lineNo.old ?? ''}
              </span>
              <span className="diff-line__gutter diff-line__gutter--new">
                {line.lineNo.new ?? ''}
              </span>
              <span className="diff-line__marker">
                {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
              </span>
              <span className="diff-line__text">{line.content}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main DiffViewer ─────────────────────────────────────

function VirtualizedDiffBanner({
  onForceFullDiff
}: {
  onForceFullDiff: () => void
}): React.JSX.Element {
  return (
    <div className="diff-virtualized-banner">
      <span className="diff-virtualized-banner__text">
        Large diff — commenting disabled in virtualized mode.
      </span>
      <button
        className="diff-virtualized-banner__button bde-btn bde-btn--sm"
        onClick={onForceFullDiff}
      >
        Load full diff to enable comments
      </button>
    </div>
  )
}

interface DiffViewerProps {
  files: DiffFile[]
  comments?: PrComment[]
  pendingComments?: PendingComment[]
  selectedRange?: LineRange | null
  onSelectRange?: (range: LineRange | null) => void
  onAddComment?: (range: LineRange, body: string) => void
  onRemovePendingComment?: (commentId: string) => void
}

function DiffViewer({
  files,
  comments = [],
  pendingComments,
  selectedRange = null,
  onSelectRange,
  onAddComment,
  onRemovePendingComment
}: DiffViewerProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const hunkRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [activeFileIndex, setActiveFileIndex] = useState(-1)
  const [activeHunk, setActiveHunk] = useState<HunkAddress | null>(null)
  const [forceFullDiff, setForceFullDiff] = useState(false)
  const activeView = usePanelLayoutStore((s) => s.activeView)

  const totalLines = useMemo(() => countDiffLines(files), [files])
  const hasComments = comments.length > 0
  const useVirtualization = totalLines > DIFF_VIRTUALIZE_THRESHOLD && !hasComments && !forceFullDiff

  // Build comments-by-position map
  const commentsByPosition = useMemo(() => {
    const map = new Map<string, PrComment[]>()
    for (const c of comments) {
      if (!c.path || c.line == null) continue
      const key = `${c.path}:${c.line}`
      const arr = map.get(key) ?? []
      arr.push(c)
      map.set(key, arr)
    }
    return map
  }, [comments])

  // Composer state
  const [composerRange, setComposerRange] = useState<LineRange | null>(null)

  // Build pending-by-position map
  const pendingByPosition = useMemo(() => {
    const map = new Map<string, PendingComment[]>()
    for (const c of pendingComments ?? []) {
      const key = `${c.path}:${c.line}`
      const arr = map.get(key) ?? []
      arr.push(c)
      map.set(key, arr)
    }
    return map
  }, [pendingComments])

  // Selection state for line range picking
  const { selectionStart, isSelecting, setSelectionStart, setIsSelecting, isLineSelected } =
    useDiffSelection()

  // Build flat row list for virtualized mode
  const { flatRows, totalHeight, fileIndexToRow, hunkAddressToRow } = useMemo(() => {
    if (!useVirtualization) {
      return {
        flatRows: [] as FlatRow[],
        totalHeight: 0,
        fileIndexToRow: new Map<number, number>(),
        hunkAddressToRow: new Map<string, number>()
      }
    }

    const rows: FlatRow[] = []
    const fiToRow = new Map<number, number>()
    const haToRow = new Map<string, number>()
    let height = 0

    for (let fi = 0; fi < files.length; fi++) {
      fiToRow.set(fi, rows.length)
      rows.push({ kind: 'file-header', file: files[fi], fileIndex: fi })
      height += FILE_HEADER_HEIGHT

      for (let hi = 0; hi < files[fi].hunks.length; hi++) {
        haToRow.set(`${fi}-${hi}`, rows.length)
        rows.push({
          kind: 'hunk-header',
          header: files[fi].hunks[hi].header,
          fileIndex: fi,
          hunkIndex: hi
        })
        height += HUNK_HEADER_HEIGHT

        for (let li = 0; li < files[fi].hunks[hi].lines.length; li++) {
          rows.push({ kind: 'line', line: files[fi].hunks[hi].lines[li], lineIndex: li })
          height += ROW_HEIGHT
        }
      }
    }

    return {
      flatRows: rows,
      totalHeight: height,
      fileIndexToRow: fiToRow,
      hunkAddressToRow: haToRow
    }
  }, [files, useVirtualization])

  // Build flat hunk list for arrow key navigation
  const allHunks = useMemo(() => {
    const list: HunkAddress[] = []
    files.forEach((f, fi) => {
      f.hunks.forEach((_, hi) => {
        list.push({ fileIndex: fi, hunkIndex: hi })
      })
    })
    return list
  }, [files])

  // Pre-compute cumulative offsets for virtualized scroll-to
  const flatOffsets = useMemo(() => {
    if (!useVirtualization) return []
    const arr = new Array<number>(flatRows.length)
    let cumulative = 0
    for (let i = 0; i < flatRows.length; i++) {
      arr[i] = cumulative
      cumulative += rowHeight(flatRows[i])
    }
    return arr
  }, [flatRows, useVirtualization])

  const scrollToFile = useCallback(
    (index: number): void => {
      if (index < 0 || index >= files.length) return
      setActiveFileIndex(index)

      if (useVirtualization) {
        const rowIdx = fileIndexToRow.get(index)
        if (rowIdx !== undefined && containerRef.current) {
          containerRef.current.scrollTop = flatOffsets[rowIdx]
        }
      } else {
        const el = fileRefs.current.get(files[index].path)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    },
    [files, useVirtualization, fileIndexToRow, flatOffsets]
  )

  const scrollToHunk = useCallback(
    (addr: HunkAddress): void => {
      setActiveHunk(addr)
      setActiveFileIndex(addr.fileIndex)

      if (useVirtualization) {
        const rowIdx = hunkAddressToRow.get(`${addr.fileIndex}-${addr.hunkIndex}`)
        if (rowIdx !== undefined && containerRef.current) {
          containerRef.current.scrollTop = flatOffsets[rowIdx]
        }
      } else {
        const key = `${addr.fileIndex}-${addr.hunkIndex}`
        const el = hunkRefs.current.get(key)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    },
    [useVirtualization, hunkAddressToRow, flatOffsets]
  )

  // Keyboard navigation
  useEffect(() => {
    if (activeView !== 'code-review') return
    if (files.length === 0) return

    const handler = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      const tag = target.tagName
      // Don't fire in input fields, textareas, or contentEditable elements
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (target.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      // ] / [ — next/prev file
      if (e.key === ']') {
        e.preventDefault()
        const next = activeFileIndex < files.length - 1 ? activeFileIndex + 1 : 0
        scrollToFile(next)
        return
      }
      if (e.key === '[') {
        e.preventDefault()
        const prev = activeFileIndex > 0 ? activeFileIndex - 1 : files.length - 1
        scrollToFile(prev)
        return
      }

      // Arrow keys — step through hunks
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (allHunks.length === 0) return

        const currentIdx = activeHunk
          ? allHunks.findIndex(
              (h) => h.fileIndex === activeHunk.fileIndex && h.hunkIndex === activeHunk.hunkIndex
            )
          : -1

        let nextIdx: number
        if (e.key === 'ArrowDown') {
          nextIdx = currentIdx < allHunks.length - 1 ? currentIdx + 1 : 0
        } else {
          nextIdx = currentIdx > 0 ? currentIdx - 1 : allHunks.length - 1
        }
        scrollToHunk(allHunks[nextIdx])
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeView, files, activeFileIndex, activeHunk, allHunks, scrollToFile, scrollToHunk])

  if (files.length === 0) {
    return (
      <div className="diff-view-container">
        <EmptyState title="No changes vs origin/main" />
      </div>
    )
  }

  const shouldShowBanner = totalLines > DIFF_VIRTUALIZE_THRESHOLD && !hasComments && !forceFullDiff

  return (
    <div className="diff-view-container">
      <Group orientation="horizontal" style={{ flex: 1, minHeight: 0 }}>
        <Panel defaultSize={22} minSize={10} maxSize={40}>
          <DiffFileList files={files} activeFileIndex={activeFileIndex} onSelect={scrollToFile} />
        </Panel>
        <Separator className="panel-separator" />
        <Panel minSize={40}>
          <div className="diff-content" ref={containerRef}>
            {shouldShowBanner && (
              <VirtualizedDiffBanner onForceFullDiff={() => setForceFullDiff(true)} />
            )}
            {useVirtualization ? (
              <VirtualizedDiffContent
                rows={flatRows}
                totalHeight={totalHeight}
                offsets={flatOffsets}
                activeFileIndex={activeFileIndex}
                activeHunk={activeHunk}
                containerRef={containerRef}
              />
            ) : (
              <PlainDiffContent
                files={files}
                activeFileIndex={activeFileIndex}
                activeHunk={activeHunk}
                fileRefs={fileRefs}
                hunkRefs={hunkRefs}
                commentsByPosition={commentsByPosition}
                pendingByPosition={pendingByPosition}
                selectedRange={selectedRange}
                selectionStart={selectionStart}
                isSelecting={isSelecting}
                composerRange={composerRange}
                setSelectionStart={setSelectionStart}
                setIsSelecting={setIsSelecting}
                setComposerRange={setComposerRange}
                onSelectRange={onSelectRange}
                onAddComment={onAddComment}
                onRemovePendingComment={onRemovePendingComment}
                isLineSelected={(filePath, lineNo) => isLineSelected(filePath, lineNo, selectedRange)}
              />
            )}
          </div>
        </Panel>
      </Group>
    </div>
  )
}

export { DiffViewer }
