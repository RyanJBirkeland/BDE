import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockSetRootPath = vi.fn()
const mockWatchDir = vi.fn()
let mockRecentFolders: string[] = []

Object.defineProperty(window, 'api', {
  value: { watchDir: mockWatchDir },
  writable: true,
  configurable: true
})

vi.mock('../../../stores/ide', () => ({
  useIDEStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      recentFolders: mockRecentFolders,
      setRootPath: mockSetRootPath
    })
  )
}))

import { IDEEmptyState } from '../IDEEmptyState'

describe('IDEEmptyState', () => {
  const onOpenFolder = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockRecentFolders = []
  })

  it('renders title and subtitle', () => {
    render(<IDEEmptyState onOpenFolder={onOpenFolder} />)
    expect(screen.getByText('BDE IDE')).toBeInTheDocument()
    expect(screen.getByText('Open a folder to start editing')).toBeInTheDocument()
  })

  it('renders Open Folder button', () => {
    render(<IDEEmptyState onOpenFolder={onOpenFolder} />)
    expect(screen.getByRole('button', { name: /Open Folder/ })).toBeInTheDocument()
  })

  it('calls onOpenFolder when button is clicked', () => {
    render(<IDEEmptyState onOpenFolder={onOpenFolder} />)
    fireEvent.click(screen.getByRole('button', { name: /Open Folder/ }))
    expect(onOpenFolder).toHaveBeenCalledOnce()
  })

  it('does not render recent section when recentFolders is empty', () => {
    mockRecentFolders = []
    render(<IDEEmptyState onOpenFolder={onOpenFolder} />)
    expect(screen.queryByText('Recent')).not.toBeInTheDocument()
  })

  it('renders recent folders when available', () => {
    mockRecentFolders = ['/home/user/project-a', '/home/user/project-b']
    render(<IDEEmptyState onOpenFolder={onOpenFolder} />)
    expect(screen.getByText('Recent')).toBeInTheDocument()
    expect(screen.getByText('/home/user/project-a')).toBeInTheDocument()
    expect(screen.getByText('/home/user/project-b')).toBeInTheDocument()
  })

  it('clicking a recent folder calls setRootPath and watchDir', async () => {
    mockRecentFolders = ['/home/user/my-project']
    mockWatchDir.mockResolvedValue(undefined)
    render(<IDEEmptyState onOpenFolder={onOpenFolder} />)

    fireEvent.click(screen.getByText('/home/user/my-project'))

    expect(mockSetRootPath).toHaveBeenCalledWith('/home/user/my-project')
    await waitFor(() => {
      expect(mockWatchDir).toHaveBeenCalledWith('/home/user/my-project')
    })
  })

  it('recent folder buttons have title attribute with full path', () => {
    mockRecentFolders = ['/a/long/path/to/project']
    render(<IDEEmptyState onOpenFolder={onOpenFolder} />)
    const btn = screen.getByText('/a/long/path/to/project')
    expect(btn).toHaveAttribute('title', '/a/long/path/to/project')
  })
})
