import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { QuickCreateBar } from '../QuickCreateBar'

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...rest }: any) => {
      const { createElement } = require('react')
      return createElement('div', rest, children)
    }
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false
}))

vi.mock('../../lib/motion', () => ({
  SPRINGS: { snappy: {} },
  useReducedMotion: () => false
}))

// Mock window.api.sprint
const mockCreate = vi.fn().mockResolvedValue({ id: 'new-1', title: 'Test' })
const mockGeneratePrompt = vi
  .fn()
  .mockResolvedValue({ taskId: 'new-1', spec: '## Spec', prompt: 'Test' })

vi.stubGlobal('window', {
  ...window,
  api: {
    sprint: { create: mockCreate, generatePrompt: mockGeneratePrompt },
    getRepoPaths: vi.fn().mockResolvedValue({ bde: '/path/bde' })
  }
})

describe('QuickCreateBar', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders input when open', () => {
    render(<QuickCreateBar open={true} onClose={onClose} defaultRepo="bde" />)
    expect(screen.getByPlaceholderText(/task title/i)).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<QuickCreateBar open={false} onClose={onClose} defaultRepo="bde" />)
    expect(screen.queryByPlaceholderText(/task title/i)).not.toBeInTheDocument()
  })

  it('creates backlog task on Enter', async () => {
    render(<QuickCreateBar open={true} onClose={onClose} defaultRepo="bde" />)
    const input = screen.getByPlaceholderText(/task title/i)
    fireEvent.change(input, { target: { value: 'Fix bug' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // Wait for the async create to resolve
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Fix bug',
        repo: 'bde',
        status: 'backlog'
      })
    )
  })

  it('closes on Escape', () => {
    render(<QuickCreateBar open={true} onClose={onClose} defaultRepo="bde" />)
    const input = screen.getByPlaceholderText(/task title/i)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('creates queued task on Cmd+Enter', async () => {
    render(<QuickCreateBar open={true} onClose={onClose} defaultRepo="bde" />)
    const input = screen.getByPlaceholderText(/task title/i)
    fireEvent.change(input, { target: { value: 'Add feature' } })
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true })

    // Wait for the async create to resolve
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Add feature',
        repo: 'bde',
        status: 'queued'
      })
    )
  })
})
