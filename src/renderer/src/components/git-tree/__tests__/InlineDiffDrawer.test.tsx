import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InlineDiffDrawer } from '../InlineDiffDrawer'
import type { GitFileEntry } from '../../../stores/gitTree'

const selectedFile: GitFileEntry = { path: 'src/foo.ts', status: 'M' }

const diffContent = `--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 unchanged line
-removed line
+added line
+another added line`

describe('InlineDiffDrawer', () => {
  it('returns null when no file selected', () => {
    const { container } = render(
      <InlineDiffDrawer selectedFile={null} diffContent="" onClose={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders when a file is selected', () => {
    render(
      <InlineDiffDrawer selectedFile={selectedFile} diffContent={diffContent} onClose={vi.fn()} />
    )
    expect(screen.getByRole('region')).toBeInTheDocument()
  })

  it('shows file path in header', () => {
    render(
      <InlineDiffDrawer selectedFile={selectedFile} diffContent={diffContent} onClose={vi.fn()} />
    )
    expect(screen.getByText('src/foo.ts')).toBeInTheDocument()
  })

  it('has accessible region label', () => {
    render(
      <InlineDiffDrawer selectedFile={selectedFile} diffContent={diffContent} onClose={vi.fn()} />
    )
    expect(screen.getByRole('region', { name: /Diff for foo.ts/ })).toBeInTheDocument()
  })

  it('shows close button', () => {
    render(
      <InlineDiffDrawer selectedFile={selectedFile} diffContent={diffContent} onClose={vi.fn()} />
    )
    expect(screen.getByLabelText('Close diff')).toBeInTheDocument()
  })

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn()
    render(
      <InlineDiffDrawer selectedFile={selectedFile} diffContent={diffContent} onClose={onClose} />
    )
    fireEvent.click(screen.getByLabelText('Close diff'))
    expect(onClose).toHaveBeenCalled()
  })

  it('renders diff lines', () => {
    render(
      <InlineDiffDrawer selectedFile={selectedFile} diffContent={diffContent} onClose={vi.fn()} />
    )
    expect(screen.getByText('-removed line')).toBeInTheDocument()
    expect(screen.getByText('+added line')).toBeInTheDocument()
  })

  it('shows @@ hunk headers', () => {
    render(
      <InlineDiffDrawer selectedFile={selectedFile} diffContent={diffContent} onClose={vi.fn()} />
    )
    expect(screen.getByText('@@ -1,3 +1,4 @@')).toBeInTheDocument()
  })

  it('shows "No diff available" when diff is empty', () => {
    render(<InlineDiffDrawer selectedFile={selectedFile} diffContent="" onClose={vi.fn()} />)
    expect(screen.getByText('No diff available')).toBeInTheDocument()
  })

  it('handles file path without directory', () => {
    const rootFile: GitFileEntry = { path: 'README.md', status: 'M' }
    render(<InlineDiffDrawer selectedFile={rootFile} diffContent={diffContent} onClose={vi.fn()} />)
    expect(screen.getByRole('region', { name: /Diff for README.md/ })).toBeInTheDocument()
  })

  // ---------- Branch coverage: expand/collapse toggle ----------

  it('starts in collapsed state', () => {
    const { container } = render(
      <InlineDiffDrawer selectedFile={selectedFile} diffContent={diffContent} onClose={vi.fn()} />
    )
    expect(container.querySelector('.git-diff-drawer--expanded')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Expand diff to fullscreen')).toBeInTheDocument()
  })

  it('expands when expand button is clicked', () => {
    const { container } = render(
      <InlineDiffDrawer selectedFile={selectedFile} diffContent={diffContent} onClose={vi.fn()} />
    )
    fireEvent.click(screen.getByLabelText('Expand diff to fullscreen'))
    expect(container.querySelector('.git-diff-drawer--expanded')).toBeInTheDocument()
    expect(screen.getByLabelText('Collapse diff')).toBeInTheDocument()
  })

  it('collapses when collapse button is clicked after expanding', () => {
    const { container } = render(
      <InlineDiffDrawer selectedFile={selectedFile} diffContent={diffContent} onClose={vi.fn()} />
    )
    fireEvent.click(screen.getByLabelText('Expand diff to fullscreen'))
    expect(container.querySelector('.git-diff-drawer--expanded')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Collapse diff'))
    expect(container.querySelector('.git-diff-drawer--expanded')).not.toBeInTheDocument()
  })

  it('shows title attribute on file path', () => {
    render(
      <InlineDiffDrawer selectedFile={selectedFile} diffContent={diffContent} onClose={vi.fn()} />
    )
    const pathElement = screen.getByText('src/foo.ts')
    expect(pathElement.getAttribute('title')).toBe('src/foo.ts')
  })

  it('expand button title changes between Expand and Collapse', () => {
    render(
      <InlineDiffDrawer selectedFile={selectedFile} diffContent={diffContent} onClose={vi.fn()} />
    )
    const expandBtn = screen.getByLabelText('Expand diff to fullscreen')
    expect(expandBtn.getAttribute('title')).toBe('Expand')
    fireEvent.click(expandBtn)
    const collapseBtn = screen.getByLabelText('Collapse diff')
    expect(collapseBtn.getAttribute('title')).toBe('Collapse')
  })

  // ---------- Branch coverage: line class names ----------

  it('applies add class to + lines', () => {
    const addDiff = '+new line'
    const { container } = render(
      <InlineDiffDrawer selectedFile={selectedFile} diffContent={addDiff} onClose={vi.fn()} />
    )
    expect(container.querySelector('.git-diff-drawer__line--add')).toBeInTheDocument()
  })

  it('applies delete class to - lines', () => {
    const delDiff = '-removed line'
    const { container } = render(
      <InlineDiffDrawer selectedFile={selectedFile} diffContent={delDiff} onClose={vi.fn()} />
    )
    expect(container.querySelector('.git-diff-drawer__line--delete')).toBeInTheDocument()
  })

  it('applies meta class to @@ lines', () => {
    const metaDiff = '@@ -1,3 +1,3 @@'
    const { container } = render(
      <InlineDiffDrawer selectedFile={selectedFile} diffContent={metaDiff} onClose={vi.fn()} />
    )
    expect(container.querySelector('.git-diff-drawer__line--meta')).toBeInTheDocument()
  })

  it('applies default class to context lines', () => {
    const contextDiff = ' unchanged line'
    const { container } = render(
      <InlineDiffDrawer selectedFile={selectedFile} diffContent={contextDiff} onClose={vi.fn()} />
    )
    expect(container.querySelector('.git-diff-drawer__line--default')).toBeInTheDocument()
  })
})
