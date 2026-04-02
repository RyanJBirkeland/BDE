import { useEffect, useRef, useState } from 'react'
import { FilePlus, FolderPlus, Edit2, Trash2, Copy, X } from 'lucide-react'

export interface ContextMenuTarget {
  x: number
  y: number
  path: string
  type: 'file' | 'directory'
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

export function FileContextMenu({
  target,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onCopyPath,
  onClose
}: FileContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: target.y, left: target.x })

  useEffect(() => {
    function handleMouseDown(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  // Focus first menu item on mount for keyboard navigation
  useEffect(() => {
    const firstButton = menuRef.current?.querySelector('button')
    firstButton?.focus()
  }, [])

  // Adjust position to keep menu on screen
  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    let { top, left } = { top: target.y, left: target.x }

    // Adjust horizontal position if off-screen
    if (left + rect.width > window.innerWidth) {
      left = window.innerWidth - rect.width - 8
    }
    if (left < 0) left = 8

    // Adjust vertical position if off-screen
    if (top + rect.height > window.innerHeight) {
      top = window.innerHeight - rect.height - 8
    }
    if (top < 0) top = 8

    setPosition({ top, left })
  }, [target.x, target.y])

  const parentPath =
    target.type === 'directory'
      ? target.path
      : target.path.substring(0, target.path.lastIndexOf('/'))

  return (
    <div
      ref={menuRef}
      className="ide-context-menu"
      role="menu"
      aria-label="File context menu"
      style={{ top: position.top, left: position.left }}
    >
      {target.type === 'directory' && (
        <>
          <button
            className="ide-context-menu__item"
            role="menuitem"
            onClick={() => {
              onNewFile(parentPath)
              onClose()
            }}
          >
            <FilePlus size={14} /> New File
          </button>
          <button
            className="ide-context-menu__item"
            role="menuitem"
            onClick={() => {
              onNewFolder(parentPath)
              onClose()
            }}
          >
            <FolderPlus size={14} /> New Folder
          </button>
          <div className="ide-context-menu__separator" role="separator" />
        </>
      )}
      <button
        className="ide-context-menu__item"
        role="menuitem"
        onClick={() => {
          onRename(target.path)
          onClose()
        }}
      >
        <Edit2 size={14} /> Rename
      </button>
      <button
        className="ide-context-menu__item"
        role="menuitem"
        onClick={() => {
          onCopyPath(target.path)
          onClose()
        }}
      >
        <Copy size={14} /> Copy Path
      </button>
      <div className="ide-context-menu__separator" role="separator" />
      <button
        className="ide-context-menu__item ide-context-menu__item--danger"
        role="menuitem"
        onClick={() => {
          onDelete(target.path)
          onClose()
        }}
      >
        <Trash2 size={14} /> Delete
      </button>
      <div className="ide-context-menu__separator" role="separator" />
      <button className="ide-context-menu__item" role="menuitem" onClick={onClose}>
        <X size={14} /> Close
      </button>
    </div>
  )
}
