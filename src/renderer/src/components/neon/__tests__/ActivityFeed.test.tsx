import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ActivityFeed, type FeedEvent } from '../ActivityFeed'

const mockEvents: FeedEvent[] = [
  { id: '1', label: 'fix-auth pushing', accent: 'cyan', timestamp: Date.now() - 2000 },
  { id: '2', label: 'add-tests done ✓', accent: 'pink', timestamp: Date.now() - 60000 },
  { id: '3', label: 'PR #42 merged', accent: 'blue', timestamp: Date.now() - 180000 }
]

describe('ActivityFeed', () => {
  it('renders all events', () => {
    render(<ActivityFeed events={mockEvents} />)
    expect(screen.getByText('fix-auth pushing')).toBeInTheDocument()
    expect(screen.getByText('add-tests done ✓')).toBeInTheDocument()
    expect(screen.getByText('PR #42 merged')).toBeInTheDocument()
  })

  it('limits display to maxItems', () => {
    render(<ActivityFeed events={mockEvents} maxItems={2} />)
    expect(screen.getByText('fix-auth pushing')).toBeInTheDocument()
    expect(screen.getByText('add-tests done ✓')).toBeInTheDocument()
    expect(screen.queryByText('PR #42 merged')).not.toBeInTheDocument()
  })

  it('shows relative timestamps', () => {
    render(<ActivityFeed events={mockEvents} />)
    expect(screen.getByText('2s ago')).toBeInTheDocument()
  })

  it('renders empty state when no events', () => {
    render(<ActivityFeed events={[]} />)
    expect(screen.getByText('No recent activity')).toBeInTheDocument()
  })

  it('shows hours-ago format for timestamps 1-23 hours old', () => {
    const hoursAgoEvents: FeedEvent[] = [
      { id: 'h1', label: 'hours test', accent: 'cyan', timestamp: Date.now() - 3 * 60 * 60 * 1000 }
    ]
    render(<ActivityFeed events={hoursAgoEvents} />)
    expect(screen.getByText('3h ago')).toBeInTheDocument()
  })

  it('shows days-ago format for timestamps 24+ hours old', () => {
    const daysAgoEvents: FeedEvent[] = [
      { id: 'd1', label: 'days test', accent: 'pink', timestamp: Date.now() - 48 * 60 * 60 * 1000 }
    ]
    render(<ActivityFeed events={daysAgoEvents} />)
    expect(screen.getByText('2d ago')).toBeInTheDocument()
  })

  it('shows "just now" for events less than 1 second old', () => {
    const justNowEvents: FeedEvent[] = [
      { id: 'jn', label: 'just now test', accent: 'blue', timestamp: Date.now() }
    ]
    render(<ActivityFeed events={justNowEvents} />)
    expect(screen.getByText('just now')).toBeInTheDocument()
  })

  it('calls onEventClick when an event is clicked', () => {
    const onClick = vi.fn()
    const events = [{ id: '1', label: 'Task completed', accent: 'cyan' as const, timestamp: Date.now() }]
    render(<ActivityFeed events={events} onEventClick={onClick} />)
    const eventRow = screen.getByText('Task completed').closest('[role="button"]')!
    fireEvent.click(eventRow)
    expect(onClick).toHaveBeenCalledWith(events[0])
  })

  it('does not add role=button when onEventClick is not provided', () => {
    const events = [{ id: '1', label: 'Task completed', accent: 'cyan' as const, timestamp: Date.now() }]
    const { container } = render(<ActivityFeed events={events} />)
    expect(container.querySelector('[role="button"]')).toBeNull()
  })

  it('calls onEventClick on Enter key press', () => {
    const onClick = vi.fn()
    const events = [{ id: '1', label: 'Task completed', accent: 'cyan' as const, timestamp: Date.now() }]
    render(<ActivityFeed events={events} onEventClick={onClick} />)
    const eventRow = screen.getByText('Task completed').closest('[role="button"]')!
    fireEvent.keyDown(eventRow, { key: 'Enter' })
    expect(onClick).toHaveBeenCalledWith(events[0])
  })

  it('calls onEventClick on Space key press', () => {
    const onClick = vi.fn()
    const events = [{ id: '1', label: 'Task completed', accent: 'cyan' as const, timestamp: Date.now() }]
    render(<ActivityFeed events={events} onEventClick={onClick} />)
    const eventRow = screen.getByText('Task completed').closest('[role="button"]')!
    fireEvent.keyDown(eventRow, { key: ' ' })
    expect(onClick).toHaveBeenCalledWith(events[0])
  })

  it('sets cursor pointer style when onEventClick is provided', () => {
    const onClick = vi.fn()
    const events = [{ id: '1', label: 'Task completed', accent: 'cyan' as const, timestamp: Date.now() }]
    render(<ActivityFeed events={events} onEventClick={onClick} />)
    const eventRow = screen.getByText('Task completed').closest('[role="button"]') as HTMLElement
    expect(eventRow.style.cursor).toBe('pointer')
  })
})
