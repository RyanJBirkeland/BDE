import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LaunchpadConfigure } from '../LaunchpadConfigure'
import type { PromptTemplate } from '../../../lib/launchpad-types'

const mockTemplate: PromptTemplate = {
  id: 'test-template',
  name: 'Test Task',
  icon: '🧪',
  accent: 'cyan',
  description: 'Test',
  questions: [
    { id: 'scope', label: 'Pick a scope', type: 'choice', choices: ['All', 'Some', 'None'] },
    { id: 'detail', label: 'Describe in detail', type: 'text', required: true },
  ],
  promptTemplate: '{{scope}} — {{detail}}',
  order: 0,
}

describe('LaunchpadConfigure', () => {
  const onComplete = vi.fn()
  const onBack = vi.fn()

  beforeEach(() => vi.clearAllMocks())

  it('renders template badge with icon and name', () => {
    render(<LaunchpadConfigure template={mockTemplate} onComplete={onComplete} onBack={onBack} />)
    expect(screen.getByText('🧪')).toBeInTheDocument()
    expect(screen.getByText('Test Task')).toBeInTheDocument()
  })

  it('shows the first question', () => {
    render(<LaunchpadConfigure template={mockTemplate} onComplete={onComplete} onBack={onBack} />)
    expect(screen.getByText('Pick a scope')).toBeInTheDocument()
  })

  it('shows step counter', () => {
    render(<LaunchpadConfigure template={mockTemplate} onComplete={onComplete} onBack={onBack} />)
    expect(screen.getByText(/Step 1 of 2/)).toBeInTheDocument()
  })

  it('renders choice chips for choice questions', () => {
    render(<LaunchpadConfigure template={mockTemplate} onComplete={onComplete} onBack={onBack} />)
    expect(screen.getByText('All')).toBeInTheDocument()
    expect(screen.getByText('Some')).toBeInTheDocument()
    expect(screen.getByText('None')).toBeInTheDocument()
  })

  it('advances to next question when choice is clicked', () => {
    render(<LaunchpadConfigure template={mockTemplate} onComplete={onComplete} onBack={onBack} />)
    fireEvent.click(screen.getByText('All'))
    // Should show the answer bubble and next question
    expect(screen.getByText('Describe in detail')).toBeInTheDocument()
    expect(screen.getByText(/Step 2 of 2/)).toBeInTheDocument()
  })

  it('calls onComplete with answers after last question', async () => {
    const user = userEvent.setup()
    render(<LaunchpadConfigure template={mockTemplate} onComplete={onComplete} onBack={onBack} />)

    // Answer first question
    fireEvent.click(screen.getByText('All'))

    // Answer second question (text type) via input
    const input = screen.getByPlaceholderText(/Type an answer/i)
    await user.type(input, 'some detail{Enter}')

    expect(onComplete).toHaveBeenCalledWith({ scope: 'All', detail: 'some detail' })
  })

  it('calls onBack when back arrow is clicked', () => {
    render(<LaunchpadConfigure template={mockTemplate} onComplete={onComplete} onBack={onBack} />)
    fireEvent.click(screen.getByTitle(/back/i))
    expect(onBack).toHaveBeenCalled()
  })
})
