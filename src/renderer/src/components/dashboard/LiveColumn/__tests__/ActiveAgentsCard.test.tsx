import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActiveAgentsCard } from '../ActiveAgentsCard'
import type { ActiveAgent } from '../../hooks/useDashboardData'

function makeAgent(overrides: Partial<ActiveAgent> = {}): ActiveAgent {
  return {
    id: crypto.randomUUID(),
    title: 'Build auth module',
    repo: 'fleet',
    tokens: 1200,
    elapsedMs: 90_000,
    progressPct: 42,
    startedAt: new Date().toISOString(),
    stepDescription: 'Running tests',
    ...overrides
  }
}

const noopProps = {
  agents: [],
  capacity: 2,
  onOpenAgents: vi.fn(),
  onSpawnOne: vi.fn()
}

describe('ActiveAgentsCard', () => {
  describe('empty state', () => {
    it('renders "No agents running" when agents array is empty', () => {
      render(<ActiveAgentsCard {...noopProps} />)
      expect(screen.getByText('No agents running')).toBeInTheDocument()
    })

    it('renders Spawn button in empty state', () => {
      const onSpawnOne = vi.fn()
      render(<ActiveAgentsCard {...noopProps} onSpawnOne={onSpawnOne} />)
      expect(screen.getByRole('button', { name: /Spawn one/i })).toBeInTheDocument()
    })

    it('calls onSpawnOne when Spawn button is clicked', async () => {
      const onSpawnOne = vi.fn()
      render(<ActiveAgentsCard {...noopProps} onSpawnOne={onSpawnOne} />)
      await userEvent.click(screen.getByRole('button', { name: /Spawn one/i }))
      expect(onSpawnOne).toHaveBeenCalled()
    })
  })

  describe('with agents', () => {
    it('renders one list item per agent', () => {
      const agents = [makeAgent({ title: 'Agent One' }), makeAgent({ title: 'Agent Two' })]
      render(<ActiveAgentsCard {...noopProps} agents={agents} />)
      expect(screen.getByText('Agent One')).toBeInTheDocument()
      expect(screen.getByText('Agent Two')).toBeInTheDocument()
    })

    it('does not render empty state when agents are present', () => {
      render(<ActiveAgentsCard {...noopProps} agents={[makeAgent()]} />)
      expect(screen.queryByText('No agents running')).not.toBeInTheDocument()
    })

    it('aria-label for each row contains the agent title (no "undefined" substring)', () => {
      const agent = makeAgent({ title: 'Fix login bug', progressPct: 50 })
      render(<ActiveAgentsCard {...noopProps} agents={[agent]} />)
      const row = screen.getByRole('listitem')
      expect(row).toHaveAttribute('aria-label', expect.stringContaining('Fix login bug'))
      expect(row.getAttribute('aria-label')).not.toContain('undefined')
    })

    it('shows capacity in card header', () => {
      render(<ActiveAgentsCard {...noopProps} agents={[makeAgent()]} capacity={3} />)
      expect(screen.getByText(/1 running · 3 capacity/)).toBeInTheDocument()
    })

    it('calls onOpenAgents when "Open Agents" button is clicked', async () => {
      const onOpenAgents = vi.fn()
      render(
        <ActiveAgentsCard
          agents={[makeAgent()]}
          capacity={2}
          onOpenAgents={onOpenAgents}
          onSpawnOne={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /Open Agents/i }))
      expect(onOpenAgents).toHaveBeenCalled()
    })
  })
})
