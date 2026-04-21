import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './DiffViewer.css'
import type { DiffFile } from '../../lib/diff-parser'
import { countDiffLines } from '../../lib/diff-parser'
import { usePanelLayoutStore } from '../../stores/panelLayout'
import { useDiffSelection } from '../../hooks/useDiffSelection'
import { EmptyState } from '../ui/EmptyState'
import { DIFF_VIRTUALIZE_THRESHOLD } from '../../lib/constants'
import type { PrComment } from '../../../../shared/types'
import type { PendingComment } from '../../stores/pendingReview'
import { PlainDiffContent } from './PlainDiffContent'
import { VirtualizedDiffContent } from './VirtualizedDiffContent'
import { VirtualizedDiffBanner } from './VirtualizedDiffBanner'
import type { FlatRow, HunkAddress } from './virtualized-diff-utils'
import {
  rowHeight,
  ROW_HEIGHT,
  FILE_HEADER_HEIGHT,
  HUNK_HEADER_HEIGHT
} from './virtualized-diff-utils'

export interface LineRange {
  file: string
  startLine: number
  endLine: number
  side: 'LEFT' | 'RIGHT'
}

interface DiffViewerProps {
  files: DiffFile[]
  comments?: PrComment[] | undefined
  pendingComments?: PendingComment[] | undefined
  selectedRange?: LineRange | null | undefined
  onSelectRange?: ((range: LineRange | null) => void) | undefined
  onAddComment?: ((range: LineRange, body: string) => void) | undefined
  onRemovePendingComment?: ((commentId: string) => void) | undefined
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
      const file = files[fi]
      if (!file) continue
      fiToRow.set(fi, rows.length)
      rows.push({ kind: 'file-header', file, fileIndex: fi })
      height += FILE_HEADER_HEIGHT

      for (let hi = 0; hi < file.hunks.length; hi++) {
        const hunk = file.hunks[hi]
        if (!hunk) continue
        haToRow.set(`${fi}-${hi}`, rows.length)
        rows.push({
          kind: 'hunk-header',
          header: hunk.header,
          fileIndex: fi,
          hunkIndex: hi
        })
        height += HUNK_HEADER_HEIGHT

        for (let li = 0; li < hunk.lines.length; li++) {
          const line = hunk.lines[li]
          if (!line) continue
          rows.push({ kind: 'line', line, lineIndex: li })
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
      const row = flatRows[i]
      if (row) cumulative += rowHeight(row)
    }
    return arr
  }, [flatRows, useVirtualization])

  const scrollToFile = useCallback(
    (index: number): void => {
      if (index < 0 || index >= files.length) return
      setActiveFileIndex(index)

      if (useVirtualization) {
        const rowIdx = fileIndexToRow.get(index)
        const offset = rowIdx !== undefined ? flatOffsets[rowIdx] : undefined
        if (offset !== undefined && containerRef.current) {
          containerRef.current.scrollTop = offset
        }
      } else {
        const target = files[index]
        const el = target ? fileRefs.current.get(target.path) : undefined
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
        const offset = rowIdx !== undefined ? flatOffsets[rowIdx] : undefined
        if (offset !== undefined && containerRef.current) {
          containerRef.current.scrollTop = offset
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
        const nextHunk = allHunks[nextIdx]
        if (nextHunk) scrollToHunk(nextHunk)
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
    </div>
  )
}

export { DiffViewer }
