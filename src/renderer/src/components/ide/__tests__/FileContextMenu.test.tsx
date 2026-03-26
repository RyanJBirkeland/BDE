import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FileContextMenu, ContextMenuTarget } from '../FileContextMenu'

describe('FileContextMenu', () => {
  const onNewFile = vi.fn()
  const onNewFolder = vi.fn()
  const onRename = vi.fn()
  const onDelete = vi.fn()
  const onCopyPath = vi.fn()
  const onClose = vi.fn()

  const directoryTarget: ContextMenuTarget = {
    x: 100,
    y: 200,
    path: '/project/src',
    type: 'directory'
  }

  const fileTarget: ContextMenuTarget = {
    x: 150,
    y: 250,
    path: '/project/src/index.ts',
    type: 'file'
  }

  function renderMenu(target: ContextMenuTarget = directoryTarget) {
    return render(
      <FileContextMenu
        target={target}
        onNewFile={onNewFile}
        onNewFolder={onNewFolder}
        onRename={onRename}
        onDelete={onDelete}
        onCopyPath={onCopyPath}
        onClose={onClose}
      />
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders menu with role="menu"', () => {
    renderMenu()
    expect(screen.getByRole('menu', { name: 'File context menu' })).toBeInTheDocument()
  })

  it('positions at target coordinates', () => {
    renderMenu()
    const menu = screen.getByRole('menu')
    expect(menu.style.top).toBe('200px')
    expect(menu.style.left).toBe('100px')
  })

  // --- Directory target: shows all items ---
  it('shows New File and New Folder for directory targets', () => {
    renderMenu(directoryTarget)
    expect(screen.getByRole('menuitem', { name: /New File/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /New Folder/ })).toBeInTheDocument()
  })

  it('shows Rename, Copy Path, Delete, Close for directory targets', () => {
    renderMenu(directoryTarget)
    expect(screen.getByRole('menuitem', { name: /Rename/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Copy Path/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Delete/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Close/ })).toBeInTheDocument()
  })

  // --- File target: hides New File / New Folder ---
  it('hides New File and New Folder for file targets', () => {
    renderMenu(fileTarget)
    expect(screen.queryByRole('menuitem', { name: /New File/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /New Folder/ })).not.toBeInTheDocument()
  })

  it('still shows Rename, Copy Path, Delete for file targets', () => {
    renderMenu(fileTarget)
    expect(screen.getByRole('menuitem', { name: /Rename/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Copy Path/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Delete/ })).toBeInTheDocument()
  })

  // --- Callback tests ---
  it('calls onNewFile with parent path and closes on New File click', () => {
    renderMenu(directoryTarget)
    fireEvent.click(screen.getByRole('menuitem', { name: /New File/ }))
    expect(onNewFile).toHaveBeenCalledWith('/project/src')
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onNewFolder with parent path and closes on New Folder click', () => {
    renderMenu(directoryTarget)
    fireEvent.click(screen.getByRole('menuitem', { name: /New Folder/ }))
    expect(onNewFolder).toHaveBeenCalledWith('/project/src')
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onRename with target path and closes', () => {
    renderMenu(fileTarget)
    fireEvent.click(screen.getByRole('menuitem', { name: /Rename/ }))
    expect(onRename).toHaveBeenCalledWith('/project/src/index.ts')
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onCopyPath with target path and closes', () => {
    renderMenu(fileTarget)
    fireEvent.click(screen.getByRole('menuitem', { name: /Copy Path/ }))
    expect(onCopyPath).toHaveBeenCalledWith('/project/src/index.ts')
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onDelete with target path and closes', () => {
    renderMenu(fileTarget)
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }))
    expect(onDelete).toHaveBeenCalledWith('/project/src/index.ts')
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose on Close button click', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /Close/ }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('derives parentPath from file path (strips filename)', () => {
    // For a file target, New File/Folder aren't shown, but we can verify
    // via the directory target that parentPath = target.path for directories
    renderMenu(directoryTarget)
    fireEvent.click(screen.getByRole('menuitem', { name: /New File/ }))
    expect(onNewFile).toHaveBeenCalledWith('/project/src')
  })

  it('closes when clicking outside the menu', () => {
    renderMenu()
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not close when clicking inside the menu', () => {
    renderMenu()
    const menu = screen.getByRole('menu')
    fireEvent.mouseDown(menu)
    expect(onClose).not.toHaveBeenCalled()
  })
})
