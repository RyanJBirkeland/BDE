import { useRef } from 'react'
import type { DiffFile } from '../../lib/diff-parser'

function FileList({
  files,
  activeFile,
  onSelect
}: {
  files: DiffFile[]
  activeFile: string | null
  onSelect: (path: string) => void
}): React.JSX.Element {
  return (
    <div className="diff-sidebar">
      <div className="diff-sidebar__header">
        <span className="diff-sidebar__title">Files</span>
        <span className="diff-sidebar__count">{files.length}</span>
      </div>
      <div className="diff-sidebar__list">
        {files.map((f) => (
          <button
            key={f.path}
            className={`diff-file-item ${activeFile === f.path ? 'diff-file-item--active' : ''}`}
            onClick={() => onSelect(f.path)}
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

function DiffViewer({ files }: { files: DiffFile[] }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const activeFile = null as string | null

  const scrollToFile = (path: string): void => {
    const el = fileRefs.current.get(path)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  if (files.length === 0) {
    return (
      <div className="diff-view-container">
        <div className="diff-empty">No changes vs origin/main</div>
      </div>
    )
  }

  return (
    <div className="diff-view-container">
      <FileList files={files} activeFile={activeFile} onSelect={scrollToFile} />
      <div className="diff-content" ref={containerRef}>
        {files.map((file) => (
          <div
            key={file.path}
            className="diff-file"
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
              <div key={hi} className="diff-hunk">
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
