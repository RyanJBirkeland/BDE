import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmptyState } from '../EmptyState'

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="No data" />)
    expect(screen.getByText('No data')).toBeInTheDocument()
  })

  it('renders description when provided', () => {
    render(<EmptyState title="Empty" description="Nothing here" />)
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })

  it('does not render description when not provided', () => {
    const { container } = render(<EmptyState title="Empty" />)
    expect(container.querySelector('.bde-empty__desc')).not.toBeInTheDocument()
  })

  it('renders icon when provided', () => {
    render(<EmptyState title="Empty" icon={<span data-testid="icon">!</span>} />)
    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })

  it('renders action button when provided', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<EmptyState title="Empty" action={{ label: 'Retry', onClick }} />)

    const btn = screen.getByRole('button', { name: 'Retry' })
    expect(btn).toBeInTheDocument()

    await user.click(btn)
    expect(onClick).toHaveBeenCalledOnce()
  })
})
