import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const mockGetPRDetail = vi.fn()
const mockGetPRFiles = vi.fn()
const mockGetCheckRunsList = vi.fn()
const mockGetReviews = vi.fn()
const mockGetReviewComments = vi.fn()
const mockGetIssueComments = vi.fn()

vi.mock('../../../lib/github-api', () => ({
  getPRDetail: (...args: unknown[]) => mockGetPRDetail(...args),
  getPRFiles: (...args: unknown[]) => mockGetPRFiles(...args),
  getCheckRunsList: (...args: unknown[]) => mockGetCheckRunsList(...args),
  getReviews: (...args: unknown[]) => mockGetReviews(...args),
  getReviewComments: (...args: unknown[]) => mockGetReviewComments(...args),
  getIssueComments: (...args: unknown[]) => mockGetIssueComments(...args)
}))

vi.mock('../../../lib/github-cache', () => ({
  cachedGetPRDetail: (...args: unknown[]) => mockGetPRDetail(...args),
  cachedGetPRFiles: (...args: unknown[]) => mockGetPRFiles(...args),
  cachedGetReviews: (...args: unknown[]) => mockGetReviews(...args),
  cachedGetReviewComments: (...args: unknown[]) => mockGetReviewComments(...args),
  cachedGetIssueComments: (...args: unknown[]) => mockGetIssueComments(...args),
  invalidateCache: vi.fn()
}))

vi.mock('../../../lib/render-markdown', () => ({ renderMarkdown: (s: string) => s ?? '' }))

vi.mock('../PRStationChecks', () => ({
  PRStationChecks: () => <div data-testid="checks" />
}))
vi.mock('../PRStationReviews', () => ({
  PRStationReviews: () => <div data-testid="reviews" />
}))
vi.mock('../PRStationConversation', () => ({
  PRStationConversation: () => <div data-testid="conversation" />
}))
vi.mock('../PRStationConflictBanner', () => ({
  PRStationConflictBanner: () => null
}))

import { PRStationDetail } from '../PRStationDetail'
import type { OpenPr } from '../../../../../shared/types'

const mockPr: OpenPr = {
  number: 42,
  title: 'My Feature PR',
  html_url: 'https://github.com/o/r/pull/42',
  state: 'open',
  draft: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  head: { ref: 'feat/my-feature', sha: 'abc123' },
  base: { ref: 'main' },
  user: { login: 'alice' },
  merged: false,
  merged_at: null,
  repo: 'BDE'
}

const mockDetail = {
  number: 42,
  title: 'My Feature PR',
  body: 'This is the PR body',
  user: { login: 'alice' },
  draft: false,
  head: { ref: 'feat/my-feature', sha: 'abc123' },
  base: { ref: 'main' },
  labels: [],
  additions: 10,
  deletions: 3,
  mergeable: true,
  mergeable_state: 'clean'
}

const mockFiles = [
  { filename: 'src/foo.ts', status: 'modified', additions: 5, deletions: 2 },
  { filename: 'src/bar.ts', status: 'added', additions: 10, deletions: 0 }
]

describe('PRStationDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPRDetail.mockResolvedValue(mockDetail)
    mockGetPRFiles.mockResolvedValue(mockFiles)
    mockGetCheckRunsList.mockResolvedValue([])
    mockGetReviews.mockResolvedValue([])
    mockGetReviewComments.mockResolvedValue([])
    mockGetIssueComments.mockResolvedValue([])
  })

  it('renders PR header with title and number', async () => {
    render(<PRStationDetail pr={mockPr} />)
    await waitFor(() => expect(screen.getByText('#42')).toBeInTheDocument())
    expect(screen.getByText('My Feature PR')).toBeInTheDocument()
  })

  it('renders author login', async () => {
    render(<PRStationDetail pr={mockPr} />)
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())
  })

  it('renders changed files list', async () => {
    render(<PRStationDetail pr={mockPr} />)
    await waitFor(() => expect(screen.getByText('src/foo.ts')).toBeInTheDocument())
    expect(screen.getByText('src/bar.ts')).toBeInTheDocument()
  })

  it('shows file count badge', async () => {
    render(<PRStationDetail pr={mockPr} />)
    await waitFor(() => expect(screen.getByText('Changed Files')).toBeInTheDocument())
    // Count badge with 2 files
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders PRStationChecks child section', async () => {
    render(<PRStationDetail pr={mockPr} />)
    await waitFor(() => expect(screen.getByTestId('checks')).toBeInTheDocument())
  })

  it('renders PRStationReviews child section', async () => {
    render(<PRStationDetail pr={mockPr} />)
    await waitFor(() => expect(screen.getByTestId('reviews')).toBeInTheDocument())
  })

  it('renders PRStationConversation child section', async () => {
    render(<PRStationDetail pr={mockPr} />)
    await waitFor(() => expect(screen.getByTestId('conversation')).toBeInTheDocument())
  })

  it('renders PR body description', async () => {
    render(<PRStationDetail pr={mockPr} />)
    await waitFor(() => expect(screen.getByText('This is the PR body')).toBeInTheDocument())
  })

  it('calls GitHub API functions with correct repo owner', async () => {
    render(<PRStationDetail pr={mockPr} />)
    await waitFor(() => expect(mockGetPRDetail).toHaveBeenCalledWith('RyanJBirkeland', 'BDE', 42))
    expect(mockGetPRFiles).toHaveBeenCalledWith('RyanJBirkeland', 'BDE', 42)
    expect(mockGetReviews).toHaveBeenCalledWith('RyanJBirkeland', 'BDE', 42)
  })
})
