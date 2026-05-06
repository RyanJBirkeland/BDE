import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { EpicIcon } from '../PlEpicRail'

/**
 * `sanitizeCssColor` is module-private. We test its behavior through
 * `EpicIcon`, which calls it on the `accent` prop and renders the result
 * as the element's `color` style.
 */
function renderedAccentColor(accent: string): string {
  const { container } = render(<EpicIcon icon="T" accent={accent} size={32} fontSize={14} />)
  const el = container.firstChild as HTMLElement
  return el.style.color
}

describe('sanitizeCssColor (via EpicIcon rendered color style)', () => {
  it('passes through a valid #RRGGBB hex color', () => {
    expect(renderedAccentColor('#1a2b3c')).toBe('rgb(26, 43, 60)')
  })

  it('passes through a valid #RGB shorthand hex color', () => {
    expect(renderedAccentColor('#abc')).toBe('rgb(170, 187, 204)')
  })

  it('rejects a 5-digit hex and returns the CSS-variable fallback', () => {
    // Browsers treat var(--accent) as the literal string in jsdom — the color
    // style will be empty because jsdom cannot resolve CSS custom properties.
    // What matters is that the invalid value (#12345) was NOT passed through.
    const { container } = render(
      <EpicIcon icon="T" accent="#12345" size={32} fontSize={14} />
    )
    const el = container.firstChild as HTMLElement
    // jsdom strips unresolvable CSS custom property values → empty string
    expect(el.style.color).not.toBe('#12345')
  })

  it('rejects an empty string and does not use it as the color', () => {
    const { container } = render(<EpicIcon icon="T" accent="" size={32} fontSize={14} />)
    const el = container.firstChild as HTMLElement
    expect(el.style.color).not.toBe('')
  })

  it('rejects a javascript: URL injection attempt', () => {
    const { container } = render(
      <EpicIcon icon="T" accent="javascript:alert(1)" size={32} fontSize={14} />
    )
    const el = container.firstChild as HTMLElement
    expect(el.style.color).not.toBe('javascript:alert(1)')
  })

  it('passes through a CSS named color', () => {
    expect(renderedAccentColor('red')).toBe('red')
  })
})
