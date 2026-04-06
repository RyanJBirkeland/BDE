import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Divider } from '../Divider'

describe('Divider', () => {
  it('renders horizontal divider by default', () => {
    const { container } = render(<Divider />)
    expect(container.firstChild).toHaveClass('bde-divider--horizontal')
  })

  it('renders vertical divider', () => {
    const { container } = render(<Divider direction="vertical" />)
    expect(container.firstChild).toHaveClass('bde-divider--vertical')
  })
})
