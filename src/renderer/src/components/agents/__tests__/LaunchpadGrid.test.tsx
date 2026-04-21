import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LaunchpadGrid } from '../LaunchpadGrid'
import { DEFAULT_TEMPLATES } from '../../../lib/default-templates'

const mockRepos = [
  { label: 'BDE', owner: 'owner', color: '#fff' },
  { label: 'life-os', owner: 'owner', color: '#fff' }
]

vi.mock('../../../hooks/useRepoOptions', () => ({
  useRepoOptions: () => mockRepos
}))

describe('LaunchpadGrid', () => {
  const onSelectTemplate = vi.fn()
  const onCustomPrompt = vi.fn()

  const defaultProps = {
    templates: DEFAULT_TEMPLATES.filter((t) => !t.hidden),
    onSelectTemplate,
    onCustomPrompt,
    spawning: false
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders quick action tiles from templates', () => {
    render(<LaunchpadGrid {...defaultProps} />)
    expect(screen.getByText('Clean Code')).toBeInTheDocument()
    expect(screen.getByText('Fix Bug')).toBeInTheDocument()
    expect(screen.getByText('New Feature')).toBeInTheDocument()
  })

  it('renders repo chip and model pills', () => {
    render(<LaunchpadGrid {...defaultProps} />)
    expect(screen.getByText(/BDE/)).toBeInTheDocument()
    expect(screen.getByText('Sonnet')).toBeInTheDocument()
  })

  it('renders chat input with placeholder "What would you like to work on?"', () => {
    render(<LaunchpadGrid {...defaultProps} />)
    expect(screen.getByPlaceholderText('What would you like to work on?')).toBeInTheDocument()
  })

  it('Enter on textarea calls onCustomPrompt', async () => {
    const user = userEvent.setup()
    render(<LaunchpadGrid {...defaultProps} />)
    const input = screen.getByPlaceholderText('What would you like to work on?')
    await user.type(input, 'Do something custom{Enter}')
    expect(onCustomPrompt).toHaveBeenCalledWith(
      'Do something custom',
      expect.any(String),
      expect.any(String)
    )
  })

  it('Shift+Enter does NOT submit', async () => {
    const user = userEvent.setup()
    render(<LaunchpadGrid {...defaultProps} />)
    const input = screen.getByPlaceholderText('What would you like to work on?')
    await user.type(input, 'text{Shift>}{Enter}{/Shift}')
    expect(onCustomPrompt).not.toHaveBeenCalled()
  })

  it('clicking tile calls onSelectTemplate', () => {
    render(<LaunchpadGrid {...defaultProps} />)
    fireEvent.click(screen.getByText('Clean Code'))
    expect(onSelectTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'builtin-clean-code' }),
      expect.any(String),
      expect.any(String)
    )
  })

  it('tiles and textarea disabled when spawning is true', () => {
    render(<LaunchpadGrid {...defaultProps} spawning={true} />)
    const tiles = screen.getAllByRole('button', { name: /Clean Code|Fix Bug|New Feature/i })
    for (const tile of tiles) {
      expect(tile).toBeDisabled()
    }
    const input = screen.getByPlaceholderText('What would you like to work on?')
    expect(input).toBeDisabled()
  })

  it('does not render a "Recent" section', () => {
    render(<LaunchpadGrid {...defaultProps} />)
    expect(screen.queryByText(/Recent/i)).not.toBeInTheDocument()
  })

  it('disables the model pills (routing is controlled via Settings → Models)', () => {
    render(<LaunchpadGrid {...defaultProps} />)
    for (const label of ['Haiku', 'Sonnet', 'Opus']) {
      const pill = screen.getByRole('button', { name: label })
      expect(pill).toBeDisabled()
      expect(pill).toHaveAttribute('title', expect.stringMatching(/Settings.*Models/i))
    }
  })
})
