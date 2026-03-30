import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockClosePR = vi.fn()
vi.mock('../../../lib/github-api', () => ({
  closePR: (...args: unknown[]) => mockClosePR(...args)
}))

const mockInvalidatePRCache = vi.fn()
vi.mock('../../../lib/github-cache', () => ({
  invalidatePRCache: (...args: unknown[]) => mockInvalidatePRCache(...args)
}))

const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
vi.mock('../../../stores/toasts', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args)
  }
}))

import { CloseButton } from '../CloseButton'
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

/** Click Close button then confirm the dialog */
async function clickCloseAndConfirm() {
  await userEvent.click(screen.getByTitle('Close PR'))
  // ConfirmModal uses role="alertdialog" and has a danger-variant confirm button
  const dialog = await screen.findByRole('alertdialog')
  // The confirm button has the confirmLabel text ('Close') with danger variant
  const buttons = dialog.querySelectorAll('button')
  // Last button in the dialog actions is the confirm button
  const confirmBtn = buttons[buttons.length - 1] as HTMLElement
  await userEvent.click(confirmBtn)
}

describe('CloseButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClosePR.mockResolvedValue(undefined)
  })

  it('renders close button', () => {
    render(<CloseButton pr={mockPr} />)
    expect(screen.getByTitle('Close PR')).toBeInTheDocument()
    expect(screen.getByText('Close')).toBeInTheDocument()
  })

  it('calls closePR and invalidates cache after confirmation', async () => {
    const onClosed = vi.fn()
    render(<CloseButton pr={mockPr} onClosed={onClosed} />)
    await clickCloseAndConfirm()
    await waitFor(() => expect(mockClosePR).toHaveBeenCalledWith('RyanJBirkeland', 'BDE', 7))
    expect(mockInvalidatePRCache).toHaveBeenCalledWith('RyanJBirkeland', 'BDE', 7)
    expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringContaining('Closed'))
    expect(onClosed).toHaveBeenCalledWith(mockPr)
  })

  it('shows toast error when close fails', async () => {
    mockClosePR.mockRejectedValue(new Error('network error'))
    render(<CloseButton pr={mockPr} />)
    await clickCloseAndConfirm()
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('network error'))
  })

  it('does not call onClosed when close fails', async () => {
    mockClosePR.mockRejectedValue(new Error('oops'))
    const onClosed = vi.fn()
    render(<CloseButton pr={mockPr} onClosed={onClosed} />)
    await clickCloseAndConfirm()
    await waitFor(() => expect(mockToastError).toHaveBeenCalled())
    expect(onClosed).not.toHaveBeenCalled()
  })

  it('disables button when PR is already merged', () => {
    const mergedPr = { ...mockPr, merged: true }
    render(<CloseButton pr={mergedPr} />)
    expect(screen.getByTitle('Close PR')).toBeDisabled()
  })

  it('does not call closePR when confirmation is cancelled', async () => {
    render(<CloseButton pr={mockPr} />)
    await userEvent.click(screen.getByTitle('Close PR'))
    const dialog = await screen.findByRole('alertdialog')
    // First button is cancel
    const cancelBtn = dialog.querySelectorAll('button')[0] as HTMLElement
    await userEvent.click(cancelBtn)
    expect(mockClosePR).not.toHaveBeenCalled()
  })
})
