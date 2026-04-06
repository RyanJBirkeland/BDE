/**
 * Tests for progressive-disclosure state persistence (Phase 5.4).
 * The workbench remembers whether the user had the Advanced section
 * expanded, by writing to localStorage.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useTaskWorkbenchStore } from '../taskWorkbench'

const ADVANCED_KEY = 'bde:workbench-advanced-open'

describe('taskWorkbench advancedOpen persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('persists advancedOpen changes to localStorage', async () => {
    useTaskWorkbenchStore.getState().setField('advancedOpen', true)
    await new Promise((r) => setTimeout(r, 0))
    expect(localStorage.getItem(ADVANCED_KEY)).toBe('true')

    useTaskWorkbenchStore.getState().setField('advancedOpen', false)
    await new Promise((r) => setTimeout(r, 0))
    expect(localStorage.getItem(ADVANCED_KEY)).toBe('false')
  })

  it('resetForm preserves persisted advancedOpen preference from storage', () => {
    localStorage.setItem(ADVANCED_KEY, 'true')
    useTaskWorkbenchStore.getState().resetForm()
    // The store's `defaults()` re-reads localStorage, so resetForm should
    // end up with the persisted value.
    expect(useTaskWorkbenchStore.getState().advancedOpen).toBe(true)
  })
})
