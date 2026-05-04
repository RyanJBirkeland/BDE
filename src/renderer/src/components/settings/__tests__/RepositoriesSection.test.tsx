/**
 * RepositoriesSection — repo list CRUD tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(window.api.settings.getJson).mockResolvedValue(null)
  vi.mocked(window.api.settings.setJson).mockResolvedValue(undefined)
  vi.mocked(window.api.fs.openDirDialog).mockResolvedValue(null)
  vi.mocked(window.api.git.detectRemote).mockResolvedValue({
    isGitRepo: true,
    owner: undefined,
    repo: undefined
  })
})

import { RepositoriesSection } from '../RepositoriesSection'

describe('RepositoriesSection', () => {
  it('renders with no section heading (uses SettingsCard pattern)', () => {
    render(<RepositoriesSection />)
    expect(screen.getByText(/Add Repository/)).toBeInTheDocument()
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
      {
        name: 'my-repo',
        localPath: '/home/user/my-repo',
        githubOwner: 'acme',
        githubRepo: 'my-repo'
      }
    ])
    render(<RepositoriesSection />)
    await waitFor(() => {
      expect(screen.getByText('my-repo')).toBeInTheDocument()
      expect(screen.getByText('/home/user/my-repo')).toBeInTheDocument()
      expect(screen.getByText('acme/my-repo')).toBeInTheDocument()
    })
  })

  it('shows manual add form when Manual button is clicked', async () => {
    const user = userEvent.setup()
    render(<RepositoriesSection />)
    await user.click(screen.getByText('Manual'))
    expect(screen.getByPlaceholderText('Name')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Local path')).toBeInTheDocument()
  })

  it('fills add form and Save calls setJson with new repo array', async () => {
    const user = userEvent.setup()
    render(<RepositoriesSection />)

    await waitFor(() => {
      expect(screen.getByText('No repositories configured')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Manual'))

    await user.type(screen.getByPlaceholderText('Name'), 'my-project')
    await user.type(screen.getByPlaceholderText('Local path'), '/home/user/my-project')
    await user.type(screen.getByPlaceholderText('GitHub owner (optional)'), 'acme')
    await user.type(screen.getByPlaceholderText('GitHub repo (optional)'), 'my-project')

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(window.api.settings.setJson).toHaveBeenCalledWith(
        'repos',
        expect.arrayContaining([
          expect.objectContaining({
            name: 'my-project',
            localPath: '/home/user/my-project',
            githubOwner: 'acme',
            githubRepo: 'my-project'
          })
        ])
      )
    })
  })

  it('deletes a repo and saves updated array without the deleted entry', async () => {
    vi.mocked(window.api.settings.getJson).mockResolvedValue([
      {
        name: 'keep-me',
        localPath: '/path/keep',
        githubOwner: 'org',
        githubRepo: 'keep-me',
        color: '#6C8EEF'
      },
      {
        name: 'delete-me',
        localPath: '/path/delete',
        githubOwner: 'org',
        githubRepo: 'delete-me',
        color: '#00D37F'
      }
    ])

    const user = userEvent.setup()
    render(<RepositoriesSection />)

    await waitFor(() => {
      expect(screen.getByText('delete-me')).toBeInTheDocument()
    })

    // Get all remove buttons and click the one for 'delete-me' (second row)
    const removeButtons = screen.getAllByTitle('Remove repository')
    await user.click(removeButtons[1])

    // Confirm the deletion in the confirmation dialog
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /^remove$/i }))

    await waitFor(() => {
      expect(window.api.settings.setJson).toHaveBeenCalledWith(
        'repos',
        expect.not.arrayContaining([expect.objectContaining({ name: 'delete-me' })])
      )
      expect(window.api.settings.setJson).toHaveBeenCalledWith(
        'repos',
        expect.arrayContaining([expect.objectContaining({ name: 'keep-me' })])
      )
    })
  })

  it('Browse button calls openDirectoryDialog and populates local path field', async () => {
    vi.mocked(window.api.fs.openDirDialog).mockResolvedValue('/picked/path')
    const user = userEvent.setup()
    render(<RepositoriesSection />)

    await user.click(screen.getByText('Manual'))

    const browseButton = screen.getByTitle('Browse')
    await user.click(browseButton)

    await waitFor(() => {
      expect(window.api.fs.openDirDialog).toHaveBeenCalled()
      expect((screen.getByPlaceholderText('Local path') as HTMLInputElement).value).toBe(
        '/picked/path'
      )
    })
  })

  it('renders env vars count badge when repo has envVars', async () => {
    vi.mocked(window.api.settings.getJson).mockResolvedValue([
      {
        name: 'my-repo',
        localPath: '/home/user/my-repo',
        envVars: { NODE_AUTH_TOKEN: 'tok', REGISTRY: 'https://npm.pkg.github.com' }
      }
    ])
    render(<RepositoriesSection />)
    await waitFor(() => {
      expect(screen.getByText(/Env vars \(2\)/)).toBeInTheDocument()
    })
  })

  it('expands env var editor when Env vars button is clicked', async () => {
    vi.mocked(window.api.settings.getJson).mockResolvedValue([
      {
        name: 'my-repo',
        localPath: '/home/user/my-repo',
        envVars: { NODE_AUTH_TOKEN: 'tok123' }
      }
    ])
    render(<RepositoriesSection />)
    await waitFor(() => screen.getByText(/Env vars/))
    await userEvent.click(screen.getByText(/Env vars/))
    expect(screen.getByDisplayValue('NODE_AUTH_TOKEN')).toBeInTheDocument()
    expect(screen.getByDisplayValue('tok123')).toBeInTheDocument()
  })
})
