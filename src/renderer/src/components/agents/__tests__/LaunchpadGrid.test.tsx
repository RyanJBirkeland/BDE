import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LaunchpadGrid } from '../LaunchpadGrid'
import { DEFAULT_TEMPLATES } from '../../../lib/default-templates'
import type { RecentTask } from '../../../lib/launchpad-types'

const mockRepos = [
  { label: 'BDE', owner: 'owner', color: '#fff' },
  { label: 'life-os', owner: 'owner', color: '#fff' },
]

vi.mock('../../../hooks/useRepoOptions', () => ({
  useRepoOptions: () => mockRepos,
}))

describe('LaunchpadGrid', () => {
  const onSelectTemplate = vi.fn()
  const onCustomPrompt = vi.fn()
  const onSelectRecent = vi.fn()

  const defaultProps = {
    templates: DEFAULT_TEMPLATES.filter((t) => !t.hidden),
    recents: [] as RecentTask[],
    onSelectTemplate,
    onCustomPrompt,
    onSelectRecent,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the header with dot and title', () => {
    render(<LaunchpadGrid {...defaultProps} />)
    expect(screen.getByText(/New Agent Session/i)).toBeInTheDocument()
  })

  it('renders all visible template tiles', () => {
    render(<LaunchpadGrid {...defaultProps} />)
    expect(screen.getByText('Clean Code')).toBeInTheDocument()
    expect(screen.getByText('Fix Bug')).toBeInTheDocument()
    expect(screen.getByText('New Feature')).toBeInTheDocument()
  })

  it('renders the + Add tile', () => {
    render(<LaunchpadGrid {...defaultProps} />)
    expect(screen.getByText('Add Custom')).toBeInTheDocument()
  })

  it('calls onSelectTemplate when a tile is clicked', () => {
    render(<LaunchpadGrid {...defaultProps} />)
    fireEvent.click(screen.getByText('Clean Code'))
    expect(onSelectTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'builtin-clean-code' }),
    )
  })

  it('renders recent tasks when provided', () => {
    const recents: RecentTask[] = [
      { prompt: 'Fix the login bug', repo: 'BDE', model: 'sonnet', timestamp: Date.now() - 3600000 },
    ]
    render(<LaunchpadGrid {...defaultProps} recents={recents} />)
    expect(screen.getByText(/Fix the login bug/)).toBeInTheDocument()
  })

  it('calls onSelectRecent when a recent item is clicked', () => {
    const recents: RecentTask[] = [
      { prompt: 'Fix the login bug', repo: 'BDE', model: 'sonnet', timestamp: Date.now() },
    ]
    render(<LaunchpadGrid {...defaultProps} recents={recents} />)
    fireEvent.click(screen.getByText(/Fix the login bug/))
    expect(onSelectRecent).toHaveBeenCalledWith(recents[0])
  })

  it('renders prompt input', () => {
    render(<LaunchpadGrid {...defaultProps} />)
    expect(screen.getByPlaceholderText(/describe a custom task/i)).toBeInTheDocument()
  })

  it('renders model pills with Sonnet active by default', () => {
    render(<LaunchpadGrid {...defaultProps} />)
    const sonnet = screen.getByText('Sonnet')
    expect(sonnet).toBeInTheDocument()
    expect(sonnet.closest('button')).toHaveClass('launchpad__model-pill--active')
  })

  it('calls onCustomPrompt when Enter is pressed with text', async () => {
    const user = userEvent.setup()
    render(<LaunchpadGrid {...defaultProps} />)
    const input = screen.getByPlaceholderText(/describe a custom task/i)
    await user.type(input, 'Do something custom{Enter}')
    expect(onCustomPrompt).toHaveBeenCalledWith(
      'Do something custom',
      expect.any(String), // repo
      expect.any(String), // model
    )
  })
})
