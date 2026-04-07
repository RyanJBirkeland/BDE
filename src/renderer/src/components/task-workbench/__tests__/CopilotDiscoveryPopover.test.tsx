import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { CopilotDiscoveryPopover } from '../CopilotDiscoveryPopover'

describe('CopilotDiscoveryPopover', () => {
  it('renders title and body', () => {
    render(<CopilotDiscoveryPopover onDismiss={vi.fn()} />)
    expect(screen.getByText(/Meet the AI Copilot/i)).toBeInTheDocument()
    expect(screen.getByText(/Get help drafting task specs/i)).toBeInTheDocument()
  })

  it('uses dialog semantics with aria-labelledby and aria-describedby', () => {
    render(<CopilotDiscoveryPopover onDismiss={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-labelledby', 'wb-copilot-popover-title')
    expect(dialog).toHaveAttribute('aria-describedby', 'wb-copilot-popover-body')
  })

  it('calls onDismiss when "Got it" is clicked', async () => {
    const onDismiss = vi.fn()
    render(<CopilotDiscoveryPopover onDismiss={onDismiss} />)
    await userEvent.click(screen.getByRole('button', { name: /got it/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('calls onDismiss when the close (X) button is clicked', async () => {
    const onDismiss = vi.fn()
    render(<CopilotDiscoveryPopover onDismiss={onDismiss} />)
    await userEvent.click(screen.getByRole('button', { name: /dismiss copilot popover/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
