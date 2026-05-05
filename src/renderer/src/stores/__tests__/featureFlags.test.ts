import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const STORAGE_KEY = 'fleet:ff'

describe('featureFlags store', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('defaults v2Agents to true and all other flags to false when localStorage is empty', async () => {
    const { useFeatureFlags } = await import('../featureFlags')
    const state = useFeatureFlags.getState()
    expect(state.v2Agents).toBe(true)
    expect(state.v2Shell).toBe(false)
    expect(state.v2Dashboard).toBe(false)
    expect(state.v2Pipeline).toBe(false)
    expect(state.v2Planner).toBe(false)
  })

  it('falls back to defaults when localStorage contains malformed JSON', async () => {
    localStorage.setItem(STORAGE_KEY, '{not-valid-json')
    const { useFeatureFlags } = await import('../featureFlags')
    const state = useFeatureFlags.getState()
    expect(state.v2Agents).toBe(true)
    expect(state.v2Shell).toBe(false)
    expect(state.v2Dashboard).toBe(false)
    expect(state.v2Pipeline).toBe(false)
    expect(state.v2Planner).toBe(false)
  })

  it('falls back to defaults for any non-boolean flag value', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v2Shell: 1,
        v2Dashboard: 'true',
        v2Pipeline: null,
        v2Agents: 0,
        v2Planner: { enabled: true }
      })
    )
    const { useFeatureFlags } = await import('../featureFlags')
    const state = useFeatureFlags.getState()
    expect(state.v2Shell).toBe(false)
    expect(state.v2Dashboard).toBe(false)
    expect(state.v2Pipeline).toBe(false)
    expect(state.v2Agents).toBe(true)
    expect(state.v2Planner).toBe(false)
  })

  it('honours a fully-typed valid stored payload', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v2Shell: true,
        v2Dashboard: true,
        v2Pipeline: true,
        v2Agents: false,
        v2Planner: true
      })
    )
    const { useFeatureFlags } = await import('../featureFlags')
    const state = useFeatureFlags.getState()
    expect(state.v2Shell).toBe(true)
    expect(state.v2Dashboard).toBe(true)
    expect(state.v2Pipeline).toBe(true)
    expect(state.v2Agents).toBe(false)
    expect(state.v2Planner).toBe(true)
  })

  it('persists setFlag changes to localStorage and updates the store', async () => {
    const { useFeatureFlags } = await import('../featureFlags')
    useFeatureFlags.getState().setFlag('v2Shell', true)

    expect(useFeatureFlags.getState().v2Shell).toBe(true)
    const stored = localStorage.getItem(STORAGE_KEY)
    expect(stored).not.toBeNull()
    const parsed = JSON.parse(stored as string) as Record<string, unknown>
    expect(parsed.v2Shell).toBe(true)
  })
})
