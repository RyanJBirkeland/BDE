import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StatusRail } from '../StatusRail'

const baseStats = {
  active: 6,
  queued: 0,
  blocked: 3,
  review: 0,
  done: 115,
  doneToday: 4,
  failed: 2,
  actualFailed: 2
}

describe('StatusRail', () => {
  const noop = (): void => {}

  it('renders Active, Queued, Done, Tokens tiles + New Task button', () => {
    const { container } = render(
      <StatusRail
        stats={baseStats}
        tokens24h={628_000}
        onFilterClick={noop}
        onNewTaskClick={noop}
      />
    )
    const tiles = container.querySelectorAll('[data-role="rail-tile"]')
    // 5 tiles: Active, Queued, Review, Done, Tokens
    expect(tiles.length).toBe(5)
    expect(screen.getByText(/Active/i)).toBeInTheDocument()
    expect(screen.getByText(/Queued/i)).toBeInTheDocument()
    expect(screen.getByText(/Review/i)).toBeInTheDocument()
    expect(screen.getByText(/Done/i)).toBeInTheDocument()
    expect(screen.getByText(/Tokens/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new task/i })).toBeInTheDocument()
  })

  it('Done tile shows "X today" subtext', () => {
    render(
      <StatusRail stats={baseStats} tokens24h={0} onFilterClick={noop} onNewTaskClick={noop} />
    )
    expect(screen.getByText(/4 today/)).toBeInTheDocument()
  })

  it('tokens24h renders in compact form (628.0K)', () => {
    render(
      <StatusRail
        stats={baseStats}
        tokens24h={628_000}
        onFilterClick={noop}
        onNewTaskClick={noop}
      />
    )
    expect(screen.getByText(/628\.0K/)).toBeInTheDocument()
  })

  it('tokens24h handles millions', () => {
    render(
      <StatusRail
        stats={baseStats}
        tokens24h={1_500_000}
        onFilterClick={noop}
        onNewTaskClick={noop}
      />
    )
    expect(screen.getByText(/1\.5M/)).toBeInTheDocument()
  })

  it('clicking Active tile calls onFilterClick with "active"', () => {
    const onFilterClick = vi.fn()
    const { container } = render(
      <StatusRail
        stats={baseStats}
        tokens24h={0}
        onFilterClick={onFilterClick}
        onNewTaskClick={noop}
      />
    )
    const activeTile = Array.from(container.querySelectorAll('[data-role="rail-tile"]')).find((t) =>
      t.textContent?.match(/Active/i)
    ) as HTMLElement
    fireEvent.click(activeTile)
    expect(onFilterClick).toHaveBeenCalledWith('active')
  })

  it('clicking Queued tile calls onFilterClick with "queued"', () => {
    const onFilterClick = vi.fn()
    const { container } = render(
      <StatusRail
        stats={baseStats}
        tokens24h={0}
        onFilterClick={onFilterClick}
        onNewTaskClick={noop}
      />
    )
    const queuedTile = Array.from(container.querySelectorAll('[data-role="rail-tile"]')).find((t) =>
      t.textContent?.match(/Queued/i)
    ) as HTMLElement
    fireEvent.click(queuedTile)
    expect(onFilterClick).toHaveBeenCalledWith('queued')
  })

  it('clicking Done tile calls onFilterClick with "done"', () => {
    const onFilterClick = vi.fn()
    const { container } = render(
      <StatusRail
        stats={baseStats}
        tokens24h={0}
        onFilterClick={onFilterClick}
        onNewTaskClick={noop}
      />
    )
    const doneTile = Array.from(container.querySelectorAll('[data-role="rail-tile"]')).find((t) =>
      t.textContent?.match(/Done/i)
    ) as HTMLElement
    fireEvent.click(doneTile)
    expect(onFilterClick).toHaveBeenCalledWith('done')
  })

  it('clicking New Task button calls onNewTaskClick', () => {
    const onNewTaskClick = vi.fn()
    render(
      <StatusRail
        stats={baseStats}
        tokens24h={0}
        onFilterClick={noop}
        onNewTaskClick={onNewTaskClick}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /new task/i }))
    expect(onNewTaskClick).toHaveBeenCalled()
  })

  it('does NOT render Blocked, Failed, or PRs tiles', () => {
    const { container } = render(
      <StatusRail stats={baseStats} tokens24h={0} onFilterClick={noop} onNewTaskClick={noop} />
    )
    const allText = container.textContent ?? ''
    expect(allText).not.toMatch(/Blocked/i)
    expect(allText).not.toMatch(/Failed/i)
    expect(allText).not.toMatch(/PRs/i)
  })

  it('renders a Review tile showing pending review count', () => {
    const statsWithReview = { ...baseStats, review: 7 }
    const { container } = render(
      <StatusRail
        stats={statsWithReview}
        tokens24h={0}
        onFilterClick={noop}
        onNewTaskClick={noop}
      />
    )
    const tiles = container.querySelectorAll('[data-role="rail-tile"]')
    expect(tiles.length).toBe(5)
    const reviewTile = Array.from(tiles).find((t) => t.textContent?.match(/Review/i))
    expect(reviewTile).toBeDefined()
    expect(reviewTile?.textContent).toMatch(/7/)
  })

  it('clicking Review tile calls onFilterClick with "review"', () => {
    const onFilterClick = vi.fn()
    const statsWithReview = { ...baseStats, review: 2 }
    const { container } = render(
      <StatusRail
        stats={statsWithReview}
        tokens24h={0}
        onFilterClick={onFilterClick}
        onNewTaskClick={noop}
      />
    )
    const reviewTile = Array.from(container.querySelectorAll('[data-role="rail-tile"]')).find((t) =>
      t.textContent?.match(/Review/i)
    ) as HTMLElement
    fireEvent.click(reviewTile)
    expect(onFilterClick).toHaveBeenCalledWith('review')
  })
})
