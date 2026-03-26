import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { useFocusTrap } from '../useFocusTrap'

function createContainer(): HTMLDivElement {
  const container = document.createElement('div')

  const button1 = document.createElement('button')
  button1.textContent = 'First'
  button1.setAttribute('data-testid', 'first')

  const input = document.createElement('input')
  input.setAttribute('data-testid', 'middle')

  const button2 = document.createElement('button')
  button2.textContent = 'Last'
  button2.setAttribute('data-testid', 'last')

  container.appendChild(button1)
  container.appendChild(input)
  container.appendChild(button2)
  document.body.appendChild(container)

  return container
}

describe('useFocusTrap', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = createContainer()
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  it('focuses the first focusable element when activated', () => {
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => {
        const ref = useRef<HTMLDivElement>(container)
        useFocusTrap(ref, active)
      },
      { initialProps: { active: true } }
    )

    const first = container.querySelector<HTMLElement>('[data-testid="first"]')!
    expect(document.activeElement).toBe(first)

    rerender({ active: false })
  })

  it('does not steal focus when inactive', () => {
    const externalButton = document.createElement('button')
    externalButton.textContent = 'Outside'
    document.body.appendChild(externalButton)
    externalButton.focus()

    renderHook(
      ({ active }: { active: boolean }) => {
        const ref = useRef<HTMLDivElement>(container)
        useFocusTrap(ref, active)
      },
      { initialProps: { active: false } }
    )

    expect(document.activeElement).toBe(externalButton)
    document.body.removeChild(externalButton)
  })

  it('wraps Tab from last element to first element', () => {
    renderHook(
      ({ active }: { active: boolean }) => {
        const ref = useRef<HTMLDivElement>(container)
        useFocusTrap(ref, active)
      },
      { initialProps: { active: true } }
    )

    const last = container.querySelector<HTMLElement>('[data-testid="last"]')!
    const first = container.querySelector<HTMLElement>('[data-testid="first"]')!
    last.focus()
    expect(document.activeElement).toBe(last)

    // Simulate Tab keydown
    const tabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true
    })
    const preventDefaultSpy = vi.spyOn(tabEvent, 'preventDefault')
    document.dispatchEvent(tabEvent)

    expect(preventDefaultSpy).toHaveBeenCalled()
    expect(document.activeElement).toBe(first)
  })

  it('wraps Shift+Tab from first element to last element', () => {
    renderHook(
      ({ active }: { active: boolean }) => {
        const ref = useRef<HTMLDivElement>(container)
        useFocusTrap(ref, active)
      },
      { initialProps: { active: true } }
    )

    const first = container.querySelector<HTMLElement>('[data-testid="first"]')!
    const last = container.querySelector<HTMLElement>('[data-testid="last"]')!
    first.focus()
    expect(document.activeElement).toBe(first)

    // Simulate Shift+Tab keydown
    const shiftTabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true
    })
    const preventDefaultSpy = vi.spyOn(shiftTabEvent, 'preventDefault')
    document.dispatchEvent(shiftTabEvent)

    expect(preventDefaultSpy).toHaveBeenCalled()
    expect(document.activeElement).toBe(last)
  })

  it('restores focus to previously focused element when deactivated', () => {
    const externalButton = document.createElement('button')
    externalButton.textContent = 'Outside'
    document.body.appendChild(externalButton)
    externalButton.focus()

    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => {
        const ref = useRef<HTMLDivElement>(container)
        useFocusTrap(ref, active)
      },
      { initialProps: { active: true } }
    )

    // Focus should now be inside the trap
    const first = container.querySelector<HTMLElement>('[data-testid="first"]')!
    expect(document.activeElement).toBe(first)

    // Deactivate
    rerender({ active: false })

    expect(document.activeElement).toBe(externalButton)
    document.body.removeChild(externalButton)
  })
})
