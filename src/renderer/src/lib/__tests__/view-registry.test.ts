import { describe, it, expect } from 'vitest'
import { VIEW_REGISTRY, VIEW_SHORTCUT_MAP } from '../view-registry'

describe('view-registry', () => {
  it('assigns ⌘6 shortcut to git (Source Control)', () => {
    expect(VIEW_REGISTRY.git.shortcut).toBe('⌘6')
    expect(VIEW_REGISTRY.git.shortcutKey).toBe('6')
    expect(VIEW_REGISTRY.git.hidden).toBeUndefined()
  })

  it('assigns ⌘7 shortcut to settings', () => {
    expect(VIEW_REGISTRY.settings.shortcut).toBe('⌘7')
    expect(VIEW_REGISTRY.settings.shortcutKey).toBe('7')
  })

  it('assigns ⌘8 shortcut to planner', () => {
    expect(VIEW_REGISTRY.planner.shortcut).toBe('⌘8')
    expect(VIEW_REGISTRY.planner.shortcutKey).toBe('8')
  })

  it('maps all visible views to shortcut keys', () => {
    expect(VIEW_SHORTCUT_MAP['6']).toBe('git')
    expect(VIEW_SHORTCUT_MAP['7']).toBe('settings')
    expect(VIEW_SHORTCUT_MAP['8']).toBe('planner')
    expect(Object.values(VIEW_SHORTCUT_MAP)).toContain('git')
  })
})
