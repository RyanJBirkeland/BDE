import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

vi.mock('../../stores/toasts', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}))

import { WebhooksSection } from '../WebhooksSection'

describe('WebhooksSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(window.api.webhooks.list).mockResolvedValue([])
  })

  it('renders without crashing', async () => {
    const { container } = render(<WebhooksSection />)
    await waitFor(() => {
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  it('shows empty state when no webhooks', async () => {
    render(<WebhooksSection />)
    await waitFor(() => {
      expect(screen.getByText('No webhooks configured')).toBeInTheDocument()
    })
  })

  it('renders Add Webhook button', async () => {
    render(<WebhooksSection />)
    await waitFor(() => {
      expect(screen.getByText('Add Webhook')).toBeInTheDocument()
    })
  })

  it('renders webhook entries when data exists', async () => {
    vi.mocked(window.api.webhooks.list).mockResolvedValue([
      {
        id: 'wh-1',
        url: 'https://hooks.example.com/test',
        events: ['task.created'],
        enabled: true,
        secret: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ])

    render(<WebhooksSection />)
    await waitFor(() => {
      expect(screen.getByText('https://hooks.example.com/test')).toBeInTheDocument()
    })
  })

  it('adds a new webhook', async () => {
    render(<WebhooksSection />)
    await waitFor(() => {
      expect(screen.getByText('Add Webhook')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Add Webhook'))
    expect(window.api.webhooks.create).toHaveBeenCalled()
  })

  it('deletes a webhook', async () => {
    vi.mocked(window.api.webhooks.list).mockResolvedValue([
      {
        id: 'wh-del',
        url: 'https://delete.me',
        events: ['*'],
        enabled: true,
        secret: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ])
    render(<WebhooksSection />)
    await waitFor(() => {
      expect(screen.getByText('https://delete.me')).toBeInTheDocument()
    })
    // Find and click delete button
    const deleteBtn = screen.getByLabelText('Remove webhook')
    fireEvent.click(deleteBtn)
    expect(window.api.webhooks.delete).toHaveBeenCalled()
  })

  it('toggles webhook enabled state', async () => {
    vi.mocked(window.api.webhooks.list).mockResolvedValue([
      {
        id: 'wh-toggle',
        url: 'https://toggle.me',
        events: ['task.created'],
        enabled: true,
        secret: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ])
    render(<WebhooksSection />)
    await waitFor(() => {
      expect(screen.getByText('Enabled')).toBeInTheDocument()
    })
    // Toggle enabled
    const disableBtn = screen.getByLabelText('Disable webhook')
    fireEvent.click(disableBtn)
    expect(window.api.webhooks.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wh-toggle', enabled: false })
    )
  })

  it('tests a webhook', async () => {
    vi.mocked(window.api.webhooks.list).mockResolvedValue([
      {
        id: 'wh-test',
        url: 'https://test.me',
        events: ['task.created'],
        enabled: true,
        secret: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ])
    render(<WebhooksSection />)
    await waitFor(() => {
      expect(screen.getByText('https://test.me')).toBeInTheDocument()
    })
    // Click test button
    const testBtn = screen.getByLabelText('Test webhook')
    fireEvent.click(testBtn)
    expect(window.api.webhooks.test).toHaveBeenCalled()
  })

  it('renders enabled status badge', async () => {
    vi.mocked(window.api.webhooks.list).mockResolvedValue([
      {
        id: 'wh-1',
        url: 'https://hooks.example.com/test',
        events: ['task.created', 'task.completed'],
        enabled: true,
        secret: 'mysecret',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ])
    render(<WebhooksSection />)
    await waitFor(() => {
      expect(screen.getByText('Enabled')).toBeInTheDocument()
    })
  })
})
