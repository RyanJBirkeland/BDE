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
  it('renders the Opencode backend heading', () => {
    render(<ModelsSection />)
    expect(screen.getByText('Opencode backend')).toBeInTheDocument()
  })

  it('does not render a Local backend card', () => {
    render(<ModelsSection />)
    expect(screen.queryByText('Local backend')).not.toBeInTheDocument()
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
  it('renders Claude and Opencode radio buttons on the Pipeline row but no Local button', () => {
    render(<ModelsSection />)
    const pipelineRow = screen.getByTestId('models-row-pipeline')
    const claudeBtn = pipelineRow.querySelector('button[role="radio"][data-value="claude"]')
    const opencodeBtn = pipelineRow.querySelector('button[role="radio"][data-value="opencode"]')
    const localBtn = pipelineRow.querySelector('button[role="radio"][data-value="local"]')
    expect(claudeBtn).toBeInTheDocument()
    expect(opencodeBtn).toBeInTheDocument()
    expect(localBtn).not.toBeInTheDocument()
  })

  it('renders a Claude model select with the three known IDs by default', () => {
    render(<ModelsSection />)
    const pipelineRow = screen.getByTestId('models-row-pipeline')
    const select = pipelineRow.querySelector('select') as HTMLSelectElement
    expect(select).toBeInTheDocument()
    const options = Array.from(select.options).map((o) => o.value)
    expect(options).toEqual(['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-6'])
  })

  it('switches to an Opencode model input when Opencode is selected and resets model to empty', async () => {
    const user = userEvent.setup()
    render(<ModelsSection />)
    const pipelineRow = screen.getByTestId('models-row-pipeline')
    const opencodeBtn = pipelineRow.querySelector(
      'button[role="radio"][data-value="opencode"]'
    ) as HTMLButtonElement
    await user.click(opencodeBtn)

    await waitFor(() => {
      const input = pipelineRow.querySelector(
        'input[placeholder="opencode/gpt-5-nano"]'
      ) as HTMLInputElement
      expect(input).toBeInTheDocument()
      expect(input.value).toBe('')
    })
  })

  it('switches back to Claude and resets model to the default Claude model', async () => {
    const user = userEvent.setup()
    render(<ModelsSection />)
    const pipelineRow = screen.getByTestId('models-row-pipeline')

    const opencodeBtn = pipelineRow.querySelector(
      'button[role="radio"][data-value="opencode"]'
    ) as HTMLButtonElement
    await user.click(opencodeBtn)

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

  it('renders an Opencode radio button on the Pipeline row', () => {
    render(<ModelsSection />)
    const pipelineRow = screen.getByTestId('models-row-pipeline')
    const opencodeBtn = pipelineRow.querySelector(
      'button[role="radio"][data-value="opencode"]'
    ) as HTMLButtonElement
    expect(opencodeBtn).toBeInTheDocument()
    expect(opencodeBtn).not.toBeDisabled()
  })

  it('disables the Opencode radio on Synthesizer, Copilot, and Reviewer rows', () => {
    render(<ModelsSection />)
    for (const id of ['synthesizer', 'copilot', 'reviewer']) {
      const row = screen.getByTestId(`models-row-${id}`)
      const opencodeBtn = row.querySelector('button[data-value="opencode"]') as HTMLButtonElement
      expect(opencodeBtn).toBeDisabled()
    }
  })

  it('enables the Opencode radio on assistant and adhoc rows', () => {
    render(<ModelsSection />)
    for (const id of ['assistant', 'adhoc']) {
      const row = screen.getByTestId(`models-row-${id}`)
      const opencodeBtn = row.querySelector('button[data-value="opencode"]') as HTMLButtonElement
      expect(opencodeBtn).not.toBeDisabled()
    }
  })

  it('switches to an Opencode model input with the correct placeholder when Opencode is selected', async () => {
    const user = userEvent.setup()
    render(<ModelsSection />)
    const pipelineRow = screen.getByTestId('models-row-pipeline')
    const opencodeBtn = pipelineRow.querySelector(
      'button[role="radio"][data-value="opencode"]'
    ) as HTMLButtonElement
    await user.click(opencodeBtn)

    await waitFor(() => {
      const input = pipelineRow.querySelector(
        'input[placeholder="opencode/gpt-5-nano"]'
      ) as HTMLInputElement
      expect(input).toBeInTheDocument()
      expect(input.value).toBe('')
    })
  })
})

describe('ModelsSection — save orchestration', () => {
  it('renders a Save button initially disabled', () => {
    render(<ModelsSection />)
    const btn = screen.getByRole('button', { name: /save changes/i })
    expect(btn).toBeDisabled()
  })

  it('enables Save after the user edits the opencode executable', async () => {
    const user = userEvent.setup()
    render(<ModelsSection />)
    const executable = screen.getByPlaceholderText('opencode') as HTMLInputElement
    await user.clear(executable)
    await user.type(executable, '/usr/local/bin/opencode')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save changes/i })).not.toBeDisabled()
    })
  })

  it('Save calls setJson with the full BackendSettings object once and clears dirty', async () => {
    const user = userEvent.setup()
    render(<ModelsSection />)
    const pipelineRow = screen.getByTestId('models-row-pipeline')
    const opencodeBtn = pipelineRow.querySelector(
      'button[role="radio"][data-value="opencode"]'
    ) as HTMLButtonElement
    await user.click(opencodeBtn)

    const opencodeInput = pipelineRow.querySelector(
      'input[placeholder="opencode/gpt-5-nano"]'
    ) as HTMLInputElement
    await user.type(opencodeInput, 'opencode/claude-sonnet-4-5')

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(window.api.settings.setJson).toHaveBeenCalledTimes(1)
      expect(window.api.settings.setJson).toHaveBeenCalledWith(
        'agents.backendConfig',
        expect.objectContaining({
          pipeline: { backend: 'opencode', model: 'opencode/claude-sonnet-4-5' },
          synthesizer: { backend: 'claude', model: 'claude-sonnet-4-6' }
        })
      )
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
    })
  })
})
