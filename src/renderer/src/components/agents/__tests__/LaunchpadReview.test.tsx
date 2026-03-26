import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LaunchpadReview } from '../LaunchpadReview'
import type { PromptTemplate } from '../../../lib/launchpad-types'

const mockTemplate: PromptTemplate = {
  id: 'test-1',
  name: 'Clean Code',
  icon: '🧹',
  accent: 'cyan',
  description: 'Audit',
  questions: [{ id: 'scope', label: 'Scope', type: 'choice', choices: ['All'] }],
  promptTemplate: 'Audit {{scope}}',
  order: 0
}

describe('LaunchpadReview', () => {
  const onSpawn = vi.fn()
  const onBack = vi.fn()
  const onSaveTemplate = vi.fn()

  const defaultProps = {
    template: mockTemplate,
    assembledPrompt: 'Audit All files in the repo',
    answers: { scope: 'All' },
    repo: 'BDE',
    model: 'sonnet',
    onSpawn,
    onBack,
    onSaveTemplate,
    spawning: false
  }

  beforeEach(() => vi.clearAllMocks())

  it('renders the review badge with template name', () => {
    render(<LaunchpadReview {...defaultProps} />)
    expect(screen.getByText(/Clean Code/)).toBeInTheDocument()
  })

  it('renders param cards for repo and model', () => {
    render(<LaunchpadReview {...defaultProps} />)
    expect(screen.getByText('BDE')).toBeInTheDocument()
    expect(screen.getByText(/Sonnet/i)).toBeInTheDocument()
  })

  it('renders the assembled prompt', () => {
    render(<LaunchpadReview {...defaultProps} />)
    expect(screen.getByText(/Audit All files/)).toBeInTheDocument()
  })

  it('calls onSpawn when Spawn button is clicked', () => {
    render(<LaunchpadReview {...defaultProps} />)
    fireEvent.click(screen.getByText(/Spawn/i))
    expect(onSpawn).toHaveBeenCalledWith('Audit All files in the repo')
  })

  it('calls onBack when Back button is clicked', () => {
    render(<LaunchpadReview {...defaultProps} />)
    fireEvent.click(screen.getByText(/Back/i))
    expect(onBack).toHaveBeenCalled()
  })

  it('toggles edit mode on Edit click', () => {
    render(<LaunchpadReview {...defaultProps} />)
    fireEvent.click(screen.getByText('Edit'))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('calls onSaveTemplate when Save as Template is clicked', () => {
    render(<LaunchpadReview {...defaultProps} />)
    fireEvent.click(screen.getByText(/Save as Template/i))
    expect(onSaveTemplate).toHaveBeenCalled()
  })

  it('disables spawn button when spawning', () => {
    render(<LaunchpadReview {...defaultProps} spawning={true} />)
    const btn = screen.getByText(/Spawning/i).closest('button')
    expect(btn).toBeDisabled()
  })
})
