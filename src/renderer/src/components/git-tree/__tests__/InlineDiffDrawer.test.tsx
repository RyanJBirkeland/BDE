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
})
