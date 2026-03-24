import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockMergePR = vi.fn()
const mockClosePR = vi.fn()
vi.mock('../../../lib/github-api', () => ({
  mergePR: (...args: unknown[]) => mockMergePR(...args),
  closePR: (...args: unknown[]) => mockClosePR(...args),
}))

const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
vi.mock('../../../stores/toasts', () => ({
  toast: { success: (...args: unknown[]) => mockToastSuccess(...args), error: (...args: unknown[]) => mockToastError(...args) },
}))

import { PRStationActions } from '../PRStationActions'
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
  repo: 'BDE',
}

const mergeability = { number: 42, repo: 'BDE', mergeable: true, mergeable_state: 'clean' }

describe('PRStationActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMergePR.mockResolvedValue(undefined)
    mockClosePR.mockResolvedValue(undefined)
  })

  it('renders merge and close buttons', () => {
    render(<PRStationActions pr={mockPr} mergeability={mergeability} onRemovePr={vi.fn()} />)
    expect(screen.getByTitle(/squash merge/i)).toBeInTheDocument()
    expect(screen.getByTitle(/close pr/i)).toBeInTheDocument()
  })

  it('shows merge confirmation when merge button clicked', async () => {
    render(<PRStationActions pr={mockPr} mergeability={mergeability} onRemovePr={vi.fn()} />)
    await userEvent.click(screen.getByTitle(/squash merge/i))
    expect(screen.getByText(/merge pr #42/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('calls mergePR and onRemovePr after confirming merge', async () => {
    const onRemovePr = vi.fn()
    render(<PRStationActions pr={mockPr} mergeability={mergeability} onRemovePr={onRemovePr} />)
    await userEvent.click(screen.getByTitle(/squash merge/i))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(mockMergePR).toHaveBeenCalledWith('RyanJBirkeland', 'BDE', 42, 'squash'))
    expect(onRemovePr).toHaveBeenCalledWith(mockPr)
    expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringContaining('Merged'))
  })

  it('cancels merge confirmation without calling mergePR', async () => {
    render(<PRStationActions pr={mockPr} mergeability={mergeability} onRemovePr={vi.fn()} />)
    await userEvent.click(screen.getByTitle(/squash merge/i))
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockMergePR).not.toHaveBeenCalled()
    // Should return to main button state
    expect(screen.getByTitle(/squash merge/i)).toBeInTheDocument()
  })

  it('shows close confirmation when Close button clicked', async () => {
    render(<PRStationActions pr={mockPr} mergeability={mergeability} onRemovePr={vi.fn()} />)
    await userEvent.click(screen.getByTitle(/close pr/i))
    expect(screen.getByText(/close pr #42/i)).toBeInTheDocument()
  })

  it('calls closePR and onRemovePr after confirming close', async () => {
    const onRemovePr = vi.fn()
    render(<PRStationActions pr={mockPr} mergeability={mergeability} onRemovePr={onRemovePr} />)
    await userEvent.click(screen.getByTitle(/close pr/i))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(mockClosePR).toHaveBeenCalledWith('RyanJBirkeland', 'BDE', 42))
    expect(onRemovePr).toHaveBeenCalledWith(mockPr)
    expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringContaining('Closed'))
  })

  it('renders merged badge for already-merged PR', () => {
    const mergedPr = { ...mockPr, merged: true }
    render(<PRStationActions pr={mergedPr} mergeability={mergeability} onRemovePr={vi.fn()} />)
    expect(screen.getByText(/merged/i)).toBeInTheDocument()
    expect(screen.queryByTitle(/squash merge/i)).not.toBeInTheDocument()
  })

  it('disables merge button when mergeability blocks merge', () => {
    const blocked = { number: 42, repo: 'BDE', mergeable: false, mergeable_state: 'dirty' }
    render(<PRStationActions pr={mockPr} mergeability={blocked} onRemovePr={vi.fn()} />)
    expect(screen.getByTitle(/not mergeable/i)).toBeDisabled()
  })

  it('shows toast error when mergePR throws', async () => {
    mockMergePR.mockRejectedValue(new Error('conflict'))
    render(<PRStationActions pr={mockPr} mergeability={mergeability} onRemovePr={vi.fn()} />)
    await userEvent.click(screen.getByTitle(/squash merge/i))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('conflict'))
  })

  it('changes merge method via dropdown and uses new method on merge', async () => {
    const onRemovePr = vi.fn()
    render(<PRStationActions pr={mockPr} mergeability={mergeability} onRemovePr={onRemovePr} />)

    // Open dropdown and select "Merge commit"
    await userEvent.click(screen.getByTitle(/pick merge strategy/i))
    await userEvent.click(screen.getByRole('button', { name: /merge commit/i }))

    // Now confirm merge — method should be 'merge'
    await userEvent.click(screen.getByTitle(/merge commit merge/i))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(mockMergePR).toHaveBeenCalledWith('RyanJBirkeland', 'BDE', 42, 'merge'))
  })

  it('changes merge method to rebase and uses rebase on merge', async () => {
    const onRemovePr = vi.fn()
    render(<PRStationActions pr={mockPr} mergeability={mergeability} onRemovePr={onRemovePr} />)

    await userEvent.click(screen.getByTitle(/pick merge strategy/i))
    await userEvent.click(screen.getByRole('button', { name: /rebase/i }))

    await userEvent.click(screen.getByTitle(/rebase merge/i))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(mockMergePR).toHaveBeenCalledWith('RyanJBirkeland', 'BDE', 42, 'rebase'))
  })

  it('shows toast error when closePR throws', async () => {
    mockClosePR.mockRejectedValue(new Error('not found'))
    render(<PRStationActions pr={mockPr} mergeability={mergeability} onRemovePr={vi.fn()} />)
    await userEvent.click(screen.getByTitle(/close pr/i))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('not found'))
  })

  it('does not call onRemovePr when merge fails', async () => {
    mockMergePR.mockRejectedValue(new Error('conflict'))
    const onRemovePr = vi.fn()
    render(<PRStationActions pr={mockPr} mergeability={mergeability} onRemovePr={onRemovePr} />)
    await userEvent.click(screen.getByTitle(/squash merge/i))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(mockToastError).toHaveBeenCalled())
    expect(onRemovePr).not.toHaveBeenCalled()
  })
})
