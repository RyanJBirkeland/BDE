import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Store state
let storeState = {
  showFind: true,
  activeTabId: 'tab-1' as string | null,
  setShowFind: vi.fn(),
}

vi.mock('../../../stores/terminal', () => ({
  useTerminalStore: (selector: (s: unknown) => unknown) => selector(storeState),
}))

// Mock getSearchAddon
const mockFindNext = vi.fn()
const mockFindPrevious = vi.fn()
const mockClearDecorations = vi.fn()
const mockOnDidChangeResults = vi.fn(() => ({ dispose: vi.fn() }))

vi.mock('../TerminalPane', () => ({
  getSearchAddon: () => ({
    findNext: mockFindNext,
    findPrevious: mockFindPrevious,
    clearDecorations: mockClearDecorations,
    onDidChangeResults: mockOnDidChangeResults,
  }),
}))

import { FindBar } from '../FindBar'

describe('FindBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeState = {
      showFind: true,
      activeTabId: 'tab-1',
      setShowFind: vi.fn(),
    }
  })

  it('renders input and buttons when showFind is true', () => {
    render(<FindBar />)
    expect(screen.getByPlaceholderText('Find…')).toBeInTheDocument()
    expect(screen.getByTitle('Previous match (Shift+Enter)')).toBeInTheDocument()
    expect(screen.getByTitle('Next match (Enter)')).toBeInTheDocument()
    expect(screen.getByTitle('Close (Escape)')).toBeInTheDocument()
  })

  it('returns null when showFind is false', () => {
    storeState.showFind = false
    const { container } = render(<FindBar />)
    expect(container.firstChild).toBeNull()
  })

  it('calls setShowFind(false) when close button is clicked', async () => {
    const user = userEvent.setup()
    render(<FindBar />)
    await user.click(screen.getByTitle('Close (Escape)'))
    expect(storeState.setShowFind).toHaveBeenCalledWith(false)
  })

  it('triggers findNext on Enter key', () => {
    render(<FindBar />)
    const input = screen.getByPlaceholderText('Find…')
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockFindNext).toHaveBeenCalledWith('hello')
  })

  it('triggers findPrevious on Shift+Enter', () => {
    render(<FindBar />)
    const input = screen.getByPlaceholderText('Find…')
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(mockFindPrevious).toHaveBeenCalledWith('hello')
  })

  it('calls setShowFind(false) on Escape key in input', () => {
    render(<FindBar />)
    const input = screen.getByPlaceholderText('Find…')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(storeState.setShowFind).toHaveBeenCalledWith(false)
  })

  it('calls findNext on next button click', async () => {
    const user = userEvent.setup()
    render(<FindBar />)
    const input = screen.getByPlaceholderText('Find…')
    fireEvent.change(input, { target: { value: 'test' } })
    await user.click(screen.getByTitle('Next match (Enter)'))
    expect(mockFindNext).toHaveBeenCalledWith('test')
  })

  it('calls findPrevious on previous button click', async () => {
    const user = userEvent.setup()
    render(<FindBar />)
    const input = screen.getByPlaceholderText('Find…')
    fireEvent.change(input, { target: { value: 'test' } })
    await user.click(screen.getByTitle('Previous match (Shift+Enter)'))
    expect(mockFindPrevious).toHaveBeenCalledWith('test')
  })

  it('does not call findNext when query is empty', async () => {
    const user = userEvent.setup()
    render(<FindBar />)
    await user.click(screen.getByTitle('Next match (Enter)'))
    expect(mockFindNext).not.toHaveBeenCalled()
  })

  it('does not call findNext when activeTabId is null', () => {
    storeState.activeTabId = null
    render(<FindBar />)
    const input = screen.getByPlaceholderText('Find…')
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    // Effects guard on !activeTabId, so findNext is never invoked from keyDown handler
    // The search effect also guards, so total calls = 0 from the handler
    // But getSearchAddon mock still returns addon, so the effect fires findNext
    // Actually, with activeTabId null the effects return early, so no calls at all
    expect(mockFindNext).not.toHaveBeenCalled()
  })

  it('shows empty count label when query is empty', () => {
    render(<FindBar />)
    const countEl = document.querySelector('.terminal-find__count')
    expect(countEl?.textContent).toBe('')
  })

  it('shows "No results" when query has text but no matches', () => {
    render(<FindBar />)
    const input = screen.getByPlaceholderText('Find…')
    fireEvent.change(input, { target: { value: 'nomatch' } })
    const countEl = document.querySelector('.terminal-find__count')
    expect(countEl?.textContent).toBe('No results')
  })

  it('calls clearDecorations when query is cleared', () => {
    render(<FindBar />)
    const input = screen.getByPlaceholderText('Find…')
    fireEvent.change(input, { target: { value: 'hello' } })
    mockClearDecorations.mockClear()
    fireEvent.change(input, { target: { value: '' } })
    expect(mockClearDecorations).toHaveBeenCalled()
  })

  it('renders with terminal-find class', () => {
    const { container } = render(<FindBar />)
    expect(container.querySelector('.terminal-find')).toBeInTheDocument()
  })
})
