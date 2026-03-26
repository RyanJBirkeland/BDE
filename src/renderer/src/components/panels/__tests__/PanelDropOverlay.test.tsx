import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { getDropZone, PanelDropOverlay } from '../PanelDropOverlay'

// ---------------------------------------------------------------------------
// Tests for getDropZone pure function
// ---------------------------------------------------------------------------

const rect = { left: 0, top: 0, width: 400, height: 300 }

describe('getDropZone', () => {
  it('returns top for upper 25%', () => expect(getDropZone(200, 30, rect)).toBe('top'))
  it('returns bottom for lower 25%', () => expect(getDropZone(200, 270, rect)).toBe('bottom'))
  it('returns left for left 25% (mid-height)', () =>
    expect(getDropZone(50, 150, rect)).toBe('left'))
  it('returns right for right 25% (mid-height)', () =>
    expect(getDropZone(350, 150, rect)).toBe('right'))
  it('returns center for middle', () => expect(getDropZone(200, 150, rect)).toBe('center'))
  it('top takes priority over left in top-left corner', () =>
    expect(getDropZone(30, 30, rect)).toBe('top'))
  it('bottom takes priority over right in bottom-right corner', () =>
    expect(getDropZone(370, 270, rect)).toBe('bottom'))

  // Additional boundary tests for branch coverage
  it('returns left when pctY is exactly 0.25 (boundary)', () => {
    expect(getDropZone(50, 75, rect)).toBe('left')
  })
  it('returns right when pctY is exactly 0.75 (boundary)', () => {
    expect(getDropZone(350, 225, rect)).toBe('right')
  })
  it('returns center when pctX is exactly 0.25', () => {
    expect(getDropZone(100, 150, rect)).toBe('center')
  })
  it('returns center when pctX is exactly 0.75', () => {
    expect(getDropZone(300, 150, rect)).toBe('center')
  })
  it('handles non-zero origin rect', () => {
    const offsetRect = { left: 100, top: 50, width: 400, height: 300 }
    expect(getDropZone(150, 200, offsetRect)).toBe('left')
  })
})

// ---------------------------------------------------------------------------
// Tests for PanelDropOverlay component — drag/drop interactions
// ---------------------------------------------------------------------------

function makeDragInit(opts: { panelData?: string } = {}) {
  const store: Record<string, string> = {}
  if (opts.panelData !== undefined) {
    store['application/bde-panel'] = opts.panelData
  }
  return {
    dataTransfer: {
      dropEffect: '' as string,
      getData: (key: string) => store[key] ?? '',
      setData: (key: string, val: string) => {
        store[key] = val
      }
    }
  }
}

describe('PanelDropOverlay component', () => {
  const onDrop = vi.fn()

  beforeEach(() => {
    onDrop.mockReset()
  })

  it('renders a drop target div', () => {
    const { container } = render(<PanelDropOverlay panelId="p1" onDrop={onDrop} />)
    expect(container.firstChild).toBeTruthy()
  })

  it('shows highlight zone on dragOver', () => {
    const { container } = render(<PanelDropOverlay panelId="p1" onDrop={onDrop} />)
    const overlay = container.firstChild as HTMLElement

    fireEvent.dragOver(overlay, makeDragInit())
    // Should show a highlight child div
    expect(overlay.children.length).toBe(1)
  })

  it('removes highlight on dragLeave', () => {
    const { container } = render(<PanelDropOverlay panelId="p1" onDrop={onDrop} />)
    const overlay = container.firstChild as HTMLElement

    fireEvent.dragOver(overlay, makeDragInit())
    expect(overlay.children.length).toBe(1)

    fireEvent.dragLeave(overlay)
    expect(overlay.children.length).toBe(0)
  })

  it('calls onDrop with parsed payload on valid drop', () => {
    const { container } = render(<PanelDropOverlay panelId="p1" onDrop={onDrop} />)
    const overlay = container.firstChild as HTMLElement

    const payload = JSON.stringify({ viewKey: 'editor', sourcePanelId: 'p2', sourceTabIndex: 0 })
    fireEvent.drop(overlay, makeDragInit({ panelData: payload }))

    expect(onDrop).toHaveBeenCalledTimes(1)
    expect(onDrop.mock.calls[0][0]).toBe('p1')
    // Zone is a valid DropZone string
    expect(['top', 'bottom', 'left', 'right', 'center']).toContain(onDrop.mock.calls[0][1])
    expect(onDrop.mock.calls[0][2]).toEqual({
      viewKey: 'editor',
      sourcePanelId: 'p2',
      sourceTabIndex: 0
    })
  })

  it('does not call onDrop when dataTransfer has no panel data', () => {
    const { container } = render(<PanelDropOverlay panelId="p1" onDrop={onDrop} />)
    const overlay = container.firstChild as HTMLElement

    fireEvent.drop(overlay, makeDragInit())
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('does not call onDrop when dataTransfer has invalid JSON', () => {
    const { container } = render(<PanelDropOverlay panelId="p1" onDrop={onDrop} />)
    const overlay = container.firstChild as HTMLElement

    fireEvent.drop(overlay, makeDragInit({ panelData: '{bad' }))
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('passes panelId to onDrop callback', () => {
    const { container } = render(<PanelDropOverlay panelId="panel-abc" onDrop={onDrop} />)
    const overlay = container.firstChild as HTMLElement

    fireEvent.drop(overlay, makeDragInit({ panelData: JSON.stringify({ viewKey: 'v' }) }))
    expect(onDrop).toHaveBeenCalledTimes(1)
    expect(onDrop.mock.calls[0][0]).toBe('panel-abc')
  })

  it('drop parses payload with only viewKey', () => {
    const { container } = render(<PanelDropOverlay panelId="p1" onDrop={onDrop} />)
    const overlay = container.firstChild as HTMLElement

    fireEvent.drop(overlay, makeDragInit({ panelData: JSON.stringify({ viewKey: 'terminal' }) }))
    expect(onDrop.mock.calls[0][2]).toEqual({ viewKey: 'terminal' })
  })

  it('drop parses payload with all optional fields', () => {
    const { container } = render(<PanelDropOverlay panelId="p1" onDrop={onDrop} />)
    const overlay = container.firstChild as HTMLElement

    const data = { viewKey: 'chat', sourcePanelId: 'p99', sourceTabIndex: 3 }
    fireEvent.drop(overlay, makeDragInit({ panelData: JSON.stringify(data) }))
    expect(onDrop.mock.calls[0][2]).toEqual(data)
  })
})
