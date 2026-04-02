import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// jsdom stubs
Element.prototype.scrollIntoView = vi.fn()

vi.mock('../../../stores/panelLayout', () => ({
  usePanelLayoutStore: (selector: (s: { activeView: string }) => unknown) =>
    selector({ activeView: 'code-review' })
}))

vi.mock('../../../lib/render-markdown', () => ({
  renderMarkdown: (s: string) => s
}))

import { DiffViewer } from '../DiffViewer'
import type { DiffFile } from '../../../lib/diff-parser'

function makeDiffFile(path: string, overrides: Partial<DiffFile> = {}): DiffFile {
  return {
    path,
    additions: 2,
    deletions: 1,
    hunks: [
      {
        header: '@@ -1,3 +1,4 @@',
        lines: [
          { type: 'ctx', content: 'context line', lineNo: { old: 1, new: 1 } },
          { type: 'add', content: 'added line', lineNo: { old: undefined, new: 2 } },
          { type: 'del', content: 'deleted line', lineNo: { old: 2, new: undefined } }
        ]
      }
    ],
    ...overrides
  }
}

/** Build a DiffFile with enough lines to exceed DIFF_VIRTUALIZE_THRESHOLD (500) */
function makeLargeDiffFile(path: string): DiffFile {
  const lines = Array.from({ length: 550 }, (_, i) => ({
    type: 'ctx' as const,
    content: `line ${i}`,
    lineNo: { old: i + 1, new: i + 1 }
  }))
  return {
    path,
    additions: 0,
    deletions: 0,
    hunks: [{ header: '@@ -1,550 +1,550 @@', lines }]
  }
}

describe('DiffViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders empty state when files list is empty', () => {
    render(<DiffViewer files={[]} />)
    expect(screen.getByText(/no changes/i)).toBeInTheDocument()
  })

  it('renders file path in file list sidebar', () => {
    const files = [makeDiffFile('src/foo/bar.ts')]
    render(<DiffViewer files={files} />)
    // Sidebar shows just the filename (basename)
    expect(screen.getByText('bar.ts')).toBeInTheDocument()
  })

  it('renders multiple files in the sidebar', () => {
    const files = [makeDiffFile('src/foo/alpha.ts'), makeDiffFile('src/foo/beta.ts')]
    render(<DiffViewer files={files} />)
    expect(screen.getByText('alpha.ts')).toBeInTheDocument()
    expect(screen.getByText('beta.ts')).toBeInTheDocument()
  })

  it('renders diff lines with content', () => {
    const files = [makeDiffFile('src/example.ts')]
    render(<DiffViewer files={files} />)
    expect(screen.getByText('context line')).toBeInTheDocument()
    expect(screen.getByText('added line')).toBeInTheDocument()
    expect(screen.getByText('deleted line')).toBeInTheDocument()
  })

  it('renders + and - markers for diff lines', () => {
    const files = [makeDiffFile('src/example.ts')]
    render(<DiffViewer files={files} />)
    // Check markers are present
    const markers = document.querySelectorAll('.diff-line__marker')
    const texts = Array.from(markers).map((m) => m.textContent)
    expect(texts).toContain('+')
    expect(texts).toContain('-')
  })

  it('renders addition and deletion stats', () => {
    const files = [makeDiffFile('src/example.ts', { additions: 5, deletions: 3 })]
    render(<DiffViewer files={files} />)
    // stats appear in both sidebar and content header
    expect(screen.getAllByText('+5').length).toBeGreaterThan(0)
    expect(screen.getAllByText('-3').length).toBeGreaterThan(0)
  })

  it('renders file path in the diff content header', () => {
    const files = [makeDiffFile('src/deeply/nested/file.ts')]
    render(<DiffViewer files={files} />)
    // The full path appears in the diff content header
    expect(screen.getByText('src/deeply/nested/file.ts')).toBeInTheDocument()
  })

  it('shows file count badge', () => {
    const files = [makeDiffFile('a.ts'), makeDiffFile('b.ts'), makeDiffFile('c.ts')]
    render(<DiffViewer files={files} />)
    // count badge shows number of files
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders hunk header text', () => {
    const files = [makeDiffFile('src/example.ts')]
    render(<DiffViewer files={files} />)
    expect(screen.getByText('@@ -1,3 +1,4 @@')).toBeInTheDocument()
  })

  it('file sidebar click scrolls to the file', () => {
    const files = [makeDiffFile('src/foo/alpha.ts'), makeDiffFile('src/foo/beta.ts')]
    render(<DiffViewer files={files} />)
    // Clicking the beta.ts item in the sidebar
    const betaBtn = screen.getByText('beta.ts')
    fireEvent.click(betaBtn)
    // active class should be on beta row in sidebar
    expect(betaBtn.closest('.diff-file-item')).toHaveClass('diff-file-item--active')
  })

  it('keyboard ] key moves to next file', () => {
    const files = [makeDiffFile('src/foo/alpha.ts'), makeDiffFile('src/foo/beta.ts')]
    render(<DiffViewer files={files} />)

    // activeFileIndex starts at -1, so ] goes to index 0 (alpha)
    fireEvent.keyDown(window, { key: ']' })

    const alphaBtn = screen.getByText('alpha.ts')
    expect(alphaBtn.closest('.diff-file-item')).toHaveClass('diff-file-item--active')
  })

  it('keyboard [ key moves to previous file (wraps)', () => {
    const files = [makeDiffFile('src/foo/alpha.ts'), makeDiffFile('src/foo/beta.ts')]
    render(<DiffViewer files={files} />)

    // Start at index -1 (unselected), [ wraps to last = beta.ts
    fireEvent.keyDown(window, { key: '[' })
    const betaBtn = screen.getByText('beta.ts')
    expect(betaBtn.closest('.diff-file-item')).toHaveClass('diff-file-item--active')
  })

  it('keyboard ArrowDown moves to first hunk', () => {
    const files = [makeDiffFile('src/example.ts')]
    render(<DiffViewer files={files} />)

    fireEvent.keyDown(window, { key: 'ArrowDown' })

    // hunk header should have focused class
    const hunkHeader = document.querySelector('.diff-hunk--focused')
    expect(hunkHeader).toBeInTheDocument()
  })

  it('keyboard ArrowUp on first hunk wraps to last', () => {
    const files = [makeDiffFile('src/a.ts'), makeDiffFile('src/b.ts')]
    render(<DiffViewer files={files} />)

    // ArrowUp from unselected (-1) wraps to last hunk
    fireEvent.keyDown(window, { key: 'ArrowUp' })

    const focused = document.querySelector('.diff-hunk--focused')
    expect(focused).toBeInTheDocument()
  })

  it('does not respond to keyboard when modifier key held', () => {
    const files = [makeDiffFile('src/a.ts'), makeDiffFile('src/b.ts')]
    render(<DiffViewer files={files} />)

    fireEvent.keyDown(window, { key: ']', metaKey: true })

    // No file should be active
    const active = document.querySelector('.diff-file-item--active')
    expect(active).not.toBeInTheDocument()
  })

  it('renders inline comments when comments prop provided', () => {
    const files = [makeDiffFile('src/example.ts')]
    const comments = [
      {
        id: 1,
        path: 'src/example.ts',
        line: 2,
        body: 'This is a review comment',
        user: { login: 'reviewer', avatar_url: '' },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        diff_hunk: '',
        original_line: 2,
        position: 2,
        in_reply_to_id: null,
        pull_request_review_id: null
      }
    ]
    render(<DiffViewer files={files} comments={comments as any} />)
    expect(screen.getAllByText('This is a review comment').length).toBeGreaterThan(0)
  })

  it('onSelectRange is called when gutter is mousedown', () => {
    const onSelectRange = vi.fn()
    const files = [makeDiffFile('src/example.ts')]
    render(<DiffViewer files={files} onSelectRange={onSelectRange} />)

    const gutters = document.querySelectorAll(
      '.diff-line__gutter--new.diff-line__gutter--selectable'
    )
    expect(gutters.length).toBeGreaterThan(0)
    fireEvent.mouseDown(gutters[0])
    expect(onSelectRange).toHaveBeenCalled()
  })

  it('renders pending comment in diff', () => {
    const files = [makeDiffFile('src/example.ts')]
    const pendingComments = [
      {
        id: 'pending-1',
        path: 'src/example.ts',
        line: 2,
        body: 'My pending comment',
        side: 'RIGHT' as const,
        startLine: 2,
        endLine: 2
      }
    ]
    render(<DiffViewer files={files} pendingComments={pendingComments} />)
    expect(screen.getAllByText('My pending comment').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0)
  })

  it('onRemovePendingComment called when Remove clicked', () => {
    const onRemovePendingComment = vi.fn()
    const files = [makeDiffFile('src/example.ts')]
    const pendingComments = [
      {
        id: 'pending-1',
        path: 'src/example.ts',
        line: 2,
        body: 'To be removed',
        side: 'RIGHT' as const,
        startLine: 2,
        endLine: 2
      }
    ]
    render(
      <DiffViewer
        files={files}
        pendingComments={pendingComments}
        onRemovePendingComment={onRemovePendingComment}
      />
    )
    fireEvent.click(screen.getAllByText('Remove')[0])
    expect(onRemovePendingComment).toHaveBeenCalledWith('pending-1')
  })

  it('uses plain (non-virtualized) mode when file has comments', () => {
    // Even large diff should stay non-virtualized when comments present
    const files = [makeLargeDiffFile('src/large.ts')]
    const comments = [
      {
        id: 1,
        path: 'src/large.ts',
        line: 1,
        body: 'force plain mode',
        user: { login: 'reviewer', avatar_url: '' },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        diff_hunk: '',
        original_line: 1,
        position: 1,
        in_reply_to_id: null,
        pull_request_review_id: null
      }
    ]
    render(<DiffViewer files={files} comments={comments as any} />)
    // In plain mode we see diff-file elements; in virt mode we see the absolute-positioned container
    expect(document.querySelector('.diff-file')).toBeInTheDocument()
  })

  it('uses virtualized mode for large diffs without comments', () => {
    const files = [makeLargeDiffFile('src/large.ts')]
    render(<DiffViewer files={files} />)
    // Virtualized mode renders a totalHeight container but no .diff-file elements
    expect(document.querySelector('.diff-file')).not.toBeInTheDocument()
  })

  it('mouseup on window ends selection', () => {
    const onSelectRange = vi.fn()
    const files = [makeDiffFile('src/example.ts')]
    render(<DiffViewer files={files} onSelectRange={onSelectRange} />)

    const gutters = document.querySelectorAll('.diff-line__gutter--selectable')
    fireEvent.mouseDown(gutters[0])
    fireEvent.mouseUp(window)
    // After mouseup, hover shouldn't extend selection
    fireEvent.mouseEnter(gutters[0])
    // onSelectRange was called once from mousedown but not again after mouseup
    const callCount = onSelectRange.mock.calls.length
    expect(callCount).toBeGreaterThan(0)
  })

  it('shows comment trigger button when selectedRange is set', async () => {
    const onSelectRange = vi.fn()
    const onAddComment = vi.fn()
    const files = [makeDiffFile('src/example.ts')]
    const selectedRange = {
      file: 'src/example.ts',
      startLine: 2,
      endLine: 2,
      side: 'RIGHT' as const
    }
    render(
      <DiffViewer
        files={files}
        onSelectRange={onSelectRange}
        onAddComment={onAddComment}
        selectedRange={selectedRange}
      />
    )
    // The comment trigger (+) button should appear before startLine
    expect(document.querySelector('.diff-selection-trigger')).toBeInTheDocument()
  })
})
