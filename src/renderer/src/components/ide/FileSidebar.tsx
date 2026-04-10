import { useCallback, useState } from 'react'
import { FolderOpen, PanelLeftClose } from 'lucide-react'
import { useIDEStore } from '../../stores/ide'
import { toast } from '../../stores/toasts'
import { FileTree } from './FileTree'
import './FileSidebar.css'
import { FileContextMenu, ContextMenuTarget } from './FileContextMenu'
import { ConfirmModal, useConfirm } from '../ui/ConfirmModal'
import { PromptModal, usePrompt } from '../ui/PromptModal'

export interface FileSidebarProps {
  onOpenFile: (filePath: string) => void
}

export function FileSidebar({ onOpenFile }: FileSidebarProps): React.JSX.Element {
  const rootPath = useIDEStore((s) => s.rootPath)
  const setRootPath = useIDEStore((s) => s.setRootPath)
  const toggleSidebar = useIDEStore((s) => s.toggleSidebar)
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null)
  const { confirm, confirmProps } = useConfirm()
  const { prompt, promptProps } = usePrompt()

  async function handleOpenFolder(): Promise<void> {
    const dir = await window.api.openDirectoryDialog()
    if (dir) {
      setRootPath(dir)
      await window.api.watchDir(dir)
    }
  }

  // IDE-4: Sanitize filename to prevent path traversal
  function sanitizeFilename(name: string): string | null {
    if (!name || name.trim() === '') return null
    const trimmed = name.trim()
    // Block path traversal sequences
    if (trimmed.includes('/') || trimmed.includes('\\') || trimmed === '.' || trimmed === '..') {
      return null
    }
    // Block null bytes and other control characters
    // eslint-disable-next-line no-control-regex -- intentional control character detection
    if (/[\x00-\x1f\x7f]/.test(trimmed)) {
      return null
    }
    return trimmed
  }

  async function handleNewFile(parentPath: string): Promise<void> {
    const name = await prompt({ message: 'New file name:', placeholder: 'filename.txt' })
    if (!name) return
    const sanitized = sanitizeFilename(name)
    if (!sanitized) {
      toast.error('Invalid filename: cannot contain path separators or special characters')
      return
    }
    try {
      await window.api.createFile(`${parentPath}/${sanitized}`)
    } catch (err) {
      toast.error(`Failed to create file: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  async function handleNewFolder(parentPath: string): Promise<void> {
    const name = await prompt({ message: 'New folder name:', placeholder: 'folder' })
    if (!name) return
    const sanitized = sanitizeFilename(name)
    if (!sanitized) {
      toast.error('Invalid folder name: cannot contain path separators or special characters')
      return
    }
    try {
      await window.api.createDir(`${parentPath}/${sanitized}`)
    } catch (err) {
      toast.error(
        `Failed to create folder: ${err instanceof Error ? err.message : 'Unknown error'}`
      )
    }
  }

  async function handleRename(path: string): Promise<void> {
    const parts = path.split('/')
    const oldName = parts[parts.length - 1]
    const newName = await prompt({
      message: 'Rename to:',
      defaultValue: oldName,
      placeholder: oldName
    })
    if (!newName || newName === oldName) return
    const sanitized = sanitizeFilename(newName)
    if (!sanitized) {
      toast.error('Invalid filename: cannot contain path separators or special characters')
      return
    }
    try {
      await window.api.rename(path, [...parts.slice(0, -1), sanitized].join('/'))
    } catch (err) {
      toast.error(`Rename failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  async function handleDelete(path: string): Promise<void> {
    const name = path.split('/').pop() ?? path
    const confirmed = await confirm({
      message: `Move "${name}" to Trash?`,
      variant: 'danger'
    })
    if (!confirmed) return
    try {
      await window.api.deletePath(path)
    } catch (err) {
      toast.error(`Delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  function handleCopyPath(path: string): void {
    navigator.clipboard
      .writeText(path)
      .then(() => toast.success('Path copied to clipboard'))
      .catch((err) =>
        toast.error(`Failed to copy: ${err instanceof Error ? err.message : 'Unknown error'}`)
      )
  }

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    let el = e.target as HTMLElement | null
    while (el && !el.dataset.path) {
      if (el.classList.contains('ide-sidebar')) break
      el = el.parentElement
    }
    if (!el?.dataset.path) return
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      path: el.dataset.path,
      type: el.dataset.type === 'folder' ? 'directory' : 'file'
    })
  }, [])

  return (
    <div className="ide-sidebar" onContextMenu={handleContextMenu}>
      <div className="ide-sidebar__header">
        <span className="ide-sidebar__title">EXPLORER</span>
        <div className="ide-sidebar__actions">
          <button
            className="ide-sidebar__action-btn"
            onClick={() => void handleOpenFolder()}
            title="Open Folder"
            aria-label="Open Folder"
          >
            <FolderOpen size={14} />
          </button>
          <button
            className="ide-sidebar__action-btn"
            onClick={toggleSidebar}
            title="Close Sidebar"
            aria-label="Close Sidebar"
          >
            <PanelLeftClose size={14} />
          </button>
        </div>
      </div>
      {rootPath && <div className="ide-sidebar__folder-name">{rootPath.split('/').pop()}</div>}
      <div className="ide-sidebar__body">
        {rootPath ? (
          <FileTree dirPath={rootPath} onOpenFile={onOpenFile} />
        ) : (
          <div className="ide-sidebar__empty">No folder open</div>
        )}
      </div>
      {contextMenu && (
        <FileContextMenu
          target={contextMenu}
          onNewFile={(p) => void handleNewFile(p)}
          onNewFolder={(p) => void handleNewFolder(p)}
          onRename={(p) => void handleRename(p)}
          onDelete={(p) => void handleDelete(p)}
          onCopyPath={handleCopyPath}
          onClose={() => setContextMenu(null)}
        />
      )}
      <ConfirmModal {...confirmProps} />
      <PromptModal {...promptProps} />
    </div>
  )
}
