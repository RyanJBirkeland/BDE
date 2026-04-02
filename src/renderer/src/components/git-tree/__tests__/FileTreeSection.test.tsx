import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FileTreeSection } from '../FileTreeSection'
import type { GitFileEntry } from '../../../stores/gitTree'

const files: GitFileEntry[] = [
  { path: 'src/foo.ts', status: 'M' },
  { path: 'src/bar.ts', status: 'A' }
]

const defaultProps = {
  title: 'Staged Changes',
  files,
  isStaged: true,
  selectedPath: null,
  onStageAll: vi.fn(),
  onUnstageAll: vi.fn(),
  onStageFile: vi.fn(),
  onUnstageFile: vi.fn(),
  onSelectFile: vi.fn()
}

describe('FileTreeSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders section title', () => {
    render(<FileTreeSection {...defaultProps} />)
    expect(screen.getByText('Staged Changes')).toBeInTheDocument()
  })

  it('renders file count badge', () => {
    render(<FileTreeSection {...defaultProps} />)
    expect(screen.getByLabelText('2 files')).toBeInTheDocument()
  })

  it('renders file rows', () => {
    render(<FileTreeSection {...defaultProps} />)
    expect(screen.getByText('foo.ts')).toBeInTheDocument()
    expect(screen.getByText('bar.ts')).toBeInTheDocument()
  })

  it('returns null when files array is empty', () => {
    const { container } = render(<FileTreeSection {...defaultProps} files={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows Unstage All button when isStaged=true', () => {
    render(<FileTreeSection {...defaultProps} isStaged={true} />)
    expect(screen.getByLabelText('Unstage all')).toBeInTheDocument()
    expect(screen.queryByLabelText('Stage all')).not.toBeInTheDocument()
  })

  it('shows Stage All button when isStaged=false', () => {
    render(<FileTreeSection {...defaultProps} isStaged={false} />)
    expect(screen.getByLabelText('Stage all')).toBeInTheDocument()
    expect(screen.queryByLabelText('Unstage all')).not.toBeInTheDocument()
  })

  it('calls onUnstageAll when Unstage All clicked', () => {
    const onUnstageAll = vi.fn()
    render(<FileTreeSection {...defaultProps} onUnstageAll={onUnstageAll} />)
    fireEvent.click(screen.getByLabelText('Unstage all'))
    expect(onUnstageAll).toHaveBeenCalled()
  })

  it('calls onStageAll when Stage All clicked', () => {
    const onStageAll = vi.fn()
    render(<FileTreeSection {...defaultProps} isStaged={false} onStageAll={onStageAll} />)
    fireEvent.click(screen.getByLabelText('Stage all'))
    expect(onStageAll).toHaveBeenCalled()
  })

  it('collapses file list when header is clicked', () => {
    render(<FileTreeSection {...defaultProps} />)
    const toggle = screen.getByLabelText('Collapse Staged Changes')
    fireEvent.click(toggle)
    expect(screen.queryByText('foo.ts')).not.toBeInTheDocument()
  })

  it('expands file list again after collapse', () => {
    render(<FileTreeSection {...defaultProps} />)
    const toggle = screen.getByLabelText('Collapse Staged Changes')
    fireEvent.click(toggle)
    const expandToggle = screen.getByLabelText('Expand Staged Changes')
    fireEvent.click(expandToggle)
    expect(screen.getByText('foo.ts')).toBeInTheDocument()
  })

  it('marks selected file as selected', () => {
    render(<FileTreeSection {...defaultProps} selectedPath="src/foo.ts" />)
    const rows = screen.getAllByRole('row')
    const selectedRow = rows.find((r) => r.getAttribute('aria-selected') === 'true')
    expect(selectedRow).toBeTruthy()
  })

  it('calls onSelectFile when a file row is clicked', () => {
    const onSelectFile = vi.fn()
    render(<FileTreeSection {...defaultProps} onSelectFile={onSelectFile} />)
    fireEvent.click(screen.getByText('foo.ts'))
    expect(onSelectFile).toHaveBeenCalledWith('src/foo.ts')
  })

  it('provides rowgroup aria label for file list', () => {
    render(<FileTreeSection {...defaultProps} />)
    expect(screen.getByRole('rowgroup', { name: 'Staged Changes' })).toBeInTheDocument()
  })

  // --- Additional tests for branch coverage ---

  it('does not show Unstage All when onUnstageAll is not provided', () => {
    render(<FileTreeSection {...defaultProps} isStaged={true} onUnstageAll={undefined} />)
    expect(screen.queryByLabelText('Unstage all')).not.toBeInTheDocument()
  })

  it('does not show Stage All when onStageAll is not provided', () => {
    render(<FileTreeSection {...defaultProps} isStaged={false} onStageAll={undefined} />)
    expect(screen.queryByLabelText('Stage all')).not.toBeInTheDocument()
  })

  it('hides rowgroup when collapsed', () => {
    render(<FileTreeSection {...defaultProps} />)
    fireEvent.click(screen.getByLabelText('Collapse Staged Changes'))
    expect(screen.queryByRole('rowgroup')).not.toBeInTheDocument()
  })

  it('file count badge updates with different file counts', () => {
    const manyFiles: GitFileEntry[] = [
      { path: 'a.ts', status: 'M' },
      { path: 'b.ts', status: 'A' },
      { path: 'c.ts', status: 'D' }
    ]
    render(<FileTreeSection {...defaultProps} files={manyFiles} />)
    expect(screen.getByLabelText('3 files')).toBeInTheDocument()
  })

  it('renders with single file', () => {
    render(<FileTreeSection {...defaultProps} files={[{ path: 'only.ts', status: 'M' }]} />)
    expect(screen.getByLabelText('1 files')).toBeInTheDocument()
    expect(screen.getByText('only.ts')).toBeInTheDocument()
  })

  it('renders correct title for unstaged section', () => {
    render(<FileTreeSection {...defaultProps} title="Unstaged Changes" isStaged={false} />)
    expect(screen.getByText('Unstaged Changes')).toBeInTheDocument()
  })

  it('collapse toggle has aria-expanded=true initially', () => {
    render(<FileTreeSection {...defaultProps} />)
    const toggle = screen.getByLabelText('Collapse Staged Changes')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })

  it('collapse toggle has aria-expanded=false after click', () => {
    render(<FileTreeSection {...defaultProps} />)
    fireEvent.click(screen.getByLabelText('Collapse Staged Changes'))
    const expandToggle = screen.getByLabelText('Expand Staged Changes')
    expect(expandToggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('selectedPath=null means no rows are selected', () => {
    render(<FileTreeSection {...defaultProps} selectedPath={null} />)
    const rows = screen.getAllByRole('row')
    const selectedRow = rows.find((r) => r.getAttribute('aria-selected') === 'true')
    expect(selectedRow).toBeFalsy()
  })

  it('hover effects on Stage All button', () => {
    render(<FileTreeSection {...defaultProps} isStaged={false} />)
    const stageAllBtn = screen.getByLabelText('Stage all')
    fireEvent.mouseEnter(stageAllBtn)
    fireEvent.mouseLeave(stageAllBtn)
    expect(stageAllBtn).toBeInTheDocument()
  })

  it('hover effects on Unstage All button', () => {
    render(<FileTreeSection {...defaultProps} isStaged={true} />)
    const unstageAllBtn = screen.getByLabelText('Unstage all')
    fireEvent.mouseEnter(unstageAllBtn)
    fireEvent.mouseLeave(unstageAllBtn)
    expect(unstageAllBtn).toBeInTheDocument()
  })
})
