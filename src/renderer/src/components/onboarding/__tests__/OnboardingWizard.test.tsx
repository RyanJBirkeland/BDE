import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OnboardingWizard } from '../OnboardingWizard'

describe('OnboardingWizard', () => {
  it('renders Welcome step initially', () => {
    render(<OnboardingWizard onComplete={vi.fn()} />)
    expect(screen.getByText(/welcome to bde/i)).toBeInTheDocument()
  })

  it('navigates through steps with Next button', async () => {
    const user = userEvent.setup()
    render(<OnboardingWizard onComplete={vi.fn()} />)

    // Step 1: Welcome
    expect(screen.getByText(/welcome to bde/i)).toBeInTheDocument()

    // Navigate to step 2
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText(/claude authentication/i)).toBeInTheDocument()

    // Navigate to step 3 — wait for auth check to resolve before clicking
    await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled())
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByRole('heading', { name: /git setup/i })).toBeInTheDocument()

    // Navigate to step 4 (GitHub CLI) — wait for git check to resolve
    await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled())
    await user.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /github cli/i })).toBeInTheDocument()
    )

    // Navigate to step 5 (Repositories)
    await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled())
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByRole('heading', { name: /repository configuration/i })).toBeInTheDocument()

    // Step 5 has inline repo-add; "Next" is disabled until a repo is added.
    // Use "Skip for now" to advance to step 6.
    await user.click(screen.getByRole('button', { name: /skip for now/i }))
    expect(screen.getByRole('heading', { name: /you're ready/i })).toBeInTheDocument()
  })

  it('calls onComplete on final step', async () => {
    const onComplete = vi.fn()
    const user = userEvent.setup()
    render(<OnboardingWizard onComplete={onComplete} />)

    // Step 1 (Welcome): click Next immediately
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Step 2 (Auth): wait for check to resolve, then click Next
    await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled())
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Step 3 (Git): wait for check to resolve, then click Next
    await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled())
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Step 4 (GitHub CLI): wait for check to resolve then click Next
    await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled())
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Step 5 (Repositories): inline add form means Next is disabled; use Skip for now.
    await user.click(screen.getByRole('button', { name: /skip for now/i }))

    // Final step — "Explore BDE" when no repos configured (we skipped the repo step).
    // Otherwise the label is "Get Started". Accept either to keep the assertion focused on onComplete.
    const completeBtn = await waitFor(() =>
      screen.getByRole('button', { name: /explore bde|get started/i })
    )
    await user.click(completeBtn)
    expect(onComplete).toHaveBeenCalled()
  })

  it('allows back navigation', async () => {
    const user = userEvent.setup()
    render(<OnboardingWizard onComplete={vi.fn()} />)

    // Go to step 2
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText(/claude authentication/i)).toBeInTheDocument()

    // Go back to step 1
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.getByText(/welcome to bde/i)).toBeInTheDocument()
  })

  it('shows progress indicators for all steps', () => {
    render(<OnboardingWizard onComplete={vi.fn()} />)

    // Should show 6 step indicators (Welcome, Auth, Git, GitHub CLI, Repos, Done)
    const stepIndicators = screen.getAllByTestId(/step-indicator-\d/)
    expect(stepIndicators).toHaveLength(6)
  })

  it('surfaces dialog + progressbar semantics for assistive tech', () => {
    render(<OnboardingWizard onComplete={vi.fn()} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-label', expect.stringMatching(/setup wizard/i))

    const progressbar = screen.getByRole('progressbar')
    expect(progressbar).toHaveAttribute('aria-valuemin', '1')
    expect(progressbar).toHaveAttribute('aria-valuemax', '6')
    expect(progressbar).toHaveAttribute('aria-valuenow', '1')
    expect(progressbar.getAttribute('aria-valuetext')).toMatch(/Step 1 of 6: Welcome/i)
  })

  it('marks the current step with aria-current="step"', () => {
    render(<OnboardingWizard onComplete={vi.fn()} />)
    const indicators = screen.getAllByTestId(/step-indicator-\d/)
    expect(indicators[0]).toHaveAttribute('aria-current', 'step')
    expect(indicators[1]).not.toHaveAttribute('aria-current')
  })

  describe('inline-add-repo happy path', () => {
    beforeEach(() => {
      // Reset and rebuild settings.getJson so the first call (initial check)
      // returns no repos and the second call (during handleAdd) also returns
      // no repos to merge into.
      const api = (globalThis as unknown as { api: Record<string, unknown> }).api
      const settings = api.settings as {
        getJson: ReturnType<typeof vi.fn>
        setJson: ReturnType<typeof vi.fn>
      }
      settings.getJson.mockReset()
      settings.getJson.mockResolvedValue([])
      settings.setJson.mockReset()
      settings.setJson.mockResolvedValue(undefined)

      // Mock gitDetectRemote — RepoStep calls it after a folder is picked.
      ;(api as Record<string, unknown>).gitDetectRemote = vi
        .fn()
        .mockResolvedValue({ isGitRepo: false, owner: null, repo: null })
    })

    it('adds a repo via inline form, enables Next, and advances to DoneStep', async () => {
      const user = userEvent.setup()

      // After Add Repository succeeds, RepoStep re-checks via getJson — return
      // a single repo on subsequent calls so the "configured" state flips.
      const api = (globalThis as unknown as { api: Record<string, unknown> }).api
      const settings = api.settings as {
        getJson: ReturnType<typeof vi.fn>
        setJson: ReturnType<typeof vi.fn>
      }
      let setCalled = false
      settings.setJson.mockImplementation(async () => {
        setCalled = true
      })
      settings.getJson.mockImplementation(async () =>
        setCalled ? [{ name: 'demo', localPath: '/tmp/demo' }] : []
      )

      render(<OnboardingWizard onComplete={vi.fn()} />)

      // Walk to step 5 (Repositories) — Welcome → Auth → Git → GitHub CLI → Repo
      // Step 1 (Welcome)
      await user.click(screen.getByRole('button', { name: /next/i }))
      // Step 2 (Auth): wait for check to resolve
      await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled())
      await user.click(screen.getByRole('button', { name: /next/i }))
      // Step 3 (Git): wait for check to resolve
      await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled())
      await user.click(screen.getByRole('button', { name: /next/i }))
      // GhStep: wait for check to resolve, then advance
      await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled())
      await user.click(screen.getByRole('button', { name: /next/i }))
      expect(screen.getByRole('heading', { name: /repository configuration/i })).toBeInTheDocument()

      // Next is disabled (no repos yet).
      const nextBefore = screen.getByRole('button', { name: /^next$/i })
      expect(nextBefore).toBeDisabled()

      // Fill in the inline form directly (bypass folder browser dialog).
      const nameInput = screen.getByLabelText(/repository name/i)
      const pathInput = screen.getByLabelText(/local path/i)
      await user.type(nameInput, 'demo')
      await user.type(pathInput, '/tmp/demo')

      // Click Add Repository.
      await user.click(screen.getByRole('button', { name: /add repository/i }))

      // settings.setJson should have been called with the new repo.
      await waitFor(() => {
        expect(settings.setJson).toHaveBeenCalledWith(
          'repos',
          expect.arrayContaining([
            expect.objectContaining({ name: 'demo', localPath: '/tmp/demo' })
          ])
        )
      })

      // After re-check, Next should become enabled.
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^next$/i })).not.toBeDisabled()
      })

      // Click Next → DoneStep.
      await user.click(screen.getByRole('button', { name: /^next$/i }))
      expect(screen.getByRole('heading', { name: /you're ready/i })).toBeInTheDocument()
    })
  })
})
