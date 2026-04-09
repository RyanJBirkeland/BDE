/**
 * Regression tests for .panel-separator hit-area dimensions.
 *
 * Root cause (fixed): react-resizable-panels Separator renders with
 * flexBasis:"auto", flexGrow:0, flexShrink:0 and no default width/height.
 * Without an explicit width in CSS the hit area is 0px — panels appear locked
 * at their default size because there's nothing to grab and drag.
 *
 * These tests guard against that regression by parsing the actual CSS source.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const CSS_PATH = path.resolve(__dirname, '../design-system.css')

function extractRuleBody(css: string, selector: string): string {
  // Match `selector {` — the selector must be followed only by optional
  // whitespace then `{`, so `.panel-separator {` doesn't match
  // `.panel-separator:hover {`.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`)
  const match = css.match(re)
  return match ? match[1] : ''
}

function parseCssProperties(ruleBody: string): Record<string, string> {
  const props: Record<string, string> = {}
  for (const line of ruleBody.split(';')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const colon = trimmed.indexOf(':')
    if (colon === -1) continue
    const key = trimmed.slice(0, colon).trim()
    const value = trimmed.slice(colon + 1).trim()
    props[key] = value
  }
  return props
}

describe('.panel-separator CSS regression', () => {
  const css = fs.readFileSync(CSS_PATH, 'utf8')
  const ruleBody = extractRuleBody(css, '.panel-separator')
  const props = parseCssProperties(ruleBody)

  it('has an explicit width so the hit area is not 0px', () => {
    expect(props['width']).toBeDefined()
    expect(props['width']).not.toBe('0')
    expect(props['width']).not.toBe('0px')
  })

  it('has explicit height so it fills the panel vertically', () => {
    expect(props['height']).toBeDefined()
    expect(props['height']).not.toBe('0')
    expect(props['height']).not.toBe('0px')
  })

  it('has flex-shrink: 0 so it cannot collapse', () => {
    expect(props['flex-shrink']).toBe('0')
  })

  it('has a resize cursor', () => {
    expect(props['cursor']).toMatch(/resize/)
  })

  it('matches the 4px × 100% spec used by PanelResizeHandle', () => {
    expect(props['width']).toBe('4px')
    expect(props['height']).toBe('100%')
  })
})
