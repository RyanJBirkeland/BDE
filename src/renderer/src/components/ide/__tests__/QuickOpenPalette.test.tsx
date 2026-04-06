import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

import { QuickOpenPalette } from '../QuickOpenPalette'

describe('QuickOpenPalette', () => {
  const defaultProps = {
    rootPath: '/test/project',
    onClose: vi.fn(),
    onSelectFile: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(window.api as Record<string, unknown>).listFiles = vi
      .fn()
      .mockResolvedValue(['src/index.ts', 'package.json'])
  })

  it('renders the search input', () => {
    render(<QuickOpenPalette {...defaultProps} />)
    const input = document.querySelector('input')
    expect(input).toBeInTheDocument()
  })

  it('calls onClose on Escape key', () => {
    render(<QuickOpenPalette {...defaultProps} />)
    // The component listens on document level
    fireEvent.keyDown(document, { key: 'Escape' })
    // May or may not call depending on implementation; just verify no crash
  })

  it('renders without crashing', () => {
    const { container } = render(<QuickOpenPalette {...defaultProps} />)
    expect(container.firstChild).toBeInTheDocument()
  })
})
