import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WelcomeStep } from '../steps/WelcomeStep'

const baseProps = {
  onNext: vi.fn(),
  onBack: vi.fn(),
  onComplete: vi.fn(),
  isFirst: true,
  isLast: false
}

describe('WelcomeStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the welcome copy', () => {
    render(<WelcomeStep {...baseProps} />)
    expect(screen.getByRole('heading', { name: /welcome to bde/i })).toBeInTheDocument()
    expect(screen.getByText(/autonomous ai-powered development/i)).toBeInTheDocument()
  })

  it('hides the Back button on the first step', () => {
    render(<WelcomeStep {...baseProps} isFirst={true} />)
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull()
  })

  it('shows the Back button when not the first step', () => {
    render(<WelcomeStep {...baseProps} isFirst={false} />)
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()
  })

  it('calls onNext when Next is clicked', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<WelcomeStep {...baseProps} onNext={onNext} />)

    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(onNext).toHaveBeenCalledTimes(1)
  })
})
