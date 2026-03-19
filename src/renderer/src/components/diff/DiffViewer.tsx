import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DiffFile, DiffLine } from '../../lib/diff-parser'
import { countDiffLines } from '../../lib/diff-parser'
import { useUIStore } from '../../stores/ui'
import { EmptyState } from '../ui/EmptyState'
import { DIFF_VIRTUALIZE_THRESHOLD } from '../../lib/constants'

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
  hunkRefs
}: {
  files: DiffFile[]
  activeFileIndex: number
  activeHunk: HunkAddress | null
  fileRefs: React.RefObject<Map<string, HTMLDivElement>>
  hunkRefs: React.RefObject<Map<string, HTMLDivElement>>
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
              {hunk.lines.map((line, li) => (
                <div key={li} className={`diff-line diff-line--${line.type}`}>
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
              ))}
            </div>
          ))}
        </div>
      ))}
    </>
  )
}

// ─── Main DiffViewer ─────────────────────────────────────

function DiffViewer({ files }: { files: DiffFile[] }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const hunkRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [activeFileIndex, setActiveFileIndex] = useState(-1)
  const [activeHunk, setActiveHunk] = useState<HunkAddress | null>(null)
  const activeView = useUIStore((s) => s.activeView)

  const totalLines = useMemo(() => countDiffLines(files), [files])
  const useVirtualization = totalLines > DIFF_VIRTUALIZE_THRESHOLD

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
        rows.push({ kind: 'hunk-header', header: files[fi].hunks[hi].header, fileIndex: fi, hunkIndex: hi })
        height += HUNK_HEADER_HEIGHT

        for (let li = 0; li < files[fi].hunks[hi].lines.length; li++) {
          rows.push({ kind: 'line', line: files[fi].hunks[hi].lines[li], lineIndex: li })
          height += ROW_HEIGHT
        }
      }
    }

    return { flatRows: rows, totalHeight: height, fileIndexToRow: fiToRow, hunkAddressToRow: haToRow }
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

  const scrollToFile = useCallback((index: number): void => {
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
  }, [files, useVirtualization, fileIndexToRow, flatOffsets])

  const scrollToHunk = useCallback((addr: HunkAddress): void => {
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
  }, [useVirtualization, hunkAddressToRow, flatOffsets])

  // Keyboard navigation
  useEffect(() => {
    if (activeView !== 'diff') return
    if (files.length === 0) return

    const handler = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
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

  return (
    <div className="diff-view-container">
      <FileList files={files} activeFileIndex={activeFileIndex} onSelect={scrollToFile} />
      <div className="diff-content" ref={containerRef}>
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
          />
        )}
      </div>
    </div>
  )
}

export { DiffViewer }
