import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockMergePR = vi.fn()
vi.mock('../../../lib/github-api', () => ({
  mergePR: (...args: unknown[]) => mockMergePR(...args)
}))

const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
vi.mock('../../../stores/toasts', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args)
  }
}))

import { MergeButton } from '../MergeButton'
import type { OpenPr } from '../../../../../shared/types'

const mockPr: OpenPr = {
  number: 7,
  title: 'My PR',
  html_url: 'https://github.com/o/r/pull/7',
  state: 'open',
  draft: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  head: { ref: 'feat/test', sha: 'abc' },
  base: { ref: 'main' },
  user: { login: 'alice' },
  merged: false,
  merged_at: null,
  repo: 'BDE'
}

const mergeability = { number: 7, repo: 'BDE', mergeable: true, mergeable_state: 'clean' }

describe('MergeButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMergePR.mockResolvedValue(undefined)
  })

  it('renders merge action button and dropdown trigger', () => {
    render(<MergeButton pr={mockPr} mergeability={mergeability} />)
    expect(screen.getByTitle('Squash merge')).toBeInTheDocument()
    expect(screen.getByTitle('Pick merge strategy')).toBeInTheDocument()
  })

  it('calls mergePR with squash by default', async () => {
    const onMerged = vi.fn()
    render(<MergeButton pr={mockPr} mergeability={mergeability} onMerged={onMerged} />)
    await userEvent.click(screen.getByTitle('Squash merge'))
    // Confirm the merge in the dialog
    await waitFor(() => expect(screen.getByText('Confirm Merge')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await waitFor(() =>
      expect(mockMergePR).toHaveBeenCalledWith('RyanJBirkeland', 'BDE', 7, 'squash')
    )
    expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringContaining('Merged'))
    expect(onMerged).toHaveBeenCalledWith(mockPr)
  })

  it('shows toast error when merge fails', async () => {
    mockMergePR.mockRejectedValue(new Error('conflict'))
    render(<MergeButton pr={mockPr} mergeability={mergeability} />)
    await userEvent.click(screen.getByTitle('Squash merge'))
    // Confirm the merge in the dialog
    await waitFor(() => expect(screen.getByText('Confirm Merge')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('conflict'))
  })

  it('disables buttons when mergeability blocks merge', () => {
    const blocked = { number: 7, repo: 'BDE', mergeable: false, mergeable_state: 'dirty' }
    render(<MergeButton pr={mockPr} mergeability={blocked} />)
    expect(screen.getByTitle(/not mergeable/i)).toBeDisabled()
    expect(screen.getByTitle('Pick merge strategy')).toBeDisabled()
  })

  it('disables buttons when already merged', () => {
    const mergedPr = { ...mockPr, merged: true }
    render(<MergeButton pr={mergedPr} mergeability={mergeability} />)
    expect(screen.getByTitle('Squash merge')).toBeDisabled()
  })

  it('opens dropdown when dropdown trigger clicked', async () => {
    render(<MergeButton pr={mockPr} mergeability={mergeability} />)
    await userEvent.click(screen.getByTitle('Pick merge strategy'))
    expect(screen.getByRole('option', { name: 'Squash' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Merge commit' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Rebase' })).toBeInTheDocument()
  })

  it('changes merge method when strategy selected from dropdown', async () => {
    const onMerged = vi.fn()
    render(<MergeButton pr={mockPr} mergeability={mergeability} onMerged={onMerged} />)
    await userEvent.click(screen.getByTitle('Pick merge strategy'))
    await userEvent.click(screen.getByRole('option', { name: 'Rebase' }))
    // Dropdown closes
    expect(screen.queryByRole('option', { name: 'Squash' })).not.toBeInTheDocument()
    // New strategy used on merge
    await userEvent.click(screen.getByTitle('Rebase merge'))
    // Confirm the merge in the dialog
    await waitFor(() => expect(screen.getByText('Confirm Merge')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await waitFor(() =>
      expect(mockMergePR).toHaveBeenCalledWith('RyanJBirkeland', 'BDE', 7, 'rebase')
    )
  })

  it('does not call onMerged when merge fails', async () => {
    mockMergePR.mockRejectedValue(new Error('oops'))
    const onMerged = vi.fn()
    render(<MergeButton pr={mockPr} mergeability={mergeability} onMerged={onMerged} />)
    await userEvent.click(screen.getByTitle('Squash merge'))
    // Confirm the merge in the dialog
    await waitFor(() => expect(screen.getByText('Confirm Merge')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await waitFor(() => expect(mockToastError).toHaveBeenCalled())
    expect(onMerged).not.toHaveBeenCalled()
  })

  it('does not call mergePR when user cancels confirmation', async () => {
    render(<MergeButton pr={mockPr} mergeability={mergeability} />)
    await userEvent.click(screen.getByTitle('Squash merge'))
    // Wait for confirmation dialog
    await waitFor(() => expect(screen.getByText('Confirm Merge')).toBeInTheDocument())
    // Click cancel
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    // mergePR should not be called
    expect(mockMergePR).not.toHaveBeenCalled()
  })
})
