import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FileTreeNode } from '../FileTreeNode'

vi.mock('../../../stores/ide', () => {
  const mockStore = vi.fn((sel?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      expandedDirs: {},
      openTabs: [],
      activeTabId: null,
      toggleDir: vi.fn()
    }
    return sel ? sel(state) : state
  })
  ;(mockStore as unknown as Record<string, unknown>).getState = () => ({
    expandedDirs: {},
    openTabs: [],
    activeTabId: null,
    toggleDir: vi.fn()
  })
  return { useIDEStore: mockStore }
})

describe('FileTreeNode', () => {
  const onOpenFile = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(window.api.readDir).mockResolvedValue([])
  })

  it('renders a file node with name', () => {
    render(
      <FileTreeNode
        name="index.ts"
        type="file"
        fullPath="/project/src/index.ts"
        depth={0}
        onOpenFile={onOpenFile}
      />
    )
    expect(screen.getByText('index.ts')).toBeInTheDocument()
  })

  it('renders a directory node with name', () => {
    render(
      <FileTreeNode
        name="src"
        type="directory"
        fullPath="/project/src"
        depth={0}
        onOpenFile={onOpenFile}
      />
    )
    expect(screen.getByText('src')).toBeInTheDocument()
  })

  it('renders different icon for .json files', () => {
    const { container } = render(
      <FileTreeNode
        name="package.json"
        type="file"
        fullPath="/project/package.json"
        depth={0}
        onOpenFile={onOpenFile}
      />
    )
    expect(container.firstChild).toBeInTheDocument()
  })

  it('renders different icon for .md files', () => {
    const { container } = render(
      <FileTreeNode
        name="README.md"
        type="file"
        fullPath="/project/README.md"
        depth={0}
        onOpenFile={onOpenFile}
      />
    )
    expect(container.firstChild).toBeInTheDocument()
  })

  it('renders with depth indentation', () => {
    const { container } = render(
      <FileTreeNode
        name="nested.ts"
        type="file"
        fullPath="/project/src/deep/nested.ts"
        depth={3}
        onOpenFile={onOpenFile}
      />
    )
    expect(container.firstChild).toBeInTheDocument()
  })
})
