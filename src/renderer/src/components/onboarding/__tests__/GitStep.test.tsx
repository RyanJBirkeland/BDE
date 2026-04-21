import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GitStep } from '../steps/GitStep'

const baseProps = {
  onNext: vi.fn(),
  onBack: vi.fn(),
  onComplete: vi.fn(),
  isFirst: false,
  isLast: false
}

function setCheckInstalled(result: boolean | Promise<boolean>): void {
  const api = (
    globalThis as unknown as { api: { git: { checkInstalled: ReturnType<typeof vi.fn> } } }
  ).api
  api.git.checkInstalled = vi
    .fn()
    .mockReturnValue(typeof result === 'object' ? result : Promise.resolve(result))
}

describe('GitStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('enables Next once git is detected', async () => {
    setCheckInstalled(true)
    render(<GitStep {...baseProps} />)

    const nextBtn = await screen.findByRole('button', { name: /next/i })
    await waitFor(() => expect(nextBtn).not.toBeDisabled())
  })

  it('disables Next and shows install help when git is missing', async () => {
    setCheckInstalled(false)
    render(<GitStep {...baseProps} />)

    await waitFor(() => {
      expect(screen.getByText(/install git/i)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
  })

  it('re-runs the check when "Check Again" is clicked', async () => {
    const api = (
      globalThis as unknown as { api: { git: { checkInstalled: ReturnType<typeof vi.fn> } } }
    ).api
    api.git.checkInstalled = vi.fn().mockResolvedValue(false)

    const user = userEvent.setup()
    render(<GitStep {...baseProps} />)

    const checkAgain = await screen.findByRole('button', { name: /check again/i })
    api.git.checkInstalled = vi.fn().mockResolvedValue(true)

    await user.click(checkAgain)

    const nextBtn = await screen.findByRole('button', { name: /next/i })
    await waitFor(() => expect(nextBtn).not.toBeDisabled())
  })

  it('hides the Back button on the first step', () => {
    setCheckInstalled(true)
    render(<GitStep {...baseProps} isFirst={true} />)
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull()
  })
})
