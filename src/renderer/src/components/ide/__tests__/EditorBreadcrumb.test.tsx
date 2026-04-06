import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EditorBreadcrumb } from '../EditorBreadcrumb'

vi.mock('../../../stores/ide', () => ({
  useIDEStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      openTabs: [
        {
          id: 'tab-1',
          filePath: '/projects/my-app/src/components/Button.tsx',
          displayName: 'Button.tsx',
          language: 'typescriptreact',
          isDirty: false
        }
      ],
      activeTabId: 'tab-1',
      rootPath: '/projects/my-app'
    })
  )
}))

describe('EditorBreadcrumb', () => {
  it('renders path segments relative to root', () => {
    render(<EditorBreadcrumb />)

    expect(screen.getByText('src')).toBeInTheDocument()
    expect(screen.getByText('components')).toBeInTheDocument()
    expect(screen.getByText('Button.tsx')).toBeInTheDocument()
  })

  it('marks the last segment as active', () => {
    render(<EditorBreadcrumb />)

    const filename = screen.getByText('Button.tsx')
    expect(filename.className).toContain('editor-breadcrumb__segment--active')
  })

  it('has accessible navigation landmark', () => {
    render(<EditorBreadcrumb />)

    expect(screen.getByRole('navigation', { name: 'File path' })).toBeInTheDocument()
  })

  it('renders chevron separators between segments', () => {
    const { container } = render(<EditorBreadcrumb />)

    // 3 segments = 2 separators
    const seps = container.querySelectorAll('.editor-breadcrumb__sep')
    expect(seps).toHaveLength(2)
  })
})
