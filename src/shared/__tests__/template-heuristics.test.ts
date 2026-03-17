import { describe, it, expect } from 'vitest'
import { detectTemplate } from '../template-heuristics'

describe('detectTemplate', () => {
  it('detects bugfix keywords', () => {
    expect(detectTemplate('Fix the toast z-index')).toBe('bugfix')
    expect(detectTemplate('Bug in login form')).toBe('bugfix')
    expect(detectTemplate('Broken modal on Safari')).toBe('bugfix')
  })

  it('detects feature keywords', () => {
    expect(detectTemplate('Add dark mode toggle')).toBe('feature')
    expect(detectTemplate('Create user settings page')).toBe('feature')
    expect(detectTemplate('Implement search')).toBe('feature')
  })

  it('detects refactor keywords', () => {
    expect(detectTemplate('Refactor sprint store')).toBe('refactor')
    expect(detectTemplate('Extract component logic')).toBe('refactor')
  })

  it('detects test keywords', () => {
    expect(detectTemplate('Test coverage for KanbanBoard')).toBe('test')
    expect(detectTemplate('Write vitest unit tests')).toBe('test')
  })

  it('detects performance keywords', () => {
    expect(detectTemplate('Optimize render perf')).toBe('performance')
    expect(detectTemplate('Slow list scrolling')).toBe('performance')
  })

  it('detects ux keywords', () => {
    expect(detectTemplate('Polish the modal UI')).toBe('ux')
    expect(detectTemplate('CSS layout tweak')).toBe('ux')
  })

  it('detects audit keywords', () => {
    expect(detectTemplate('Audit dependency tree')).toBe('audit')
    expect(detectTemplate('Review security config')).toBe('audit')
  })

  it('detects infra keywords', () => {
    expect(detectTemplate('Deploy pipeline setup')).toBe('infra')
    expect(detectTemplate('CI workflow update')).toBe('infra')
  })

  it('defaults to feature for unknown titles', () => {
    expect(detectTemplate('Do something interesting')).toBe('feature')
    expect(detectTemplate('')).toBe('feature')
  })

  it('is case insensitive', () => {
    expect(detectTemplate('FIX THE BUG')).toBe('bugfix')
    expect(detectTemplate('REFACTOR everything')).toBe('refactor')
  })

  it('matches first rule when multiple apply', () => {
    // "fix" comes before "add" in rules, so bugfix wins
    expect(detectTemplate('Fix and add new feature')).toBe('bugfix')
  })
})
