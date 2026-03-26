import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PipelineFlow, type PipelineStage } from '../PipelineFlow'

const stages: PipelineStage[] = [
  { label: 'queued', count: 4, accent: 'orange' },
  { label: 'active', count: 3, accent: 'cyan' },
  { label: 'review', count: 2, accent: 'blue' }
]

describe('PipelineFlow', () => {
  it('renders all stage labels and counts', () => {
    render(<PipelineFlow stages={stages} />)
    expect(screen.getByText('queued: 4')).toBeInTheDocument()
    expect(screen.getByText('active: 3')).toBeInTheDocument()
    expect(screen.getByText('review: 2')).toBeInTheDocument()
  })

  it('renders arrow separators between stages', () => {
    const { container } = render(<PipelineFlow stages={stages} />)
    const arrows = container.querySelectorAll('[data-role="pipeline-arrow"]')
    expect(arrows).toHaveLength(2)
  })
})
