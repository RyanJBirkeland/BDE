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

  it('marks the Pipeline row as active and the others as not-yet-routed', () => {
    render(<ModelsSection />)
    const pipelineRow = screen.getByTestId('models-row-pipeline')
    expect(pipelineRow).not.toHaveAttribute('aria-disabled', 'true')

    const synthRow = screen.getByTestId('models-row-synthesizer')
    expect(synthRow).toHaveAttribute('aria-disabled', 'true')

    const notRoutedNotes = screen.getAllByText(/Not yet routed/i)
    expect(notRoutedNotes.length).toBeGreaterThanOrEqual(5)
  })

  it('renders card headings for Active routing and Not yet routed', () => {
    render(<ModelsSection />)
    expect(screen.getByText('Active routing')).toBeInTheDocument()
    expect(screen.getByText('Not yet routed')).toBeInTheDocument()
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
    expect(options).toEqual([
      'claude-sonnet-4-5',
      'claude-opus-4-7',
      'claude-haiku-4-5'
    ])
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

  it('switches back to Claude resets model to claude-sonnet-4-5', async () => {
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
      expect(select.value).toBe('claude-sonnet-4-5')
    })
  })

  it('disables all controls on a Not-yet-routed row', () => {
    render(<ModelsSection />)
    const synthRow = screen.getByTestId('models-row-synthesizer')
    const buttons = synthRow.querySelectorAll('button[role="radio"]')
    buttons.forEach((btn) => expect(btn).toBeDisabled())
    const select = synthRow.querySelector('select') as HTMLSelectElement | null
    if (select) expect(select).toBeDisabled()
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
          synthesizer: { backend: 'claude', model: 'claude-sonnet-4-5' },
          localEndpoint: 'http://localhost:1234/v1'
        })
      )
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
    })
  })
})
