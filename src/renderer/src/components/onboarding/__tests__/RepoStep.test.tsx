import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RepoStep } from '../steps/RepoStep'

const baseProps = {
  onNext: vi.fn(),
  onBack: vi.fn(),
  onComplete: vi.fn(),
  isFirst: false,
  isLast: false
}

type Api = {
  settings: {
    getJson: ReturnType<typeof vi.fn>
    setJson: ReturnType<typeof vi.fn>
  }
  fs: { openDirDialog: ReturnType<typeof vi.fn> }
  git: { detectRemote: ReturnType<typeof vi.fn> }
}

function getApi(): Api {
  return (globalThis as unknown as { api: Api }).api
}

describe('RepoStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const api = getApi()
    api.settings.getJson = vi.fn().mockResolvedValue([])
    api.settings.setJson = vi.fn().mockResolvedValue(undefined)
    api.fs.openDirDialog = vi.fn().mockResolvedValue(null)
    api.git.detectRemote = vi.fn().mockResolvedValue(null)
  })

  it('renders the empty state when no repos configured', async () => {
    render(<RepoStep {...baseProps} />)

    await waitFor(() => {
      expect(screen.getByText(/no repositories configured/i)).toBeInTheDocument()
    })
    // Next is disabled until a repo is configured; Skip for now is available.
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /skip for now/i })).toBeInTheDocument()
  })

  it('enables Next when repos are already configured', async () => {
    const api = getApi()
    api.settings.getJson = vi.fn().mockResolvedValue([{ name: 'bde', localPath: '/path/to/bde' }])
    render(<RepoStep {...baseProps} />)

    await waitFor(() => {
      expect(screen.getByText(/repositories configured/i)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()
  })

  it('populates path and name when Browse picks a directory', async () => {
    const api = getApi()
    api.fs.openDirDialog = vi.fn().mockResolvedValue('/home/user/my-project')
    api.git.detectRemote = vi.fn().mockResolvedValue({ isGitRepo: false, owner: null, repo: null })

    const user = userEvent.setup()
    render(<RepoStep {...baseProps} />)

    await user.click(await screen.findByRole('button', { name: /browse/i }))

    await waitFor(() => {
      expect((screen.getByLabelText('Local path') as HTMLInputElement).value).toBe(
        '/home/user/my-project'
      )
    })
    expect((screen.getByLabelText('Repository name') as HTMLInputElement).value).toBe('my-project')
  })

  it('auto-fills owner/repo when detectRemote returns a git remote', async () => {
    const api = getApi()
    api.fs.openDirDialog = vi.fn().mockResolvedValue('/home/user/my-project')
    api.git.detectRemote = vi
      .fn()
      .mockResolvedValue({ isGitRepo: true, owner: 'acme', repo: 'widget' })

    const user = userEvent.setup()
    render(<RepoStep {...baseProps} />)

    await user.click(await screen.findByRole('button', { name: /browse/i }))

    await waitFor(() => {
      expect((screen.getByLabelText('GitHub owner') as HTMLInputElement).value).toBe('acme')
      expect((screen.getByLabelText('GitHub repo') as HTMLInputElement).value).toBe('widget')
    })
  })

  it('keeps Add disabled until both name and path are filled', async () => {
    const user = userEvent.setup()
    render(<RepoStep {...baseProps} />)

    const addButton = await screen.findByRole('button', { name: /add repository/i })
    expect(addButton).toBeDisabled()

    await user.type(screen.getByLabelText('Repository name'), 'proj')
    expect(addButton).toBeDisabled() // path still empty

    await user.type(screen.getByLabelText('Local path'), '/some/path')
    expect(addButton).not.toBeDisabled()
  })

  it('calls settings.setJson with the new repo when Add is clicked', async () => {
    const api = getApi()
    api.settings.getJson = vi.fn().mockResolvedValue([])
    api.settings.setJson = vi.fn().mockResolvedValue(undefined)

    const user = userEvent.setup()
    render(<RepoStep {...baseProps} />)

    await user.type(await screen.findByLabelText('Repository name'), 'proj')
    await user.type(screen.getByLabelText('Local path'), '/some/path')
    await user.click(screen.getByRole('button', { name: /add repository/i }))

    await waitFor(() => {
      expect(api.settings.setJson).toHaveBeenCalledWith(
        'repos',
        expect.arrayContaining([expect.objectContaining({ name: 'proj', localPath: '/some/path' })])
      )
    })
  })
})
