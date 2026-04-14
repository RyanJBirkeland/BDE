import React, { useEffect, useMemo, useState } from 'react'
import type { DiffFile, DiffLine } from '../../lib/diff-parser'

const ROW_HEIGHT = 20
const FILE_HEADER_HEIGHT = 36
const HUNK_HEADER_HEIGHT = 28
const OVERSCAN = 20

// --- Row types for the flat virtualized list ---

export interface FileHeaderRow {
  kind: 'file-header'
  file: DiffFile
  fileIndex: number
}

export interface HunkHeaderRow {
  kind: 'hunk-header'
  header: string
  fileIndex: number
  hunkIndex: number
}

export interface LineRow {
  kind: 'line'
  line: DiffLine
  lineIndex: number
}

export type FlatRow = FileHeaderRow | HunkHeaderRow | LineRow

export interface HunkAddress {
  fileIndex: number
  hunkIndex: number
}

export function rowHeight(row: FlatRow): number {
  if (row.kind === 'file-header') return FILE_HEADER_HEIGHT
  if (row.kind === 'hunk-header') return HUNK_HEADER_HEIGHT
  return ROW_HEIGHT
}

export { ROW_HEIGHT, FILE_HEADER_HEIGHT, HUNK_HEADER_HEIGHT }

interface VirtualizedDiffContentProps {
  rows: FlatRow[]
  totalHeight: number
  offsets: number[]
  activeFileIndex: number
  activeHunk: HunkAddress | null
  containerRef: React.RefObject<HTMLDivElement | null>
}

export function VirtualizedDiffContent({
  rows,
  totalHeight,
  offsets,
  activeFileIndex,
  activeHunk,
  containerRef
}: VirtualizedDiffContentProps): React.JSX.Element {
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
