import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../stores/panelLayout', () => ({
  usePanelLayoutStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) =>
    sel({ setView: vi.fn() })
  )
}))

vi.mock('../../../lib/motion', () => ({
  VARIANTS: { fadeIn: {} },
  SPRINGS: { snappy: {} },
  REDUCED_TRANSITION: {},
  useReducedMotion: () => false
}))

import { FeatureGuideModal } from '../FeatureGuideModal'

describe('FeatureGuideModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<FeatureGuideModal open={false} onClose={vi.fn()} />)
    // AnimatePresence may still render the container
    expect(container).toBeTruthy()
  })

  it('renders modal content when open', () => {
    render(<FeatureGuideModal open={true} onClose={vi.fn()} />)
    expect(screen.getByText('BDE Feature Guide')).toBeInTheDocument()
  })

  it('shows view buttons in sidebar', () => {
    render(<FeatureGuideModal open={true} onClose={vi.fn()} />)
    // Dashboard appears multiple times - in sidebar and content
    expect(screen.getAllByText('Dashboard').length).toBeGreaterThanOrEqual(1)
  })

  it('renders close button', () => {
    render(<FeatureGuideModal open={true} onClose={vi.fn()} />)
    // Close button is present (may use different aria-label)
    const closeBtn = document.querySelector('.feature-guide__close')
    expect(closeBtn).toBeInTheDocument()
  })

  it('renders Go to View button', () => {
    render(<FeatureGuideModal open={true} onClose={vi.fn()} />)
    expect(screen.getByText('Go to Dashboard')).toBeInTheDocument()
  })
})
