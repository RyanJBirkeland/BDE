import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GitFileRow } from '../GitFileRow'

describe('GitFileRow', () => {
  const defaultProps = {
    path: 'src/components/Foo.tsx',
    status: 'M',
    isStaged: false,
    selected: false,
    onStage: vi.fn(),
    onUnstage: vi.fn(),
    onClick: vi.fn()
  }

  it('renders file name', () => {
    render(<GitFileRow {...defaultProps} />)
    expect(screen.getByText('Foo.tsx')).toBeInTheDocument()
  })

  it('renders directory part dimmed', () => {
    render(<GitFileRow {...defaultProps} />)
    expect(screen.getByText('src/components/')).toBeInTheDocument()
  })

  it('renders status letter', () => {
    render(<GitFileRow {...defaultProps} />)
    expect(screen.getByLabelText('status: M')).toBeInTheDocument()
  })

  it('shows stage button for unstaged file', () => {
    render(<GitFileRow {...defaultProps} />)
    expect(screen.getByLabelText('Stage Foo.tsx')).toBeInTheDocument()
  })

  it('shows unstage button for staged file', () => {
    render(<GitFileRow {...defaultProps} isStaged={true} />)
    expect(screen.getByLabelText('Unstage Foo.tsx')).toBeInTheDocument()
  })

  it('calls onClick when row is clicked', () => {
    const onClick = vi.fn()
    render(<GitFileRow {...defaultProps} onClick={onClick} />)
    fireEvent.click(screen.getByRole('row'))
    expect(onClick).toHaveBeenCalledWith('src/components/Foo.tsx')
  })

  it('calls onStage when stage button clicked for unstaged file', () => {
    const onStage = vi.fn()
    render(<GitFileRow {...defaultProps} onStage={onStage} />)
    fireEvent.click(screen.getByLabelText('Stage Foo.tsx'))
    expect(onStage).toHaveBeenCalledWith('src/components/Foo.tsx')
  })

  it('calls onUnstage when unstage button clicked for staged file', () => {
    const onUnstage = vi.fn()
    render(<GitFileRow {...defaultProps} isStaged={true} onUnstage={onUnstage} />)
    fireEvent.click(screen.getByLabelText('Unstage Foo.tsx'))
    expect(onUnstage).toHaveBeenCalledWith('src/components/Foo.tsx')
  })

  it('renders file without directory when path has no slash', () => {
    render(<GitFileRow {...defaultProps} path="README.md" />)
    expect(screen.getByText('README.md')).toBeInTheDocument()
  })

  it('reflects selected state with aria-selected', () => {
    render(<GitFileRow {...defaultProps} selected={true} />)
    expect(screen.getByRole('row')).toHaveAttribute('aria-selected', 'true')
  })

  it('stage button click does not propagate to row', () => {
    const onClick = vi.fn()
    const onStage = vi.fn()
    render(<GitFileRow {...defaultProps} onClick={onClick} onStage={onStage} />)
    fireEvent.click(screen.getByLabelText('Stage Foo.tsx'))
    // onStage called, onClick NOT called
    expect(onStage).toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders different status colors (A for added)', () => {
    render(<GitFileRow {...defaultProps} status="A" />)
    expect(screen.getByLabelText('status: A')).toBeInTheDocument()
  })

  it('renders D status for deleted file', () => {
    render(<GitFileRow {...defaultProps} status="D" />)
    expect(screen.getByLabelText('status: D')).toBeInTheDocument()
  })

  it('renders ? status for untracked file', () => {
    render(<GitFileRow {...defaultProps} status="?" />)
    expect(screen.getByLabelText('status: ?')).toBeInTheDocument()
  })
})
