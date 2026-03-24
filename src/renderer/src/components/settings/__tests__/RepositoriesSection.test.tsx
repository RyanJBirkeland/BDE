/**
 * RepositoriesSection — repo list CRUD tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

beforeEach(() => {
  vi.mocked(window.api.settings.getJson).mockResolvedValue(null)
})

import { RepositoriesSection } from '../RepositoriesSection'

describe('RepositoriesSection', () => {
  it('renders section heading', () => {
    render(<RepositoriesSection />)
    expect(screen.getByText('Repositories')).toBeInTheDocument()
  })

  it('shows empty state when no repos configured', async () => {
    render(<RepositoriesSection />)
    await waitFor(() => {
      expect(screen.getByText('No repositories configured')).toBeInTheDocument()
    })
  })

  it('shows Add Repository button', () => {
    render(<RepositoriesSection />)
    expect(screen.getByText(/Add Repository/)).toBeInTheDocument()
  })

  it('renders repo list from settings', async () => {
    vi.mocked(window.api.settings.getJson).mockResolvedValue([
      { name: 'my-repo', localPath: '/home/user/my-repo', githubOwner: 'acme', githubRepo: 'my-repo' },
    ])
    render(<RepositoriesSection />)
    await waitFor(() => {
      expect(screen.getByText('my-repo')).toBeInTheDocument()
      expect(screen.getByText('/home/user/my-repo')).toBeInTheDocument()
      expect(screen.getByText('acme/my-repo')).toBeInTheDocument()
    })
  })

  it('shows add form when Add Repository is clicked', async () => {
    const user = userEvent.setup()
    render(<RepositoriesSection />)
    await user.click(screen.getByText(/Add Repository/))
    expect(screen.getByPlaceholderText('Name')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Local path')).toBeInTheDocument()
  })
})
