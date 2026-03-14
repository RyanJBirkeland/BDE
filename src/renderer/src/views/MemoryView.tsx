import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '../stores/toasts'

interface MemoryFile {
  path: string
  name: string
  size: number
  modifiedAt: number
}

interface FileGroup {
  label: string
  files: MemoryFile[]
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)}KB`
  return `${(kb / 1024).toFixed(1)}MB`
}

function groupFiles(files: MemoryFile[]): { pinned: MemoryFile | null; groups: FileGroup[] } {
  let pinned: MemoryFile | null = null
  const dateFiles: MemoryFile[] = []
  const projectFiles: MemoryFile[] = []
  const otherFiles: MemoryFile[] = []

  for (const f of files) {
    if (f.path === 'MEMORY.md') {
      pinned = f
    } else if (/^\d{4}-\d{2}-\d{2}\.md$/.test(f.name)) {
      dateFiles.push(f)
    } else if (f.path.startsWith('projects/')) {
      projectFiles.push(f)
    } else {
      otherFiles.push(f)
    }
  }

  const groups: FileGroup[] = []
  if (dateFiles.length > 0) groups.push({ label: 'Daily Logs', files: dateFiles })
  if (projectFiles.length > 0) groups.push({ label: 'Projects', files: projectFiles })
  if (otherFiles.length > 0) groups.push({ label: 'Other', files: otherFiles })

  return { pinned, groups }
}

export default function MemoryView(): React.JSX.Element {
  const [files, setFiles] = useState<MemoryFile[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [newFilePrompt, setNewFilePrompt] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const editorRef = useRef<HTMLTextAreaElement>(null)

  const loadFiles = useCallback(async () => {
    const result = await window.api.listMemoryFiles()
    setFiles(result)
  }, [])

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  const openFile = useCallback(async (path: string) => {
    const text = await window.api.readMemoryFile(path)
    setSelectedPath(path)
    setContent(text)
    setSavedContent(text)
  }, [])

  const saveFile = useCallback(async () => {
    if (!selectedPath) return
    try {
      await window.api.writeMemoryFile(selectedPath, content)
      setSavedContent(content)
      toast.success('File saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save file')
    }
  }, [selectedPath, content])

  const discard = useCallback(() => {
    setContent(savedContent)
  }, [savedContent])

  const createFile = useCallback(async () => {
    const name = newFileName.trim()
    if (!name) return
    const path = name.endsWith('.md') ? name : `${name}.md`
    await window.api.writeMemoryFile(path, '')
    setNewFilePrompt(false)
    setNewFileName('')
    await loadFiles()
    await openFile(path)
  }, [newFileName, loadFiles, openFile])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        saveFile()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saveFile])

  const isDirty = content !== savedContent
  const { pinned, groups } = groupFiles(files)

  return (
    <div className="memory-view">
      <div className="memory-sidebar">
        <div className="memory-sidebar__header">
          <span className="memory-sidebar__title">Memory</span>
          <span className="memory-sidebar__count">{files.length}</span>
          <div className="memory-sidebar__actions">
            <button
              className="memory-sidebar__btn"
              onClick={() => setNewFilePrompt(true)}
              title="New file"
            >
              +
            </button>
            <button className="memory-sidebar__btn" onClick={loadFiles} title="Refresh">
              &#x21bb;
            </button>
          </div>
        </div>

        {newFilePrompt && (
          <div className="memory-sidebar__new-file">
            <input
              className="memory-sidebar__new-input"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createFile()
                if (e.key === 'Escape') {
                  setNewFilePrompt(false)
                  setNewFileName('')
                }
              }}
              placeholder="filename.md"
              autoFocus
            />
          </div>
        )}

        <div className="memory-sidebar__list">
          {pinned && (
            <button
              className={`memory-file ${selectedPath === pinned.path ? 'memory-file--active' : ''}`}
              onClick={() => openFile(pinned.path)}
            >
              <span className="memory-file__name">
                <span className="memory-file__pin">{'\uD83D\uDCCC'}</span> {pinned.name}
              </span>
              <span className="memory-file__meta">
                {formatRelativeTime(pinned.modifiedAt)} &middot; {formatSize(pinned.size)}
              </span>
            </button>
          )}

          {groups.map((group) => (
            <div key={group.label} className="memory-group">
              <div className="memory-group__label">{group.label}</div>
              {group.files.map((f) => (
                <button
                  key={f.path}
                  className={`memory-file ${selectedPath === f.path ? 'memory-file--active' : ''}`}
                  onClick={() => openFile(f.path)}
                >
                  <span className="memory-file__name">{f.name}</span>
                  <span className="memory-file__meta">
                    {formatRelativeTime(f.modifiedAt)} &middot; {formatSize(f.size)}
                  </span>
                </button>
              ))}
            </div>
          ))}

          {files.length === 0 && (
            <div className="memory-sidebar__empty">No memory files found</div>
          )}
        </div>
      </div>

      <div className="memory-editor">
        {selectedPath ? (
          <>
            <div className="memory-editor__toolbar">
              <span className="memory-editor__path">
                memory/{selectedPath}
                {isDirty && <span className="memory-editor__dirty"> &bull;</span>}
              </span>
              <div className="memory-editor__actions">
                <button
                  className="memory-editor__btn memory-editor__btn--discard"
                  onClick={discard}
                  disabled={!isDirty}
                >
                  Discard
                </button>
                <button
                  className="memory-editor__btn memory-editor__btn--save"
                  onClick={saveFile}
                  disabled={!isDirty}
                >
                  Save
                </button>
              </div>
            </div>
            <textarea
              ref={editorRef}
              className="memory-editor__textarea"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
            />
          </>
        ) : (
          <div className="memory-editor__empty">Select a file to view</div>
        )}
      </div>
    </div>
  )
}
