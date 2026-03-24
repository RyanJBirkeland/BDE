import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../lib/render-markdown', () => ({ renderMarkdown: (s: string) => s ?? '' }))

import { PRStationReviews } from '../PRStationReviews'

const reviews = [
  {
    id: 1,
    user: { login: 'alice', avatar_url: '' },
    state: 'APPROVED' as const,
    body: 'LGTM',
    submitted_at: new Date().toISOString(),
    html_url: '',
  },
  {
    id: 2,
    user: { login: 'bob', avatar_url: '' },
    state: 'CHANGES_REQUESTED' as const,
    body: 'Fix types',
    submitted_at: new Date().toISOString(),
    html_url: '',
  },
  {
    id: 3,
    user: { login: 'alice', avatar_url: '' },
    state: 'COMMENTED' as const,
    body: 'Hmm',
    submitted_at: new Date(Date.now() - 60000).toISOString(),
    html_url: '',
  },
]

describe('PRStationReviews', () => {
  it('renders latest review per user (deduplication)', () => {
    render(<PRStationReviews reviews={reviews} loading={false} />)
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
    expect(screen.getAllByText(/alice|bob/)).toHaveLength(2)
  })

  it('shows loading skeletons', () => {
    const { container } = render(<PRStationReviews reviews={[]} loading={true} />)
    expect(container.querySelector('.sprint-board__skeleton')).toBeTruthy()
  })

  it('shows empty state when no reviews', () => {
    render(<PRStationReviews reviews={[]} loading={false} />)
    expect(screen.getByText(/no review/i)).toBeInTheDocument()
  })
})
