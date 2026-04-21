/**
 * ModelsSection — per-agent-type backend + model picker UI.
 * Loads `agents.backendConfig` on mount; composes the full BackendSettings
 * object on save.
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
})

import { ModelsSection } from '../ModelsSection'

describe('ModelsSection — scaffold', () => {
  it('renders the Local backend heading', () => {
    render(<ModelsSection />)
    expect(screen.getByText('Local backend')).toBeInTheDocument()
  })

  it('renders the endpoint text input with the default placeholder', () => {
    render(<ModelsSection />)
    const input = screen.getByPlaceholderText('http://localhost:1234/v1')
    expect(input).toBeInTheDocument()
  })

  it('populates the endpoint from loaded settings', async () => {
    vi.mocked(window.api.settings.getJson).mockResolvedValue({
      pipeline: { backend: 'claude', model: 'claude-sonnet-4-5' },
      synthesizer: { backend: 'claude', model: 'claude-sonnet-4-5' },
      copilot: { backend: 'claude', model: 'claude-sonnet-4-5' },
      assistant: { backend: 'claude', model: 'claude-sonnet-4-5' },
      adhoc: { backend: 'claude', model: 'claude-sonnet-4-5' },
      reviewer: { backend: 'claude', model: 'claude-sonnet-4-5' },
      localEndpoint: 'http://localhost:9999/v1'
    })
    render(<ModelsSection />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('http://localhost:9999/v1')).toBeInTheDocument()
    })
  })
})

describe('ModelsSection — agent type rows', () => {
  it('renders all six agent-type labels', () => {
    render(<ModelsSection />)
    expect(screen.getByText('Pipeline')).toBeInTheDocument()
    expect(screen.getByText('Synthesizer')).toBeInTheDocument()
    expect(screen.getByText('Copilot')).toBeInTheDocument()
    expect(screen.getByText('Assistant')).toBeInTheDocument()
    expect(screen.getByText('Adhoc')).toBeInTheDocument()
    expect(screen.getByText('Reviewer')).toBeInTheDocument()
  })

  it('renders all six agent-type rows in the Active routing card', () => {
    render(<ModelsSection />)
    for (const label of ['Pipeline', 'Synthesizer', 'Copilot', 'Assistant', 'Adhoc', 'Reviewer']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    for (const id of ['pipeline', 'synthesizer', 'copilot', 'assistant', 'adhoc', 'reviewer']) {
      const row = screen.getByTestId(`models-row-${id}`)
      expect(row).not.toHaveAttribute('aria-disabled', 'true')
    }
  })

  it('renders one Active routing card and no Not yet routed card', () => {
    render(<ModelsSection />)
    expect(screen.getByText('Active routing')).toBeInTheDocument()
    expect(screen.queryByText('Not yet routed')).not.toBeInTheDocument()
  })
})

describe('ModelsSection — backend toggle + model picker', () => {
  it('renders a Claude/Local segmented control on the Pipeline row', () => {
    render(<ModelsSection />)
    const pipelineRow = screen.getByTestId('models-row-pipeline')
    const claudeBtn = pipelineRow.querySelector('button[role="radio"][data-value="claude"]')
    const localBtn = pipelineRow.querySelector('button[role="radio"][data-value="local"]')
    expect(claudeBtn).toBeInTheDocument()
    expect(localBtn).toBeInTheDocument()
  })

  it('renders a Claude model select with the three known IDs by default', () => {
    render(<ModelsSection />)
    const pipelineRow = screen.getByTestId('models-row-pipeline')
    const select = pipelineRow.querySelector('select') as HTMLSelectElement
    expect(select).toBeInTheDocument()
    const options = Array.from(select.options).map((o) => o.value)
    expect(options).toEqual(['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-6'])
  })

  it('switches to a free-text input when Local is selected and resets model to empty', async () => {
    const user = userEvent.setup()
    render(<ModelsSection />)
    const pipelineRow = screen.getByTestId('models-row-pipeline')
    const localBtn = pipelineRow.querySelector(
      'button[role="radio"][data-value="local"]'
    ) as HTMLButtonElement
    await user.click(localBtn)

    await waitFor(() => {
      const input = pipelineRow.querySelector(
        'input[placeholder="openai/qwen/qwen3.6-35b-a3b"]'
      ) as HTMLInputElement
      expect(input).toBeInTheDocument()
      expect(input.value).toBe('')
    })
  })

  it('switches back to Claude resets model to claude-sonnet-4-6', async () => {
    const user = userEvent.setup()
    render(<ModelsSection />)
    const pipelineRow = screen.getByTestId('models-row-pipeline')

    const localBtn = pipelineRow.querySelector(
      'button[role="radio"][data-value="local"]'
    ) as HTMLButtonElement
    await user.click(localBtn)

    const claudeBtn = pipelineRow.querySelector(
      'button[role="radio"][data-value="claude"]'
    ) as HTMLButtonElement
    await user.click(claudeBtn)

    await waitFor(() => {
      const select = pipelineRow.querySelector('select') as HTMLSelectElement
      expect(select.value).toBe('claude-sonnet-4-6')
    })
  })

  it('enables the model picker for every row', () => {
    render(<ModelsSection />)
    for (const id of ['pipeline', 'synthesizer', 'copilot', 'assistant', 'adhoc', 'reviewer']) {
      const row = screen.getByTestId(`models-row-${id}`)
      const select = row.querySelector('select') as HTMLSelectElement | null
      expect(select).not.toBeNull()
      expect(select!).not.toBeDisabled()
    }
  })

  it('disables only the Local radio on non-pipeline rows, and leaves Claude enabled', () => {
    render(<ModelsSection />)
    for (const id of ['synthesizer', 'copilot', 'assistant', 'adhoc', 'reviewer']) {
      const row = screen.getByTestId(`models-row-${id}`)
      const claudeBtn = row.querySelector('button[data-value="claude"]') as HTMLButtonElement
      const localBtn = row.querySelector('button[data-value="local"]') as HTMLButtonElement
      expect(claudeBtn).not.toBeDisabled()
      expect(localBtn).toBeDisabled()
    }
    const pipelineRow = screen.getByTestId('models-row-pipeline')
    expect(pipelineRow.querySelector('button[data-value="local"]')).not.toBeDisabled()
  })
})

describe('ModelsSection — save orchestration', () => {
  it('renders a Save button initially disabled', () => {
    render(<ModelsSection />)
    const btn = screen.getByRole('button', { name: /save changes/i })
    expect(btn).toBeDisabled()
  })

  it('enables Save after the user edits the endpoint', async () => {
    const user = userEvent.setup()
    render(<ModelsSection />)
    const endpoint = screen.getByPlaceholderText('http://localhost:1234/v1') as HTMLInputElement
    await user.clear(endpoint)
    await user.type(endpoint, 'http://localhost:4321/v1')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save changes/i })).not.toBeDisabled()
    })
  })

  it('Save calls setJson with the full BackendSettings object once and clears dirty', async () => {
    const user = userEvent.setup()
    render(<ModelsSection />)
    const pipelineRow = screen.getByTestId('models-row-pipeline')
    const localBtn = pipelineRow.querySelector(
      'button[role="radio"][data-value="local"]'
    ) as HTMLButtonElement
    await user.click(localBtn)

    const localInput = pipelineRow.querySelector(
      'input[placeholder="openai/qwen/qwen3.6-35b-a3b"]'
    ) as HTMLInputElement
    await user.type(localInput, 'openai/qwen/qwen3.6-35b-a3b')

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(window.api.settings.setJson).toHaveBeenCalledTimes(1)
      expect(window.api.settings.setJson).toHaveBeenCalledWith(
        'agents.backendConfig',
        expect.objectContaining({
          pipeline: { backend: 'local', model: 'openai/qwen/qwen3.6-35b-a3b' },
          synthesizer: { backend: 'claude', model: 'claude-sonnet-4-6' },
          localEndpoint: 'http://localhost:1234/v1'
        })
      )
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
    })
  })
})

describe('ModelsSection — test connection', () => {
  it('shows success state after a reachable endpoint returns', async () => {
    const user = userEvent.setup()
    vi.mocked(window.api.agents.testLocalEndpoint).mockResolvedValue({
      ok: true,
      latencyMs: 18,
      modelCount: 4
    })

    render(<ModelsSection />)
    await user.click(screen.getByRole('button', { name: /test connection/i }))

    await waitFor(() => {
      expect(screen.getByText(/Reachable — 4 models loaded/i)).toBeInTheDocument()
    })
  })

  it('shows error state when the endpoint is unreachable', async () => {
    const user = userEvent.setup()
    vi.mocked(window.api.agents.testLocalEndpoint).mockResolvedValue({
      ok: false,
      error: 'ECONNREFUSED'
    })

    render(<ModelsSection />)
    await user.click(screen.getByRole('button', { name: /test connection/i }))

    await waitFor(() => {
      expect(screen.getByText(/ECONNREFUSED/i)).toBeInTheDocument()
    })
  })

  it('disables the Test button while the check is in flight', async () => {
    const user = userEvent.setup()
    let resolve: (v: { ok: true; latencyMs: number; modelCount: number }) => void = () => {}
    const pending = new Promise<{ ok: true; latencyMs: number; modelCount: number }>(
      (r) => (resolve = r)
    )
    vi.mocked(window.api.agents.testLocalEndpoint).mockReturnValue(pending)

    render(<ModelsSection />)
    const btn = screen.getByRole('button', { name: /test connection/i })
    await user.click(btn)

    await waitFor(() => {
      expect(btn).toBeDisabled()
    })

    resolve({ ok: true, latencyMs: 1, modelCount: 1 })
  })

  it('clears any stale result when the endpoint is edited', async () => {
    const user = userEvent.setup()
    vi.mocked(window.api.agents.testLocalEndpoint).mockResolvedValue({
      ok: true,
      latencyMs: 5,
      modelCount: 2
    })

    render(<ModelsSection />)
    await user.click(screen.getByRole('button', { name: /test connection/i }))
    await waitFor(() => {
      expect(screen.getByText(/Reachable — 2 models loaded/i)).toBeInTheDocument()
    })

    const endpoint = screen.getByPlaceholderText('http://localhost:1234/v1') as HTMLInputElement
    await user.type(endpoint, 'X')

    await waitFor(() => {
      expect(screen.queryByText(/Reachable — 2 models loaded/i)).toBeNull()
    })
  })
})
