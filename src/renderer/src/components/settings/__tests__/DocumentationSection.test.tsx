import { describe, it, expect, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DocumentationSection } from '../DocumentationSection'
import { DOCUMENTATION_TOPICS } from '../../../lib/documentation-data'

beforeAll(() => {
  // IntersectionObserver is not available in jsdom — provide a no-op stub.
  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    configurable: true,
    value: class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  })
})

describe('DocumentationSection', () => {
  it('renders without crashing', () => {
    render(<DocumentationSection />)
  })

  it('shows all topic labels in the sidebar nav', () => {
    render(<DocumentationSection />)
    for (const topic of DOCUMENTATION_TOPICS) {
      expect(screen.getByRole('button', { name: new RegExp(topic.label, 'i') })).toBeInTheDocument()
    }
  })

  it('renders the worked example spec code block', () => {
    render(<DocumentationSection />)
    const elements = screen.getAllByText(/task-tracker-api/i)
    expect(elements.length).toBeGreaterThan(0)
  })

  it('renders pass and fail badges', () => {
    render(<DocumentationSection />)
    const passBadges = screen.getAllByText('PASS')
    const failBadges = screen.getAllByText('FAIL')
    expect(passBadges.length).toBeGreaterThan(0)
    expect(failBadges.length).toBeGreaterThan(0)
  })

  it('renders the agent types table', () => {
    render(<DocumentationSection />)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('Pipeline')).toBeInTheDocument()
    expect(screen.getByText('Synthesizer')).toBeInTheDocument()
  })
})
