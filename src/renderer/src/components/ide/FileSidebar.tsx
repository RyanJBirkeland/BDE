import { useState } from 'react'
import { FolderOpen, PanelLeftClose } from 'lucide-react'
import { useIDEStore } from '../../stores/ide'
import { FileTree } from './FileTree'
import { FileContextMenu, ContextMenuTarget } from './FileContextMenu'

export interface FileSidebarProps {
  onOpenFile: (filePath: string) => void
}

export function FileSidebar({ onOpenFile }: FileSidebarProps): React.JSX.Element {
  const rootPath = useIDEStore((s) => s.rootPath)
  const setRootPath = useIDEStore((s) => s.setRootPath)
  const toggleSidebar = useIDEStore((s) => s.toggleSidebar)
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null)

  async function handleOpenFolder(): Promise<void> {
    const dir = await window.api.openDirectoryDialog()
    if (dir) {
      setRootPath(dir)
      await window.api.watchDir(dir)
    }
  }

  async function handleNewFile(parentPath: string): Promise<void> {
    const name = window.prompt('New file name:')
    if (!name) return
    await window.api.createFile(`${parentPath}/${name}`)
  }

  async function handleNewFolder(parentPath: string): Promise<void> {
    const name = window.prompt('New folder name:')
    if (!name) return
    await window.api.createDir(`${parentPath}/${name}`)
  }

  async function handleRename(path: string): Promise<void> {
    const parts = path.split('/')
    const oldName = parts[parts.length - 1]
    const newName = window.prompt('Rename to:', oldName)
    if (!newName || newName === oldName) return
    await window.api.rename(path, [...parts.slice(0, -1), newName].join('/'))
  }

  async function handleDelete(path: string): Promise<void> {
    const name = path.split('/').pop() ?? path
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return
    await window.api.deletePath(path)
  }

  function handleCopyPath(path: string): void {
    void navigator.clipboard.writeText(path)
  }

  return (
    <div className="ide-sidebar" onContextMenu={(e) => e.preventDefault()}>
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
          <div
            style={{
              padding: '12px 8px',
              fontSize: 'var(--bde-size-sm)',
              color: 'var(--bde-text-dim)'
            }}
          >
            No folder open
          </div>
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
    </div>
  )
}
