import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TagBadge } from '../TagBadge'

describe('TagBadge', () => {
  it('renders the tag text', () => {
    render(<TagBadge tag="urgent" />)
    expect(screen.getByText('urgent')).toBeInTheDocument()
  })

  it('applies sm size class by default', () => {
    const { container } = render(<TagBadge tag="test" />)
    expect(container.firstChild).toHaveClass('tag-badge--sm')
  })

  it('applies md size class', () => {
    const { container } = render(<TagBadge tag="test" size="md" />)
    expect(container.firstChild).toHaveClass('tag-badge--md')
  })

  it('does not render remove button when no onRemove', () => {
    render(<TagBadge tag="test" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders remove button when onRemove provided', () => {
    render(<TagBadge tag="test" onRemove={() => {}} />)
    expect(screen.getByLabelText('Remove test tag')).toBeInTheDocument()
  })

  it('calls onRemove when remove button clicked', () => {
    const onRemove = vi.fn()
    render(<TagBadge tag="test" onRemove={onRemove} />)
    fireEvent.click(screen.getByLabelText('Remove test tag'))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('produces consistent colors for the same tag', () => {
    const { container: c1 } = render(<TagBadge tag="feature" />)
    const { container: c2 } = render(<TagBadge tag="feature" />)
    const style1 = (c1.firstChild as HTMLElement).style.color
    const style2 = (c2.firstChild as HTMLElement).style.color
    expect(style1).toBe(style2)
  })
})
