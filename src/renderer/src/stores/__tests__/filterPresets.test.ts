/**
 * Tests for filterPresets store - saved filter configurations for Pipeline view
 */
import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest'
import { useFilterPresets } from '../filterPresets'
import { useSprintUI } from '../sprintUI'

const STORAGE_KEY = 'bde:filterPresets'

describe('filterPresets store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useFilterPresets.setState({ presets: {} })
    useSprintUI.setState({
      repoFilter: null,
      searchQuery: '',
      statusFilter: 'all'
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with empty presets', () => {
    const state = useFilterPresets.getState()
    expect(state.presets).toEqual({})
  })

  it('savePreset captures current filters from sprintUI', () => {
    // Set some filter state
    useSprintUI.setState({
      repoFilter: 'bde',
      searchQuery: 'bug',
      statusFilter: 'blocked'
    })

    // Save as preset
    useFilterPresets.getState().savePreset('My Filters')

    const { presets } = useFilterPresets.getState()
    expect(presets['My Filters']).toEqual({
      repoFilter: 'bde',
      searchQuery: 'bug',
      statusFilter: 'blocked'
    })
  })

  it('loadPreset applies filters to sprintUI', () => {
    // Save a preset
    useFilterPresets.setState({
      presets: {
        'Debug View': {
          repoFilter: 'claude-chat-service',
          searchQuery: 'error',
          statusFilter: 'failed'
        }
      }
    })

    // Load it
    useFilterPresets.getState().loadPreset('Debug View')

    const ui = useSprintUI.getState()
    expect(ui.repoFilter).toBe('claude-chat-service')
    expect(ui.searchQuery).toBe('error')
    expect(ui.statusFilter).toBe('failed')
  })

  it('loadPreset is no-op for non-existent preset', () => {
    useSprintUI.setState({
      repoFilter: 'bde',
      searchQuery: 'initial',
      statusFilter: 'all'
    })

    useFilterPresets.getState().loadPreset('DoesNotExist')

    // UI should be unchanged
    const ui = useSprintUI.getState()
    expect(ui.repoFilter).toBe('bde')
    expect(ui.searchQuery).toBe('initial')
    expect(ui.statusFilter).toBe('all')
  })

  it('deletePreset removes a preset', () => {
    useFilterPresets.setState({
      presets: {
        'Preset A': { repoFilter: null, searchQuery: '', statusFilter: 'all' },
        'Preset B': { repoFilter: 'bde', searchQuery: 'test', statusFilter: 'done' }
      }
    })

    useFilterPresets.getState().deletePreset('Preset A')

    const { presets } = useFilterPresets.getState()
    expect(presets['Preset A']).toBeUndefined()
    expect(presets['Preset B']).toBeDefined()
  })

  it('deletePreset is no-op for non-existent preset', () => {
    useFilterPresets.setState({
      presets: {
        Existing: { repoFilter: null, searchQuery: '', statusFilter: 'all' }
      }
    })

    expect(() => useFilterPresets.getState().deletePreset('DoesNotExist')).not.toThrow()
    expect(useFilterPresets.getState().presets.Existing).toBeDefined()
  })

  it('getPresetNames returns array of preset names', () => {
    useFilterPresets.setState({
      presets: {
        Alpha: { repoFilter: null, searchQuery: '', statusFilter: 'all' },
        Beta: { repoFilter: 'bde', searchQuery: '', statusFilter: 'done' }
      }
    })

    const names = useFilterPresets.getState().getPresetNames()
    expect(names).toEqual(['Alpha', 'Beta'])
  })

  it('getPresetNames returns empty array when no presets', () => {
    const names = useFilterPresets.getState().getPresetNames()
    expect(names).toEqual([])
  })

  // --- Persistence tests ---

  it('restoreFromStorage is no-op when localStorage is empty', () => {
    useFilterPresets.getState().restoreFromStorage()
    expect(useFilterPresets.getState().presets).toEqual({})
  })

  it('restoreFromStorage loads presets from localStorage', () => {
    const data = {
      'Saved View': {
        repoFilter: 'bde',
        searchQuery: 'test',
        statusFilter: 'blocked'
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))

    useFilterPresets.getState().restoreFromStorage()
    const { presets } = useFilterPresets.getState()
    expect(presets['Saved View']).toEqual(data['Saved View'])
  })

  it('restoreFromStorage handles corrupt JSON gracefully', () => {
    localStorage.setItem(STORAGE_KEY, 'not-valid-json{{')
    expect(() => useFilterPresets.getState().restoreFromStorage()).not.toThrow()
    expect(useFilterPresets.getState().presets).toEqual({})
  })

  it('auto-persists when a preset is saved', () => {
    useSprintUI.setState({
      repoFilter: 'life-os',
      searchQuery: 'feature',
      statusFilter: 'done'
    })

    useFilterPresets.getState().savePreset('Life OS Complete')
    vi.advanceTimersByTime(500)

    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed['Life OS Complete']).toEqual({
      repoFilter: 'life-os',
      searchQuery: 'feature',
      statusFilter: 'done'
    })
  })

  it('auto-persists when a preset is deleted', () => {
    useFilterPresets.setState({
      presets: {
        Keep: { repoFilter: null, searchQuery: '', statusFilter: 'all' },
        Remove: { repoFilter: 'bde', searchQuery: '', statusFilter: 'done' }
      }
    })

    useFilterPresets.getState().deletePreset('Remove')
    vi.advanceTimersByTime(500)

    const raw = localStorage.getItem(STORAGE_KEY)!
    const parsed = JSON.parse(raw)
    expect(parsed['Keep']).toBeDefined()
    expect(parsed['Remove']).toBeUndefined()
  })

  it('survives localStorage.setItem throwing (quota exceeded)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('QuotaExceededError')
    })

    useSprintUI.setState({ repoFilter: 'bde', searchQuery: 'test', statusFilter: 'all' })
    useFilterPresets.getState().savePreset('Test')

    // Debounced persist should not throw
    expect(() => vi.advanceTimersByTime(500)).not.toThrow()
    vi.restoreAllMocks()
  })

  it('restoreFromStorage ignores non-object values', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([1, 2, 3]))
    useFilterPresets.getState().restoreFromStorage()
    expect(useFilterPresets.getState().presets).toEqual({})
  })
})
