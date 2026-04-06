import { describe, it, expect } from 'vitest'
import {
  GLOBAL_SHORTCUTS,
  IDE_SHORTCUTS,
  CODE_REVIEW_SHORTCUTS,
  SHORTCUT_CATEGORIES
} from '../shortcuts-data'

describe('shortcuts-data', () => {
  it('GLOBAL_SHORTCUTS is a non-empty array of shortcuts', () => {
    expect(GLOBAL_SHORTCUTS.length).toBeGreaterThan(0)
    for (const s of GLOBAL_SHORTCUTS) {
      expect(s.keys).toBeTruthy()
      expect(s.description).toBeTruthy()
    }
  })

  it('IDE_SHORTCUTS is a non-empty array of shortcuts', () => {
    expect(IDE_SHORTCUTS.length).toBeGreaterThan(0)
    for (const s of IDE_SHORTCUTS) {
      expect(s.keys).toBeTruthy()
      expect(s.description).toBeTruthy()
    }
  })

  it('CODE_REVIEW_SHORTCUTS is a non-empty array of shortcuts', () => {
    expect(CODE_REVIEW_SHORTCUTS.length).toBeGreaterThan(0)
    for (const s of CODE_REVIEW_SHORTCUTS) {
      expect(s.keys).toBeTruthy()
      expect(s.description).toBeTruthy()
    }
  })

  it('SHORTCUT_CATEGORIES has three categories', () => {
    expect(SHORTCUT_CATEGORIES).toHaveLength(3)
    expect(SHORTCUT_CATEGORIES.map((c) => c.name)).toEqual(['Global', 'IDE', 'Code Review'])
  })

  it('each category has a name and shortcuts array', () => {
    for (const cat of SHORTCUT_CATEGORIES) {
      expect(typeof cat.name).toBe('string')
      expect(Array.isArray(cat.shortcuts)).toBe(true)
      expect(cat.shortcuts.length).toBeGreaterThan(0)
    }
  })
})
