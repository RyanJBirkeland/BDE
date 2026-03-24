import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../stores/ui', () => ({
  useUIStore: (selector: (s: { activeView: string }) => unknown) =>
    selector({ activeView: 'pr-station' }),
}))

vi.mock('../../../lib/render-markdown', () => ({
  renderMarkdown: (s: string) => s,
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
          { type: 'del', content: 'deleted line', lineNo: { old: 2, new: undefined } },
        ],
      },
    ],
    ...overrides,
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
})
