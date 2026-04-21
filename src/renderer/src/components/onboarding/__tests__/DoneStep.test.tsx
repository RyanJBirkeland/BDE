import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DoneStep } from '../steps/DoneStep'

const mockSetField = vi.fn()
const mockSetSpecType = vi.fn()
const mockSetView = vi.fn()

vi.mock('../../../stores/taskWorkbench', () => ({
  useTaskWorkbenchStore: (
    sel: (s: { setField: typeof mockSetField; setSpecType: typeof mockSetSpecType }) => unknown
  ) => sel({ setField: mockSetField, setSpecType: mockSetSpecType })
}))

vi.mock('../../../stores/panelLayout', () => ({
  usePanelLayoutStore: (sel: (s: { setView: typeof mockSetView }) => unknown) =>
    sel({ setView: mockSetView })
}))

const stepProps = {
  onNext: vi.fn(),
  onBack: vi.fn(),
  onComplete: vi.fn(),
  isFirst: false,
  isLast: true
}

describe('DoneStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pre-fills repo from first configured repo when creating first task', async () => {
    const user = userEvent.setup()
    const api = (globalThis as unknown as { api: Record<string, unknown> }).api
    const settings = api.settings as {
      getJson: ReturnType<typeof vi.fn>
      set: ReturnType<typeof vi.fn>
    }

    settings.getJson.mockResolvedValue([
      { name: 'my-project', localPath: '/tmp/my-project', githubOwner: 'me' }
    ])

    render(<DoneStep {...stepProps} />)

    const btn = await screen.findByRole('button', { name: /create your first task/i })
    await user.click(btn)

    await waitFor(() => {
      expect(mockSetField).toHaveBeenCalledWith('repo', 'my-project')
    })
  })

  it('shows Add a repository affordance when no repos are configured', async () => {
    const api = (globalThis as unknown as { api: Record<string, unknown> }).api
    const settings = api.settings as {
      getJson: ReturnType<typeof vi.fn>
      set: ReturnType<typeof vi.fn>
    }

    settings.getJson.mockResolvedValue([])

    render(<DoneStep {...stepProps} />)

    const btn = await waitFor(() => screen.getByRole('button', { name: /add a repository/i }))
    expect(btn).toBeInTheDocument()
    // The "Create your first task" CTA should be absent in the empty state.
    expect(screen.queryByRole('button', { name: /create your first task/i })).toBeNull()
  })

  it('renders a repo picker when multiple repos are configured', async () => {
    const api = (globalThis as unknown as { api: Record<string, unknown> }).api
    const settings = api.settings as {
      getJson: ReturnType<typeof vi.fn>
      set: ReturnType<typeof vi.fn>
    }

    settings.getJson.mockResolvedValue([
      { name: 'project-a', localPath: '/tmp/a', githubOwner: 'me' },
      { name: 'project-b', localPath: '/tmp/b', githubOwner: 'me' }
    ])

    render(<DoneStep {...stepProps} />)

    const select = await waitFor(() => screen.getByLabelText(/Start in repository/i))
    expect(select).toBeInTheDocument()
  })

  it('calls onComplete when Get Started is clicked', async () => {
    const api = (globalThis as unknown as { api: Record<string, unknown> }).api
    const settings = api.settings as {
      getJson: ReturnType<typeof vi.fn>
      set: ReturnType<typeof vi.fn>
    }
    settings.getJson.mockResolvedValue([
      { name: 'my-project', localPath: '/tmp/my-project', githubOwner: 'me' }
    ])
    const user = userEvent.setup()
    const onComplete = vi.fn()
    render(<DoneStep {...stepProps} onComplete={onComplete} />)

    const btn = await screen.findByRole('button', { name: /get started/i })
    await user.click(btn)
    expect(onComplete).toHaveBeenCalled()
  })
})
