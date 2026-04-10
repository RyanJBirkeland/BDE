import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { RepoDiscoveryModal } from '../RepoDiscoveryModal'

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(window.api.repoDiscovery.scanLocal).mockResolvedValue([])
  vi.mocked(window.api.repoDiscovery.listGithub).mockResolvedValue([])
  vi.mocked(window.api.repoDiscovery.onCloneProgress).mockReturnValue(() => {})
  vi.mocked(window.api.settings.getJson).mockResolvedValue(null)
})

describe('RepoDiscoveryModal', () => {
  it('renders with Local tab active by default', async () => {
    render(<RepoDiscoveryModal open onClose={vi.fn()} onRepoAdded={vi.fn()} repos={[]} />)
    expect(screen.getByRole('tab', { name: /local/i })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows discovered local repos', async () => {
    vi.mocked(window.api.repoDiscovery.scanLocal).mockResolvedValue([
      {
        name: 'my-project',
        localPath: '/Users/test/projects/my-project',
        owner: 'octocat',
        repo: 'my-project'
      }
    ])

    render(<RepoDiscoveryModal open onClose={vi.fn()} onRepoAdded={vi.fn()} repos={[]} />)

    await waitFor(() => {
      expect(screen.getByText('my-project')).toBeInTheDocument()
    })
  })

  it('shows empty state when no local repos found', async () => {
    vi.mocked(window.api.repoDiscovery.scanLocal).mockResolvedValue([])

    render(<RepoDiscoveryModal open onClose={vi.fn()} onRepoAdded={vi.fn()} repos={[]} />)

    await waitFor(() => {
      expect(screen.getByText(/no unconfigured/i)).toBeInTheDocument()
    })
  })

  it('calls onRepoAdded when Add button clicked', async () => {
    const onRepoAdded = vi.fn()
    vi.mocked(window.api.repoDiscovery.scanLocal).mockResolvedValue([
      {
        name: 'my-project',
        localPath: '/Users/test/projects/my-project',
        owner: 'oct',
        repo: 'my-project'
      }
    ])

    render(<RepoDiscoveryModal open onClose={vi.fn()} onRepoAdded={onRepoAdded} repos={[]} />)

    await waitFor(() => {
      expect(screen.getByText('my-project')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /add/i }))

    await waitFor(() => {
      expect(onRepoAdded).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'my-project',
          localPath: '/Users/test/projects/my-project'
        })
      )
    })
  })

  it('filters repos by search query', async () => {
    vi.mocked(window.api.repoDiscovery.scanLocal).mockResolvedValue([
      { name: 'alpha', localPath: '/p/alpha' },
      { name: 'beta', localPath: '/p/beta' }
    ])

    render(<RepoDiscoveryModal open onClose={vi.fn()} onRepoAdded={vi.fn()} repos={[]} />)

    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'bet' } })

    expect(screen.queryByText('alpha')).not.toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
  })

  it('does not render when open is false', () => {
    const { container } = render(
      <RepoDiscoveryModal open={false} onClose={vi.fn()} onRepoAdded={vi.fn()} repos={[]} />
    )
    expect(container.innerHTML).toBe('')
  })
})
