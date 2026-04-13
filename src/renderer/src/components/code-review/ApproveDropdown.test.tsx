import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ApproveDropdown } from './ApproveDropdown'

describe('ApproveDropdown', () => {
  const actions = {
    onMergeLocally: vi.fn(),
    onSquashMerge: vi.fn(),
    onCreatePR: vi.fn(),
    onRequestRevision: vi.fn(),
    onDiscard: vi.fn()
  }

  it('opens on click and shows all actions', () => {
    render(<ApproveDropdown {...actions} />)
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    expect(screen.getByRole('menuitem', { name: /merge locally/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /squash/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /create pr/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /request revision/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /discard/i })).toBeInTheDocument()
  })

  it('invokes the selected action and closes on click', () => {
    render(<ApproveDropdown {...actions} />)
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /merge locally/i }))
    expect(actions.onMergeLocally).toHaveBeenCalled()
    expect(screen.queryByRole('menuitem', { name: /squash/i })).toBeNull()
  })

  it('closes on Escape', () => {
    render(<ApproveDropdown {...actions} />)
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menuitem', { name: /squash/i })).toBeNull()
  })

  it('focuses first menuitem on open and returns focus to trigger on Escape', () => {
    render(<ApproveDropdown {...actions} />)
    const trigger = screen.getByRole('button', { name: /approve/i })
    fireEvent.click(trigger)
    const firstItem = screen.getByRole('menuitem', { name: /merge locally/i })
    expect(document.activeElement).toBe(firstItem)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(trigger)
  })

  it('navigates menu items with ArrowDown and ArrowUp', () => {
    render(<ApproveDropdown {...actions} />)
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))

    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /squash/i }))

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /create pr/i }))

    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /squash/i }))
  })
})
