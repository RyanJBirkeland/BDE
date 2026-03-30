import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TearoffTabBar } from '../TearoffTabBar'
import type { PanelTab } from '../../../stores/panelLayout'

const tabs: PanelTab[] = [
  { viewKey: 'agents', label: 'Agents' },
  { viewKey: 'ide', label: 'IDE' }
]

describe('TearoffTabBar', () => {
  it('renders all tab labels', () => {
    render(
      <TearoffTabBar tabs={tabs} activeTab={0} onSelectTab={vi.fn()} onCloseTab={vi.fn()} />
    )
    expect(screen.getByText('Agents')).toBeInTheDocument()
    expect(screen.getByText('IDE')).toBeInTheDocument()
  })

  it('renders with role tablist', () => {
    render(
      <TearoffTabBar tabs={tabs} activeTab={0} onSelectTab={vi.fn()} onCloseTab={vi.fn()} />
    )
    expect(screen.getByRole('tablist')).toBeInTheDocument()
  })

  it('applies active class to the active tab', () => {
    const { container } = render(
      <TearoffTabBar tabs={tabs} activeTab={1} onSelectTab={vi.fn()} onCloseTab={vi.fn()} />
    )
    const activeTabs = container.querySelectorAll('.tearoff-tab--active')
    expect(activeTabs).toHaveLength(1)
    expect(activeTabs[0]).toHaveTextContent('IDE')
  })

  it('sets aria-selected on active tab', () => {
    render(
      <TearoffTabBar tabs={tabs} activeTab={0} onSelectTab={vi.fn()} onCloseTab={vi.fn()} />
    )
    const tabEls = screen.getAllByRole('tab')
    expect(tabEls[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabEls[1]).toHaveAttribute('aria-selected', 'false')
  })

  it('calls onSelectTab with correct index when tab is clicked', () => {
    const onSelectTab = vi.fn()
    render(
      <TearoffTabBar tabs={tabs} activeTab={0} onSelectTab={onSelectTab} onCloseTab={vi.fn()} />
    )
    fireEvent.click(screen.getByText('IDE'))
    expect(onSelectTab).toHaveBeenCalledWith(1)
  })

  it('calls onCloseTab with correct index when close button is clicked', () => {
    const onCloseTab = vi.fn()
    render(
      <TearoffTabBar tabs={tabs} activeTab={0} onSelectTab={vi.fn()} onCloseTab={onCloseTab} />
    )
    const closeBtn = screen.getByLabelText('Close IDE')
    fireEvent.click(closeBtn)
    expect(onCloseTab).toHaveBeenCalledWith(1)
  })

  it('does not call onSelectTab when close button is clicked (stopPropagation)', () => {
    const onSelectTab = vi.fn()
    const onCloseTab = vi.fn()
    render(
      <TearoffTabBar
        tabs={tabs}
        activeTab={0}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
      />
    )
    fireEvent.click(screen.getByLabelText('Close Agents'))
    expect(onCloseTab).toHaveBeenCalledTimes(1)
    expect(onSelectTab).not.toHaveBeenCalled()
  })

  it('hides close buttons when only one tab', () => {
    render(
      <TearoffTabBar
        tabs={[{ viewKey: 'agents', label: 'Agents' }]}
        activeTab={0}
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
      />
    )
    expect(screen.queryByLabelText('Close Agents')).not.toBeInTheDocument()
  })

  it('shows close buttons when multiple tabs', () => {
    render(
      <TearoffTabBar tabs={tabs} activeTab={0} onSelectTab={vi.fn()} onCloseTab={vi.fn()} />
    )
    expect(screen.getByLabelText('Close Agents')).toBeInTheDocument()
    expect(screen.getByLabelText('Close IDE')).toBeInTheDocument()
  })
})
