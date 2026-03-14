import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DiffFile } from '../../lib/diff-parser'
import { useUIStore } from '../../stores/ui'
import { EmptyState } from '../ui/EmptyState'

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
        <span className="diff-sidebar__count">{files.length}</span>
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

function DiffViewer({ files }: { files: DiffFile[] }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const hunkRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [activeFileIndex, setActiveFileIndex] = useState(-1)
  const [activeHunk, setActiveHunk] = useState<HunkAddress | null>(null)
  const activeView = useUIStore((s) => s.activeView)

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

  const scrollToFile = useCallback((index: number): void => {
    if (index < 0 || index >= files.length) return
    setActiveFileIndex(index)
    const el = fileRefs.current.get(files[index].path)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [files])

  const scrollToHunk = useCallback((addr: HunkAddress): void => {
    setActiveHunk(addr)
    setActiveFileIndex(addr.fileIndex)
    const key = `${addr.fileIndex}-${addr.hunkIndex}`
    const el = hunkRefs.current.get(key)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

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
      </div>
    </div>
  )
}

export default DiffViewer
