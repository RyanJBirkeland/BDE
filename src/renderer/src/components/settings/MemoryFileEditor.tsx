import { useEffect, useMemo, useRef } from 'react'
import { Brain } from 'lucide-react'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import type { MemoryFile } from './useMemoryFiles'

interface MemoryFileEditorProps {
  selectedPath: string | null
  content: string
  savedContent: string
  loadingContent: boolean
  activeFiles: Record<string, boolean>
  files: MemoryFile[]
  onContentChange: (content: string) => void
  onSaveFile: () => void
  onDiscardChanges: () => void
  onToggleActive: (path: string) => void
}

export function MemoryFileEditor({
  selectedPath,
  content,
  savedContent,
  loadingContent,
  activeFiles,
  files,
  onContentChange,
  onSaveFile,
  onDiscardChanges,
  onToggleActive
}: MemoryFileEditorProps): React.JSX.Element {
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const isDirty = content !== savedContent

  const activeCount = Object.keys(activeFiles).length
  const activeTotalBytes = useMemo(
    () => files.filter((f) => activeFiles[f.path]).reduce((sum, f) => sum + f.size, 0),
    [files, activeFiles]
  )

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      // Only intercept Cmd+S when the memory editor textarea is focused
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        if (document.activeElement === editorRef.current) {
          e.preventDefault()
          onSaveFile()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onSaveFile])

  return (
    <div className="memory-editor">
      {loadingContent ? (
        <div className="memory-editor__loading">
          <div className="bde-skeleton memory-editor__skeleton" />
        </div>
      ) : selectedPath ? (
        <>
          <div className="memory-editor__toolbar">
            <span id="memory-file-path-label" className="memory-editor__path">
              memory/{selectedPath}
              {isDirty && <span className="memory-editor__dirty"> &bull;</span>}
            </span>
            {selectedPath && (
              <button
                className={`memory-editor__agent-toggle ${activeFiles[selectedPath] ? 'memory-editor__agent-toggle--active' : ''}`}
                onClick={() => onToggleActive(selectedPath)}
                title={
                  activeFiles[selectedPath]
                    ? 'Remove from agent knowledge'
                    : 'Add to agent knowledge'
                }
              >
                <Brain size={14} />
                <span>
                  {activeFiles[selectedPath] ? 'Agent Knowledge: On' : 'Agent Knowledge: Off'}
                </span>
              </button>
            )}
            <div className="memory-editor__actions">
              <Button variant="ghost" size="sm" onClick={onDiscardChanges} disabled={!isDirty}>
                Discard
              </Button>
              <Button variant="primary" size="sm" onClick={onSaveFile} disabled={!isDirty}>
                Save
              </Button>
            </div>
          </div>
          {activeCount > 0 && (
            <div
              className={`memory-editor__size-banner ${activeTotalBytes > 30720 ? 'memory-editor__size-banner--warn' : ''}`}
            >
              {activeCount} file{activeCount !== 1 ? 's' : ''} active (
              {(activeTotalBytes / 1024).toFixed(1)} KB total)
              {activeTotalBytes > 30720 && ' \u2014 Large memory may slow agent responses'}
            </div>
          )}
          <textarea
            ref={editorRef}
            className="memory-editor__textarea"
            value={content}
            onChange={(e) => onContentChange(e.target.value)}
            spellCheck={false}
            aria-labelledby="memory-file-path-label"
          />
        </>
      ) : (
        <EmptyState title="Select a file to view" />
      )}
    </div>
  )
}
