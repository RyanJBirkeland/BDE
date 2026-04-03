/**
 * SettingsCard — reusable card wrapper for settings sections.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { SettingsCard } from '../SettingsCard'

describe('SettingsCard', () => {
  it('renders title and children', () => {
    render(
      <SettingsCard title="My Card">
        <div>Card body</div>
      </SettingsCard>
    )
    expect(screen.getByText('My Card')).toBeInTheDocument()
    expect(screen.getByText('Card body')).toBeInTheDocument()
  })

  it('renders subtitle when provided', () => {
    render(
      <SettingsCard title="My Card" subtitle="A helpful subtitle">
        <div>body</div>
      </SettingsCard>
    )
    expect(screen.getByText('A helpful subtitle')).toBeInTheDocument()
  })

  it('renders status pill when provided', () => {
    render(
      <SettingsCard title="My Card" status={{ label: 'Connected', variant: 'success' }}>
        <div>body</div>
      </SettingsCard>
    )
    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  it('renders footer when provided', () => {
    render(
      <SettingsCard title="My Card" footer={<div>Footer content</div>}>
        <div>body</div>
      </SettingsCard>
    )
    expect(screen.getByText('Footer content')).toBeInTheDocument()
  })

  it('renders icon when provided', () => {
    render(
      <SettingsCard title="My Card" icon={<span data-testid="card-icon">icon</span>}>
        <div>body</div>
      </SettingsCard>
    )
    expect(screen.getByTestId('card-icon')).toBeInTheDocument()
  })

  it('applies full-bleed class when noPadding is true', () => {
    const { container } = render(
      <SettingsCard title="My Card" noPadding>
        <div>body</div>
      </SettingsCard>
    )
    const card = container.querySelector('.stg-card')
    expect(card).toHaveClass('stg-card--full-bleed')
  })

  it('does not apply full-bleed class when noPadding is false', () => {
    const { container } = render(
      <SettingsCard title="My Card" noPadding={false}>
        <div>body</div>
      </SettingsCard>
    )
    const card = container.querySelector('.stg-card')
    expect(card).not.toHaveClass('stg-card--full-bleed')
  })
})
