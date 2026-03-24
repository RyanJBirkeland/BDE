import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EditorTabBar } from '../EditorTabBar'

const mockSetActiveTab = vi.fn()
const mockCloseTab = vi.fn()

vi.mock('../../../stores/ide', () => ({
  useIDEStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      openTabs: [
        { id: 'tab-1', filePath: '/project/file.ts', displayName: 'file.ts', language: 'typescript', isDirty: false },
        { id: 'tab-2', filePath: '/project/dirty.ts', displayName: 'dirty.ts', language: 'typescript', isDirty: true },
      ],
      activeTabId: 'tab-1', setActiveTab: mockSetActiveTab, closeTab: mockCloseTab,
    })
  ),
}))

beforeEach(() => { vi.clearAllMocks() })

describe('EditorTabBar', () => {
  it('renders all open tabs', () => {
    render(<EditorTabBar />)
    expect(screen.getByText('file.ts')).toBeInTheDocument()
    expect(screen.getByText('dirty.ts')).toBeInTheDocument()
  })
  it('shows dirty indicator on dirty tabs', () => {
    render(<EditorTabBar />)
    expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument()
  })
  it('calls setActiveTab when tab is clicked', () => {
    render(<EditorTabBar />)
    fireEvent.click(screen.getByText('dirty.ts'))
    expect(mockSetActiveTab).toHaveBeenCalledWith('tab-2')
  })
  it('calls onCloseTab when close button is clicked', () => {
    const onCloseTab = vi.fn()
    render(<EditorTabBar onCloseTab={onCloseTab} />)
    fireEvent.click(screen.getByLabelText('Close file.ts'))
    expect(onCloseTab).toHaveBeenCalledWith('tab-1', false)
  })
  it('has tablist role', () => {
    render(<EditorTabBar />)
    expect(screen.getByRole('tablist', { name: 'Editor tabs' })).toBeInTheDocument()
  })
})
