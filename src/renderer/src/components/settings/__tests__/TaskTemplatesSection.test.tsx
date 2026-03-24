/**
 * TaskTemplatesSection — template list and loading tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

beforeEach(() => {
  vi.mocked(window.api.templates.list).mockResolvedValue([])
  vi.mocked(window.api.templates.save).mockResolvedValue(undefined)
  vi.mocked(window.api.templates.delete).mockResolvedValue(undefined)
  vi.mocked(window.api.templates.reset).mockResolvedValue(undefined)
})

import { TaskTemplatesSection } from '../TaskTemplatesSection'

describe('TaskTemplatesSection', () => {
  it('renders section heading after loading', async () => {
    render(<TaskTemplatesSection />)
    await waitFor(() => {
      expect(screen.getByText('Task Templates')).toBeInTheDocument()
    })
  })

  it('shows empty state when no templates', async () => {
    render(<TaskTemplatesSection />)
    await waitFor(() => {
      expect(screen.getByText('No templates configured')).toBeInTheDocument()
    })
  })

  it('shows Add Template button', async () => {
    render(<TaskTemplatesSection />)
    await waitFor(() => {
      expect(screen.getByText(/Add Template/)).toBeInTheDocument()
    })
  })

  it('loads templates on mount', async () => {
    vi.mocked(window.api.templates.list).mockResolvedValue([
      { name: 'My Template', promptPrefix: 'Always use TypeScript.', isBuiltIn: false },
    ])
    render(<TaskTemplatesSection />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('My Template')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Always use TypeScript.')).toBeInTheDocument()
    })
  })

  it('renders built-in badge for built-in templates', async () => {
    vi.mocked(window.api.templates.list).mockResolvedValue([
      { name: 'Default', promptPrefix: 'You are helpful.', isBuiltIn: true },
    ])
    render(<TaskTemplatesSection />)
    await waitFor(() => {
      expect(screen.getByText('Built-in')).toBeInTheDocument()
    })
  })

  it('calls templates.save when Add Template is clicked', async () => {
    const user = userEvent.setup()
    render(<TaskTemplatesSection />)
    await waitFor(() => screen.getByText(/Add Template/))
    await user.click(screen.getByText(/Add Template/))
    expect(window.api.templates.save).toHaveBeenCalledWith({ name: '', promptPrefix: '' })
  })
})
