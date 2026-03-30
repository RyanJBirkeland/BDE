import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { CrossWindowDropOverlay } from '../CrossWindowDropOverlay'

// ---------------------------------------------------------------------------
// Helper: inject a fake panel element into the document
// ---------------------------------------------------------------------------

function injectPanel(panelId: string, rect: Partial<DOMRect>): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('data-panel-id', panelId)
  document.body.appendChild(el)
  el.getBoundingClientRect = () => ({
    left: rect.left ?? 0,
    top: rect.top ?? 0,
    right: (rect.left ?? 0) + (rect.width ?? 400),
    bottom: (rect.top ?? 0) + (rect.height ?? 300),
    width: rect.width ?? 400,
    height: rect.height ?? 300,
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    toJSON: () => ({})
  })
  return el
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CrossWindowDropOverlay', () => {
  const onDrop = vi.fn()

  beforeEach(() => {
    onDrop.mockReset()
    // Clean up any injected panels
    document.querySelectorAll('[data-panel-id]').forEach((el) => el.remove())
  })

  it('renders nothing when active=false', () => {
    const { queryByTestId } = render(
      <CrossWindowDropOverlay
        active={false}
        localX={100}
        localY={100}
        viewKey="agents"
        onDrop={onDrop}
      />
    )
    expect(queryByTestId('cross-window-drop-overlay')).toBeNull()
  })

  it('renders the overlay div when active=true', () => {
    const { getByTestId } = render(
      <CrossWindowDropOverlay
        active={true}
        localX={100}
        localY={100}
        viewKey="agents"
        onDrop={onDrop}
      />
    )
    expect(getByTestId('cross-window-drop-overlay')).toBeTruthy()
  })

  it('overlay has correct fixed-position styles', () => {
    const { getByTestId } = render(
      <CrossWindowDropOverlay
        active={true}
        localX={0}
        localY={0}
        viewKey="agents"
        onDrop={onDrop}
      />
    )
    const overlay = getByTestId('cross-window-drop-overlay')
    expect(overlay.style.position).toBe('fixed')
    expect(overlay.style.cursor).toBe('crosshair')
    expect(overlay.style.pointerEvents).toBe('all')
  })

  it('calls onDrop with panelId and zone on pointerup when cursor is over a panel', async () => {
    injectPanel('panel-1', { left: 0, top: 0, width: 400, height: 300 })

    const { getByTestId } = render(
      <CrossWindowDropOverlay
        active={true}
        localX={200}
        localY={150}
        viewKey="agents"
        onDrop={onDrop}
      />
    )

    const overlay = getByTestId('cross-window-drop-overlay')
    await act(async () => {
      fireEvent.pointerUp(overlay)
    })

    expect(onDrop).toHaveBeenCalledTimes(1)
    expect(onDrop.mock.calls[0][0]).toBe('panel-1')
    expect(['top', 'bottom', 'left', 'right', 'center']).toContain(onDrop.mock.calls[0][1])
  })

  it('calls onDrop with zone=center when cursor is in center of panel', async () => {
    injectPanel('panel-center', { left: 0, top: 0, width: 400, height: 300 })

    const { getByTestId } = render(
      <CrossWindowDropOverlay
        active={true}
        localX={200}
        localY={150}
        viewKey="agents"
        onDrop={onDrop}
      />
    )

    await act(async () => {
      fireEvent.pointerUp(getByTestId('cross-window-drop-overlay'))
    })

    expect(onDrop.mock.calls[0][1]).toBe('center')
  })

  it('does not call onDrop when cursor is not over any panel', async () => {
    // No panels injected

    const { getByTestId } = render(
      <CrossWindowDropOverlay
        active={true}
        localX={200}
        localY={150}
        viewKey="agents"
        onDrop={onDrop}
      />
    )

    await act(async () => {
      fireEvent.pointerUp(getByTestId('cross-window-drop-overlay'))
    })

    expect(onDrop).not.toHaveBeenCalled()
  })

  it('shows zone highlight when cursor is over a panel', () => {
    injectPanel('panel-hl', { left: 0, top: 0, width: 400, height: 300 })

    const { getByTestId } = render(
      <CrossWindowDropOverlay
        active={true}
        localX={200}
        localY={150}
        viewKey="agents"
        onDrop={onDrop}
      />
    )

    expect(getByTestId('drop-zone-highlight')).toBeTruthy()
  })

  it('does not show zone highlight when cursor is not over any panel', () => {
    const { queryByTestId } = render(
      <CrossWindowDropOverlay
        active={true}
        localX={9999}
        localY={9999}
        viewKey="agents"
        onDrop={onDrop}
      />
    )

    expect(queryByTestId('drop-zone-highlight')).toBeNull()
  })

  it('updates hit info when localX/localY change via prop update', async () => {
    injectPanel('panel-move', { left: 500, top: 500, width: 400, height: 300 })

    const { rerender, queryByTestId } = render(
      <CrossWindowDropOverlay
        active={true}
        localX={100}
        localY={100}
        viewKey="agents"
        onDrop={onDrop}
      />
    )

    // Not over panel initially
    expect(queryByTestId('drop-zone-highlight')).toBeNull()

    await act(async () => {
      rerender(
        <CrossWindowDropOverlay
          active={true}
          localX={700}
          localY={650}
          viewKey="agents"
          onDrop={onDrop}
        />
      )
    })

    // Now over panel
    expect(queryByTestId('drop-zone-highlight')).toBeTruthy()
  })
})
