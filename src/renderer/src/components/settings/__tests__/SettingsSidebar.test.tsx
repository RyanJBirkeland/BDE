/**
 * SettingsSidebar — categorized sidebar navigation tests.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, Shield, GitFork } from 'lucide-react'

import { SettingsSidebar } from '../SettingsSidebar'
import type { SettingsSection } from '../SettingsSidebar'

const sections: SettingsSection[] = [
  { id: 'connections', label: 'Connections', icon: Link, category: 'Account' },
  { id: 'security', label: 'Security', icon: Shield, category: 'Account' },
  { id: 'repos', label: 'Repositories', icon: GitFork, category: 'Projects' },
]

describe('SettingsSidebar', () => {
  it('renders category headers', () => {
    render(<SettingsSidebar sections={sections} activeId="connections" onSelect={vi.fn()} />)
    expect(screen.getByText('Account')).toBeInTheDocument()
    expect(screen.getByText('Projects')).toBeInTheDocument()
  })

  it('renders all section items', () => {
    render(<SettingsSidebar sections={sections} activeId="connections" onSelect={vi.fn()} />)
    expect(screen.getByText('Connections')).toBeInTheDocument()
    expect(screen.getByText('Security')).toBeInTheDocument()
    expect(screen.getByText('Repositories')).toBeInTheDocument()
  })

  it('marks active item with aria-current="page"', () => {
    render(<SettingsSidebar sections={sections} activeId="security" onSelect={vi.fn()} />)
    const activeItem = screen.getByText('Security').closest('[role="link"]')
    expect(activeItem).toHaveAttribute('aria-current', 'page')

    const inactiveItem = screen.getByText('Connections').closest('[role="link"]')
    expect(inactiveItem).not.toHaveAttribute('aria-current')
  })

  it('calls onSelect when item clicked', async () => {
    const onSelect = vi.fn()
    render(<SettingsSidebar sections={sections} activeId="connections" onSelect={onSelect} />)
    await userEvent.click(screen.getByText('Repositories'))
    expect(onSelect).toHaveBeenCalledWith('repos')
  })

  it('supports ArrowDown keyboard navigation', async () => {
    const onSelect = vi.fn()
    render(<SettingsSidebar sections={sections} activeId="connections" onSelect={onSelect} />)
    const activeItem = screen.getByText('Connections').closest('[role="link"]') as HTMLElement
    activeItem.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(onSelect).toHaveBeenCalledWith('security')
  })

  it('navigates across category boundaries with ArrowDown', async () => {
    const onSelect = vi.fn()
    render(<SettingsSidebar sections={sections} activeId="security" onSelect={onSelect} />)
    const securityItem = screen.getByText('Security').closest('[role="link"]') as HTMLElement
    securityItem.focus()
    await userEvent.keyboard('{ArrowDown}')
    // "Security" is the last item in "Account" category; ArrowDown should jump to "Repositories" in "Projects"
    expect(onSelect).toHaveBeenCalledWith('repos')
  })
})
