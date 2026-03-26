import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Mocks must be declared before component import
const mockOpenDirectoryDialog = vi.fn()
const mockWatchDir = vi.fn()

Object.defineProperty(window, 'api', {
  value: {
    openDirectoryDialog: mockOpenDirectoryDialog,
    watchDir: mockWatchDir,
    readDir: vi.fn().mockResolvedValue([]),
    onDirChanged: vi.fn(() => vi.fn()),
    createFile: vi.fn(),
    createDir: vi.fn(),
    rename: vi.fn(),
    deletePath: vi.fn()
  },
  writable: true,
  configurable: true
})

const mockToggleSidebar = vi.fn()
const mockSetRootPath = vi.fn()
let mockRootPath: string | null = null

vi.mock('../../../stores/ide', () => ({
  useIDEStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      rootPath: mockRootPath,
      setRootPath: mockSetRootPath,
      toggleSidebar: mockToggleSidebar,
      expandedDirs: {},
      toggleDir: vi.fn(),
      activeTabId: null,
      openTabs: []
    })
  )
}))

import { FileSidebar } from '../FileSidebar'

describe('FileSidebar', () => {
  const onOpenFile = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockRootPath = null
  })

  it('renders EXPLORER header', () => {
    render(<FileSidebar onOpenFile={onOpenFile} />)
    expect(screen.getByText('EXPLORER')).toBeInTheDocument()
  })

  it('renders Open Folder and Close Sidebar buttons', () => {
    render(<FileSidebar onOpenFile={onOpenFile} />)
    expect(screen.getByRole('button', { name: 'Open Folder' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close Sidebar' })).toBeInTheDocument()
  })

  it('shows "No folder open" when rootPath is null', () => {
    mockRootPath = null
    render(<FileSidebar onOpenFile={onOpenFile} />)
    expect(screen.getByText('No folder open')).toBeInTheDocument()
  })

  it('renders FileTree when rootPath is set', () => {
    mockRootPath = '/home/user/project'
    render(<FileSidebar onOpenFile={onOpenFile} />)
    // The folder name should be displayed
    expect(screen.getByText('project')).toBeInTheDocument()
    // "No folder open" should not appear
    expect(screen.queryByText('No folder open')).not.toBeInTheDocument()
  })

  it('calls toggleSidebar when Close Sidebar button clicked', () => {
    render(<FileSidebar onOpenFile={onOpenFile} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close Sidebar' }))
    expect(mockToggleSidebar).toHaveBeenCalledOnce()
  })

  it('calls openDirectoryDialog and setRootPath on Open Folder click', async () => {
    mockOpenDirectoryDialog.mockResolvedValue('/new/path')
    render(<FileSidebar onOpenFile={onOpenFile} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Folder' }))
    await waitFor(() => {
      expect(mockOpenDirectoryDialog).toHaveBeenCalledOnce()
      expect(mockSetRootPath).toHaveBeenCalledWith('/new/path')
      expect(mockWatchDir).toHaveBeenCalledWith('/new/path')
    })
  })

  it('does not set rootPath when dialog returns null', async () => {
    mockOpenDirectoryDialog.mockResolvedValue(null)
    render(<FileSidebar onOpenFile={onOpenFile} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Folder' }))
    await waitFor(() => {
      expect(mockOpenDirectoryDialog).toHaveBeenCalledOnce()
    })
    expect(mockSetRootPath).not.toHaveBeenCalled()
    expect(mockWatchDir).not.toHaveBeenCalled()
  })

  it('prevents default context menu on the sidebar', () => {
    render(<FileSidebar onOpenFile={onOpenFile} />)
    const sidebar = screen.getByText('EXPLORER').closest('.ide-sidebar')!
    const event = new MouseEvent('contextmenu', { bubbles: true })
    const preventSpy = vi.spyOn(event, 'preventDefault')
    sidebar.dispatchEvent(event)
    expect(preventSpy).toHaveBeenCalled()
  })
})
