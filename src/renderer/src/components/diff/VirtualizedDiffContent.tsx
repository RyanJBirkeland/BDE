import React, { useEffect, useMemo, useState } from 'react'

import {
  ROW_HEIGHT,
  FILE_HEADER_HEIGHT,
  HUNK_HEADER_HEIGHT,
  COMMENT_ROW_HEIGHT,
  rowHeight
} from './virtualized-diff-utils'
import type { FlatRow, HunkAddress } from './virtualized-diff-utils'
import { DiffCommentWidget } from './DiffCommentWidget'

const OVERSCAN = 20

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
      const midOffset = offsets[mid] ?? 0
      const midRow = rows[mid]
      if (midRow && midOffset + rowHeight(midRow) <= scrollTop) {
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
    while (i < rows.length && (offsets[i] ?? 0) < bottom) i++
    return Math.min(i, rows.length)
  }, [offsets, rows, scrollTop, viewportHeight, startIdx])

  const visibleRows = rows.slice(startIdx, endIdx)
  const offsetTop = startIdx < offsets.length ? (offsets[startIdx] ?? 0) : 0

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
          if (row.kind === 'comment') {
            return (
              <div
                key={`comment-${row.filePath}-${row.lineNum}`}
                style={{ minHeight: COMMENT_ROW_HEIGHT }}
              >
                {row.comments.length > 0 && <DiffCommentWidget comments={row.comments} />}
                {row.pendingComments.map((pc) => (
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
                      </div>
                    </div>
                  </div>
                ))}
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
