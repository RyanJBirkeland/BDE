import { useEffect, useRef } from 'react'
import { FilePlus, FolderPlus, Edit2, Trash2, Copy, X } from 'lucide-react'

export interface ContextMenuTarget {
  x: number; y: number; path: string; type: 'file' | 'directory'
}

export interface FileContextMenuProps {
  target: ContextMenuTarget
  onNewFile: (parentPath: string) => void
  onNewFolder: (parentPath: string) => void
  onRename: (path: string) => void
  onDelete: (path: string) => void
  onCopyPath: (path: string) => void
  onClose: () => void
}

export function FileContextMenu({ target, onNewFile, onNewFolder, onRename, onDelete, onCopyPath, onClose }: FileContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleMouseDown(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [onClose])

  const parentPath = target.type === 'directory' ? target.path : target.path.substring(0, target.path.lastIndexOf('/'))

  return (
    <div ref={menuRef} className="ide-context-menu" role="menu" aria-label="File context menu"
      style={{ top: target.y, left: target.x }}>
      {target.type === 'directory' && (<>
        <button className="ide-context-menu__item" role="menuitem" onClick={() => { onNewFile(parentPath); onClose() }}>
          <FilePlus size={14} /> New File
        </button>
        <button className="ide-context-menu__item" role="menuitem" onClick={() => { onNewFolder(parentPath); onClose() }}>
          <FolderPlus size={14} /> New Folder
        </button>
        <div className="ide-context-menu__separator" role="separator" />
      </>)}
      <button className="ide-context-menu__item" role="menuitem" onClick={() => { onRename(target.path); onClose() }}>
        <Edit2 size={14} /> Rename
      </button>
      <button className="ide-context-menu__item" role="menuitem" onClick={() => { onCopyPath(target.path); onClose() }}>
        <Copy size={14} /> Copy Path
      </button>
      <div className="ide-context-menu__separator" role="separator" />
      <button className="ide-context-menu__item ide-context-menu__item--danger" role="menuitem" onClick={() => { onDelete(target.path); onClose() }}>
        <Trash2 size={14} /> Delete
      </button>
      <div className="ide-context-menu__separator" role="separator" />
      <button className="ide-context-menu__item" role="menuitem" onClick={onClose}>
        <X size={14} /> Close
      </button>
    </div>
  )
}
