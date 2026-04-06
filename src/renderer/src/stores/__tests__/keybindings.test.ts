import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useKeybindingsStore, DEFAULT_KEYBINDINGS, ACTION_LABELS } from '../keybindings'

describe('keybindings store', () => {
  beforeEach(() => {
    useKeybindingsStore.setState({ bindings: { ...DEFAULT_KEYBINDINGS } })
    vi.clearAllMocks()
  })

  it('starts with default keybindings', () => {
    const { bindings } = useKeybindingsStore.getState()
    expect(bindings['view.dashboard']).toBe('⌘1')
    expect(bindings['palette.toggle']).toBe('⌘P')
    expect(bindings['shortcuts.show']).toBe('?')
  })

  it('getBinding returns the current binding', () => {
    const combo = useKeybindingsStore.getState().getBinding('view.dashboard')
    expect(combo).toBe('⌘1')
  })

  it('getBinding falls back to default for unknown override', () => {
    // Remove a binding from state to simulate missing key
    useKeybindingsStore.setState({
      bindings: { ...DEFAULT_KEYBINDINGS, 'view.dashboard': undefined as unknown as string }
    })
    const combo = useKeybindingsStore.getState().getBinding('view.dashboard')
    expect(combo).toBe(DEFAULT_KEYBINDINGS['view.dashboard'])
  })

  it('setBinding updates the binding and persists to settings', async () => {
    await useKeybindingsStore.getState().setBinding('view.dashboard', '⌘D')
    expect(useKeybindingsStore.getState().bindings['view.dashboard']).toBe('⌘D')
    expect(window.api.settings.set).toHaveBeenCalledWith(
      'keybindings',
      expect.stringContaining('⌘D')
    )
  })

  it('setBinding handles save error gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(window.api.settings.set).mockRejectedValueOnce(new Error('save failed'))

    await useKeybindingsStore.getState().setBinding('view.dashboard', '⌘D')

    // State should still be updated even if save fails
    expect(useKeybindingsStore.getState().bindings['view.dashboard']).toBe('⌘D')
    expect(consoleSpy).toHaveBeenCalledWith('Failed to save keybindings:', expect.any(Error))
    consoleSpy.mockRestore()
  })

  it('resetToDefaults restores all bindings and persists', async () => {
    await useKeybindingsStore.getState().setBinding('view.dashboard', '⌘D')
    await useKeybindingsStore.getState().resetToDefaults()

    expect(useKeybindingsStore.getState().bindings['view.dashboard']).toBe('⌘1')
    expect(window.api.settings.set).toHaveBeenCalledWith(
      'keybindings',
      JSON.stringify(DEFAULT_KEYBINDINGS)
    )
  })

  it('resetToDefaults handles save error gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(window.api.settings.set).mockRejectedValueOnce(new Error('reset failed'))

    await useKeybindingsStore.getState().resetToDefaults()

    // Bindings should still be reset locally
    expect(useKeybindingsStore.getState().bindings).toEqual(DEFAULT_KEYBINDINGS)
    expect(consoleSpy).toHaveBeenCalledWith('Failed to reset keybindings:', expect.any(Error))
    consoleSpy.mockRestore()
  })

  it('init loads saved keybindings from settings', async () => {
    const customBindings = { ...DEFAULT_KEYBINDINGS, 'view.dashboard': '⌘X' }
    vi.mocked(window.api.settings.get).mockResolvedValueOnce(JSON.stringify(customBindings))

    await useKeybindingsStore.getState().init()

    expect(useKeybindingsStore.getState().bindings['view.dashboard']).toBe('⌘X')
  })

  it('init merges with defaults when saved bindings are partial', async () => {
    const partial = { 'view.dashboard': '⌘X' }
    vi.mocked(window.api.settings.get).mockResolvedValueOnce(JSON.stringify(partial))

    await useKeybindingsStore.getState().init()

    expect(useKeybindingsStore.getState().bindings['view.dashboard']).toBe('⌘X')
    // Other bindings should be defaults
    expect(useKeybindingsStore.getState().bindings['palette.toggle']).toBe('⌘P')
  })

  it('init handles null saved settings', async () => {
    vi.mocked(window.api.settings.get).mockResolvedValueOnce(null)

    await useKeybindingsStore.getState().init()

    expect(useKeybindingsStore.getState().bindings).toEqual(DEFAULT_KEYBINDINGS)
  })

  it('init handles load error gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(window.api.settings.get).mockRejectedValueOnce(new Error('load failed'))

    await useKeybindingsStore.getState().init()

    // Should keep current bindings on error
    expect(consoleSpy).toHaveBeenCalledWith('Failed to load keybindings:', expect.any(Error))
    consoleSpy.mockRestore()
  })

  it('findDuplicates returns empty array when no duplicates', () => {
    const dupes = useKeybindingsStore.getState().findDuplicates()
    expect(dupes).toEqual([])
  })

  it('findDuplicates detects duplicate combos', async () => {
    // Set two actions to the same combo
    await useKeybindingsStore.getState().setBinding('view.agents', '⌘1')

    const dupes = useKeybindingsStore.getState().findDuplicates()
    expect(dupes.length).toBeGreaterThan(0)
    const dupe = dupes.find((d) => d.combo === '⌘1')
    expect(dupe).toBeDefined()
    expect(dupe!.actions).toContain('view.dashboard')
    expect(dupe!.actions).toContain('view.agents')
  })

  it('ACTION_LABELS has labels for all action IDs', () => {
    for (const actionId of Object.keys(DEFAULT_KEYBINDINGS)) {
      expect(ACTION_LABELS[actionId as keyof typeof ACTION_LABELS]).toBeDefined()
    }
  })
})
