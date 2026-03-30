import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DiffFile, DiffLine } from '../../lib/diff-parser'
import { countDiffLines } from '../../lib/diff-parser'
import { usePanelLayoutStore } from '../../stores/panelLayout'
import { EmptyState } from '../ui/EmptyState'
import { DIFF_VIRTUALIZE_THRESHOLD } from '../../lib/constants'
import type { PrComment } from '../../../../shared/types'
import { DiffCommentWidget } from './DiffCommentWidget'
import { DiffCommentComposer } from './DiffCommentComposer'
import type { PendingComment } from '../../stores/pendingReview'

export interface LineRange {
  file: string
  startLine: number
  endLine: number
  side: 'LEFT' | 'RIGHT'
}

function FileList({
  files,
  activeFileIndex,
  onSelect
}: {
  files: DiffFile[]
  activeFileIndex: number
  onSelect: (index: number) => void
}): React.JSX.Element {
  return (
    <div className="diff-sidebar">
      <div className="diff-sidebar__header">
        <span className="diff-sidebar__title">Files</span>
        <span className="diff-sidebar__count bde-count-badge">{files.length}</span>
      </div>
      <div className="diff-sidebar__list">
        {files.map((f, i) => (
          <button
            key={f.path}
            className={`diff-file-item ${activeFileIndex === i ? 'diff-file-item--active' : ''}`}
            onClick={() => onSelect(i)}
          >
            <span className="diff-file-item__name">{f.path.split('/').pop()}</span>
            <span className="diff-file-item__badge">
              {f.additions > 0 && <span className="diff-file-item__add">+{f.additions}</span>}
              {f.deletions > 0 && <span className="diff-file-item__del">-{f.deletions}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
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

// ─── Plain (non-virtualized) diff content ────────────────

function PlainDiffContent({
  files,
  activeFileIndex,
  activeHunk,
  fileRefs,
  hunkRefs,
  commentsByPosition,
  pendingByPosition,
  selectedRange,
  selectionStart,
  isSelecting,
  composerRange,
  setSelectionStart,
  setIsSelecting,
  setComposerRange,
  onSelectRange,
  onAddComment,
  onRemovePendingComment,
  isLineSelected
}: {
  files: DiffFile[]
  activeFileIndex: number
  activeHunk: HunkAddress | null
  fileRefs: React.RefObject<Map<string, HTMLDivElement>>
  hunkRefs: React.RefObject<Map<string, HTMLDivElement>>
  commentsByPosition: Map<string, PrComment[]>
  pendingByPosition: Map<string, PendingComment[]>
  selectedRange: LineRange | null
  selectionStart: { file: string; line: number; side: 'LEFT' | 'RIGHT' } | null
  isSelecting: boolean
  composerRange: LineRange | null
  setSelectionStart: (v: { file: string; line: number; side: 'LEFT' | 'RIGHT' } | null) => void
  setIsSelecting: (v: boolean) => void
  setComposerRange: (v: LineRange | null) => void
  onSelectRange?: (range: LineRange | null) => void
  onAddComment?: (range: LineRange, body: string) => void
  onRemovePendingComment?: (commentId: string) => void
  isLineSelected: (filePath: string, lineNo: number | undefined) => boolean
}): React.JSX.Element {
  return (
    <>
      {files.map((file, fi) => (
        <div
          key={file.path}
          className={`diff-file ${activeFileIndex === fi ? 'diff-file--active' : ''}`}
          ref={(el): void => {
            if (el) fileRefs.current.set(file.path, el)
          }}
        >
          <div className="diff-file__header">
            <span className="diff-file__path">{file.path}</span>
            <span className="diff-file__stats">
              {file.additions > 0 && (
                <span className="diff-file__stats-add">+{file.additions}</span>
              )}
              {file.deletions > 0 && (
                <span className="diff-file__stats-del">-{file.deletions}</span>
              )}
            </span>
          </div>
          {file.hunks.map((hunk, hi) => (
            <div
              key={hi}
              className={`diff-hunk ${activeHunk?.fileIndex === fi && activeHunk?.hunkIndex === hi ? 'diff-hunk--focused' : ''}`}
              ref={(el): void => {
                if (el) hunkRefs.current.set(`${fi}-${hi}`, el)
              }}
            >
              <div className="diff-hunk__header">{hunk.header}</div>
              {hunk.lines.map((line, li) => {
                const lineNum = line.lineNo.new ?? line.lineNo.old
                const commentKey = lineNum ? `${file.path}:${lineNum}` : null
                const lineComments = commentKey ? commentsByPosition.get(commentKey) : undefined
                const selected = isLineSelected(file.path, line.lineNo.new)

                return (
                  <React.Fragment key={li}>
                    {selectedRange &&
                      selectedRange.file === file.path &&
                      line.lineNo.new === selectedRange.startLine &&
                      onAddComment && (
                        <div style={{ position: 'relative' }}>
                          <button
                            className="diff-selection-trigger"
                            onClick={(e) => {
                              e.stopPropagation()
                              setComposerRange(selectedRange)
                            }}
                            title="Add comment"
                          >
                            +
                          </button>
                        </div>
                      )}
                    <div
                      className={`diff-line diff-line--${line.type}${selected ? ' diff-line--selected' : ''}`}
                    >
                      <span
                        className={`diff-line__gutter diff-line__gutter--old${onSelectRange ? ' diff-line__gutter--selectable' : ''}`}
                        onMouseDown={() => {
                          if (!onSelectRange || line.lineNo.old == null) return
                          setSelectionStart({
                            file: file.path,
                            line: line.lineNo.old,
                            side: 'LEFT'
                          })
                          setIsSelecting(true)
                          onSelectRange({
                            file: file.path,
                            startLine: line.lineNo.old,
                            endLine: line.lineNo.old,
                            side: 'LEFT'
                          })
                        }}
                        onMouseEnter={() => {
                          if (
                            !isSelecting ||
                            !selectionStart ||
                            selectionStart.file !== file.path ||
                            selectionStart.side !== 'LEFT' ||
                            !onSelectRange
                          )
                            return
                          if (line.lineNo.old == null) return
                          onSelectRange({
                            file: file.path,
                            startLine: Math.min(selectionStart.line, line.lineNo.old),
                            endLine: Math.max(selectionStart.line, line.lineNo.old),
                            side: 'LEFT'
                          })
                        }}
                      >
                        {line.lineNo.old ?? ''}
                      </span>
                      <span
                        className={`diff-line__gutter diff-line__gutter--new${onSelectRange ? ' diff-line__gutter--selectable' : ''}`}
                        onMouseDown={() => {
                          if (!onSelectRange || line.lineNo.new == null) return
                          setSelectionStart({
                            file: file.path,
                            line: line.lineNo.new,
                            side: 'RIGHT'
                          })
                          setIsSelecting(true)
                          onSelectRange({
                            file: file.path,
                            startLine: line.lineNo.new,
                            endLine: line.lineNo.new,
                            side: 'RIGHT'
                          })
                        }}
                        onMouseEnter={() => {
                          if (
                            !isSelecting ||
                            !selectionStart ||
                            selectionStart.file !== file.path ||
                            selectionStart.side !== 'RIGHT' ||
                            !onSelectRange
                          )
                            return
                          if (line.lineNo.new == null) return
                          onSelectRange({
                            file: file.path,
                            startLine: Math.min(selectionStart.line, line.lineNo.new),
                            endLine: Math.max(selectionStart.line, line.lineNo.new),
                            side: 'RIGHT'
                          })
                        }}
                      >
                        {line.lineNo.new ?? ''}
                      </span>
                      <span className="diff-line__marker">
                        {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                      </span>
                      <span className="diff-line__text">{line.content}</span>
                    </div>
                    {lineComments && lineComments.length > 0 && (
                      <DiffCommentWidget comments={lineComments} />
                    )}
                    {composerRange &&
                      composerRange.file === file.path &&
                      line.lineNo.new === composerRange.endLine && (
                        <DiffCommentComposer
                          onSubmit={(body) => {
                            onAddComment?.(composerRange, body)
                            setComposerRange(null)
                            onSelectRange?.(null)
                          }}
                          onCancel={() => {
                            setComposerRange(null)
                            onSelectRange?.(null)
                          }}
                        />
                      )}
                    {(() => {
                      const pendingKey = lineNum ? `${file.path}:${lineNum}` : null
                      const pending = pendingKey ? pendingByPosition.get(pendingKey) : undefined
                      if (!pending || pending.length === 0) return null
                      return pending.map((pc) => (
                        <div
                          key={pc.id}
                          className="diff-comment-widget diff-comment-widget--pending"
                        >
                          <div className="diff-comment-widget__toggle">
                            <span>Pending comment</span>
                            <span className="diff-comment-widget__pending-badge">Pending</span>
                          </div>
                          <div className="diff-comment-widget__thread">
                            <div className="diff-comment-widget__comment">
                              <div className="diff-comment-widget__body">{pc.body}</div>
                              {onRemovePendingComment && (
                                <button
                                  className="diff-pending-comment__remove"
                                  onClick={() => onRemovePendingComment(pc.id)}
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    })()}
                  </React.Fragment>
                )
              })}
            </div>
          ))}
        </div>
      ))}
    </>
  )
}

// ─── Main DiffViewer ─────────────────────────────────────

function VirtualizedDiffBanner({ onForceFullDiff }: { onForceFullDiff: () => void }) {
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
  const [selectionStart, setSelectionStart] = useState<{
    file: string
    line: number
    side: 'LEFT' | 'RIGHT'
  } | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)

  useEffect(() => {
    const handleMouseUp = (): void => setIsSelecting(false)
    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [])

  const isLineSelected = useCallback(
    (filePath: string, lineNo: number | undefined): boolean => {
      if (!selectedRange || !lineNo) return false
      return (
        selectedRange.file === filePath &&
        lineNo >= selectedRange.startLine &&
        lineNo <= selectedRange.endLine
      )
    },
    [selectedRange]
  )

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
    if (activeView !== 'pr-station') return
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
      <FileList files={files} activeFileIndex={activeFileIndex} onSelect={scrollToFile} />
      <div className="diff-content" ref={containerRef}>
        {shouldShowBanner && <VirtualizedDiffBanner onForceFullDiff={() => setForceFullDiff(true)} />}
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
            isLineSelected={isLineSelected}
          />
        )}
      </div>
    </div>
  )
}

export { DiffViewer }
