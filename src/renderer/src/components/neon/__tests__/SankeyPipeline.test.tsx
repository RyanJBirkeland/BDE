import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { formatCount, STAGE_CONFIG, STAGE_TO_FILTER } from '../sankey-utils'
import { SankeyPipeline } from '../SankeyPipeline'

const defaultStages = {
  queued: 5, active: 3, review: 2, done: 12, blocked: 1, failed: 2,
}

describe('SankeyPipeline', () => {
  it('renders all 6 stage nodes', () => {
    const { container } = render(<SankeyPipeline stages={defaultStages} />)
    const nodes = container.querySelectorAll('[data-role="sankey-node"]')
    expect(nodes).toHaveLength(6)
  })

  it('displays correct counts for each stage', () => {
    render(<SankeyPipeline stages={defaultStages} />)
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('displays stage labels', () => {
    render(<SankeyPipeline stages={defaultStages} />)
    expect(screen.getByText('QUEUED')).toBeInTheDocument()
    expect(screen.getByText('ACTIVE')).toBeInTheDocument()
    expect(screen.getByText('REVIEW')).toBeInTheDocument()
    expect(screen.getByText('DONE')).toBeInTheDocument()
    expect(screen.getByText('BLOCKED')).toBeInTheDocument()
    expect(screen.getByText('FAILED')).toBeInTheDocument()
  })

  it('renders flow paths', () => {
    const { container } = render(<SankeyPipeline stages={defaultStages} />)
    const mainPaths = container.querySelectorAll('[data-role="sankey-flow-main"]')
    const branchPaths = container.querySelectorAll('[data-role="sankey-flow-branch"]')
    expect(mainPaths.length).toBe(3)
    expect(branchPaths.length).toBe(3)
  })

  it('calls onStageClick with correct StatusFilter', () => {
    const onClick = vi.fn()
    render(<SankeyPipeline stages={defaultStages} onStageClick={onClick} />)
    const queuedNode = screen.getByText('QUEUED').closest('[data-role="sankey-node"]')!
    fireEvent.click(queuedNode)
    expect(onClick).toHaveBeenCalledWith('todo')
  })

  it('handles keyboard activation on nodes', () => {
    const onClick = vi.fn()
    render(<SankeyPipeline stages={defaultStages} onStageClick={onClick} />)
    const activeNode = screen.getByText('ACTIVE').closest('[data-role="sankey-node"]')!
    fireEvent.keyDown(activeNode, { key: 'Enter' })
    expect(onClick).toHaveBeenCalledWith('in-progress')
  })

  it('applies custom className', () => {
    const { container } = render(
      <SankeyPipeline stages={defaultStages} className="my-custom" />
    )
    expect(container.firstChild).toHaveClass('my-custom')
  })

  it('formats large counts with abbreviation', () => {
    render(<SankeyPipeline stages={{ ...defaultStages, done: 1234 }} />)
    expect(screen.getByText('1.2k')).toBeInTheDocument()
  })

  it('renders aria-labels on nodes', () => {
    const { container } = render(<SankeyPipeline stages={defaultStages} />)
    const activeNode = container.querySelector('[data-stage="active"]')
    expect(activeNode?.getAttribute('aria-label')).toContain('3 active')
  })

  it('renders all counts as zero without crashing', () => {
    const zeros = { queued: 0, active: 0, review: 0, done: 0, blocked: 0, failed: 0 }
    const { container } = render(<SankeyPipeline stages={zeros} />)
    const nodes = container.querySelectorAll('[data-role="sankey-node"]')
    expect(nodes).toHaveLength(6)
  })
})

describe('SankeyPipeline particles', () => {
  it('renders ambient particles when animated', () => {
    const { container } = render(<SankeyPipeline stages={defaultStages} />)
    const particles = container.querySelectorAll('.sankey-particle')
    expect(particles.length).toBeGreaterThanOrEqual(2)
  })

  it('hides particles when animated=false', () => {
    const { container } = render(
      <SankeyPipeline stages={defaultStages} animated={false} />
    )
    const particles = container.querySelectorAll('.sankey-particle')
    expect(particles).toHaveLength(0)
  })
})

describe('SankeyPipeline transitions', () => {
  it('detects count changes between renders', () => {
    const { container, rerender } = render(
      <SankeyPipeline stages={{ ...defaultStages, queued: 5 }} />
    )
    act(() => {
      rerender(
        <SankeyPipeline stages={{ ...defaultStages, queued: 4, active: 4 }} />
      )
    })
    // Active stage node should now show count 4
    const activeNode = container.querySelector('[data-stage="active"]')
    expect(activeNode?.textContent).toContain('4')
  })

  it('adds ripple element to destination node on count increase', () => {
    const { container, rerender } = render(
      <SankeyPipeline stages={defaultStages} />
    )
    act(() => {
      rerender(
        <SankeyPipeline stages={{ ...defaultStages, active: 4 }} />
      )
    })
    const ripple = container.querySelector('.sankey-ripple')
    expect(ripple).toBeInTheDocument()
  })
})

describe('sankey-utils', () => {
  describe('formatCount', () => {
    it('returns number as string for counts under 1000', () => {
      expect(formatCount(0)).toBe('0')
      expect(formatCount(42)).toBe('42')
      expect(formatCount(999)).toBe('999')
    })

    it('abbreviates counts of 1000+', () => {
      expect(formatCount(1000)).toBe('1.0k')
      expect(formatCount(1234)).toBe('1.2k')
      expect(formatCount(9999)).toBe('10.0k')
    })
  })

  describe('STAGE_CONFIG', () => {
    it('has entries for all 6 stages', () => {
      expect(Object.keys(STAGE_CONFIG)).toEqual(
        expect.arrayContaining(['queued', 'active', 'review', 'done', 'blocked', 'failed'])
      )
      expect(Object.keys(STAGE_CONFIG)).toHaveLength(6)
    })

    it('each stage has accent and label', () => {
      for (const config of Object.values(STAGE_CONFIG)) {
        expect(config).toHaveProperty('accent')
        expect(config).toHaveProperty('label')
      }
    })
  })

  describe('STAGE_TO_FILTER', () => {
    it('maps stage keys to StatusFilter values', () => {
      expect(STAGE_TO_FILTER.queued).toBe('todo')
      expect(STAGE_TO_FILTER.active).toBe('in-progress')
      expect(STAGE_TO_FILTER.review).toBe('awaiting-review')
      expect(STAGE_TO_FILTER.done).toBe('done')
      expect(STAGE_TO_FILTER.blocked).toBe('blocked')
      expect(STAGE_TO_FILTER.failed).toBe('failed')
    })
  })
})
