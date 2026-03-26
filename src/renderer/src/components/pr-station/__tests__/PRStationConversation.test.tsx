import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../lib/render-markdown', () => ({ renderMarkdown: (s: string) => s ?? '' }))

import { PRStationConversation } from '../PRStationConversation'

const issueComments = [
  {
    id: 10,
    user: { login: 'alice', avatar_url: '' },
    body: 'Looks good overall',
    created_at: '2026-01-01T00:00:00Z',
    html_url: ''
  }
]
const reviewComments = [
  {
    id: 20,
    user: { login: 'bob', avatar_url: '' },
    body: 'Fix this line',
    created_at: '2026-01-01T01:00:00Z',
    updated_at: '2026-01-01T01:00:00Z',
    html_url: '',
    path: 'src/main.ts',
    line: 42,
    side: 'RIGHT' as const,
    in_reply_to_id: null
  },
  {
    id: 21,
    user: { login: 'alice', avatar_url: '' },
    body: 'Done',
    created_at: '2026-01-01T02:00:00Z',
    updated_at: '2026-01-01T02:00:00Z',
    html_url: '',
    path: 'src/main.ts',
    line: 42,
    side: 'RIGHT' as const,
    in_reply_to_id: 20
  }
]

describe('PRStationConversation', () => {
  it('renders issue comments and review threads', () => {
    render(
      <PRStationConversation
        reviewComments={reviewComments}
        issueComments={issueComments}
        loading={false}
      />
    )
    expect(screen.getByText('Looks good overall')).toBeInTheDocument()
    expect(screen.getByText('Fix this line')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('groups review comment replies into threads', () => {
    render(
      <PRStationConversation reviewComments={reviewComments} issueComments={[]} loading={false} />
    )
    expect(screen.getByText(/src\/main\.ts/)).toBeInTheDocument()
  })

  it('shows empty state when no comments', () => {
    render(<PRStationConversation reviewComments={[]} issueComments={[]} loading={false} />)
    expect(screen.getByText(/no comment/i)).toBeInTheDocument()
  })
})
