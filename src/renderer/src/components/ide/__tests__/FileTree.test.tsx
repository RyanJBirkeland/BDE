import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { FileTree } from '../FileTree'

const mockReadDir = vi.fn()
const mockOnDirChanged = vi.fn(() => vi.fn())

// Mock window.api without replacing the full window object
Object.defineProperty(window, 'api', {
  value: { readDir: mockReadDir, onDirChanged: mockOnDirChanged },
  writable: true,
  configurable: true
})

vi.mock('../../../stores/ide', () => ({
  useIDEStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ expandedDirs: {}, toggleDir: vi.fn(), activeTabId: null, openTabs: [] })
  )
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockReadDir.mockResolvedValue([
    { name: 'src', type: 'directory', size: 0 },
    { name: 'index.ts', type: 'file', size: 100 }
  ])
  mockOnDirChanged.mockReturnValue(vi.fn())
})

describe('FileTree', () => {
  it('renders file tree with entries', async () => {
    render(<FileTree dirPath="/project" onOpenFile={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument()
      expect(screen.getByText('index.ts')).toBeInTheDocument()
    })
  })
  it('filters hidden dirs like node_modules', async () => {
    mockReadDir.mockResolvedValue([
      { name: 'node_modules', type: 'directory', size: 0 },
      { name: 'src', type: 'directory', size: 0 }
    ])
    render(<FileTree dirPath="/project" onOpenFile={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument()
      expect(screen.queryByText('node_modules')).not.toBeInTheDocument()
    })
  })
  it('has tree role', async () => {
    render(<FileTree dirPath="/project" onOpenFile={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByRole('tree', { name: 'File explorer' })).toBeInTheDocument()
    })
  })
  it('shows error on read failure', async () => {
    mockReadDir.mockRejectedValue(new Error('ENOENT'))
    render(<FileTree dirPath="/bad/path" onOpenFile={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('Failed to read directory')).toBeInTheDocument()
    })
  })
})
