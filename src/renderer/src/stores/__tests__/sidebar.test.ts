// src/renderer/src/stores/__tests__/sidebar.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { View } from '../panelLayout'

// Mock window.api.settings
vi.stubGlobal('window', {
  ...window,
  api: {
    settings: {
      getJson: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined)
    }
  }
})

describe('sidebar store', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { useSidebarStore } = await import('../sidebar')
    useSidebarStore.setState({
      pinnedViews: [
        'dashboard',
        'agents',
        'ide',
        'sprint',
        'code-review',
        'git',
        'settings',
        'task-workbench'
      ]
    })
  })

  it('starts with all views pinned', async () => {
    const { useSidebarStore } = await import('../sidebar')
    const state = useSidebarStore.getState()
    expect(state.pinnedViews).toHaveLength(8)
    expect(state.pinnedViews).toContain('dashboard')
    expect(state.pinnedViews).toContain('task-workbench')
  })

  it('unpins a view', async () => {
    const { useSidebarStore } = await import('../sidebar')
    useSidebarStore.getState().unpinView('settings')
    const state = useSidebarStore.getState()
    expect(state.pinnedViews).not.toContain('settings')
    expect(state.pinnedViews).toHaveLength(7)
  })

  it('pins a view back', async () => {
    const { useSidebarStore } = await import('../sidebar')
    useSidebarStore.getState().unpinView('settings')
    useSidebarStore.getState().pinView('settings')
    expect(useSidebarStore.getState().pinnedViews).toContain('settings')
  })

  it('reorders views', async () => {
    const { useSidebarStore } = await import('../sidebar')
    const newOrder: View[] = ['ide', 'dashboard', 'agents']
    useSidebarStore.getState().reorderViews(newOrder)
    expect(useSidebarStore.getState().pinnedViews.slice(0, 3)).toEqual(newOrder)
  })

  it('does not pin a view that is already pinned', async () => {
    const { useSidebarStore } = await import('../sidebar')
    const before = useSidebarStore.getState().pinnedViews.length
    useSidebarStore.getState().pinView('dashboard')
    expect(useSidebarStore.getState().pinnedViews.length).toBe(before)
  })

  it('persists pinned views when unpinning', async () => {
    const { useSidebarStore } = await import('../sidebar')
    const mockSet = window.api.settings.set as ReturnType<typeof vi.fn>

    useSidebarStore.getState().unpinView('settings')

    expect(mockSet).toHaveBeenCalledWith(
      'sidebar.pinnedViews',
      expect.stringContaining('dashboard')
    )
    expect(mockSet).toHaveBeenCalledWith(
      'sidebar.pinnedViews',
      expect.not.stringContaining('settings')
    )
  })

  it('persists pinned views when pinning', async () => {
    const { useSidebarStore } = await import('../sidebar')
    const mockSet = window.api.settings.set as ReturnType<typeof vi.fn>

    useSidebarStore.getState().unpinView('settings')
    vi.clearAllMocks()
    useSidebarStore.getState().pinView('settings')

    expect(mockSet).toHaveBeenCalledWith('sidebar.pinnedViews', expect.stringContaining('settings'))
  })

  it('persists pinned views when reordering', async () => {
    const { useSidebarStore } = await import('../sidebar')
    const mockSet = window.api.settings.set as ReturnType<typeof vi.fn>

    const newOrder: View[] = ['ide', 'dashboard', 'agents']
    useSidebarStore.getState().reorderViews(newOrder)

    expect(mockSet).toHaveBeenCalledWith('sidebar.pinnedViews', JSON.stringify(newOrder))
  })

  it('loads saved pinned views', async () => {
    const savedViews = ['dashboard', 'agents', 'ide']
    const mockGetJson = window.api.settings.getJson as ReturnType<typeof vi.fn>
    mockGetJson.mockResolvedValueOnce(savedViews)

    const { useSidebarStore } = await import('../sidebar')
    await useSidebarStore.getState().loadSaved()

    expect(useSidebarStore.getState().pinnedViews).toEqual(savedViews)
  })

  it('filters invalid views when loading', async () => {
    const savedViews = ['dashboard', 'invalid-view', 'agents']
    const mockGetJson = window.api.settings.getJson as ReturnType<typeof vi.fn>
    mockGetJson.mockResolvedValueOnce(savedViews)

    const { useSidebarStore } = await import('../sidebar')
    await useSidebarStore.getState().loadSaved()

    const pinnedViews = useSidebarStore.getState().pinnedViews
    expect(pinnedViews).toContain('dashboard')
    expect(pinnedViews).toContain('agents')
    expect(pinnedViews).not.toContain('invalid-view')
  })

  it('keeps defaults if saved data is empty array', async () => {
    const mockGetJson = window.api.settings.getJson as ReturnType<typeof vi.fn>
    mockGetJson.mockResolvedValueOnce([])

    const { useSidebarStore } = await import('../sidebar')
    const before = useSidebarStore.getState().pinnedViews
    await useSidebarStore.getState().loadSaved()

    expect(useSidebarStore.getState().pinnedViews).toEqual(before)
  })

  it('keeps defaults if saved data is null', async () => {
    const mockGetJson = window.api.settings.getJson as ReturnType<typeof vi.fn>
    mockGetJson.mockResolvedValueOnce(null)

    const { useSidebarStore } = await import('../sidebar')
    const before = useSidebarStore.getState().pinnedViews
    await useSidebarStore.getState().loadSaved()

    expect(useSidebarStore.getState().pinnedViews).toEqual(before)
  })

  it('keeps defaults if loading throws', async () => {
    const mockGetJson = window.api.settings.getJson as ReturnType<typeof vi.fn>
    mockGetJson.mockRejectedValueOnce(new Error('Storage error'))

    const { useSidebarStore } = await import('../sidebar')
    const before = useSidebarStore.getState().pinnedViews
    await useSidebarStore.getState().loadSaved()

    expect(useSidebarStore.getState().pinnedViews).toEqual(before)
  })
})

describe('getUnpinnedViews', () => {
  it('returns views not in pinned list', async () => {
    const { getUnpinnedViews } = await import('../sidebar')
    const pinned: View[] = ['dashboard', 'agents', 'ide']
    const unpinned = getUnpinnedViews(pinned)

    expect(unpinned).not.toContain('dashboard')
    expect(unpinned).not.toContain('agents')
    expect(unpinned).not.toContain('ide')
    expect(unpinned).toContain('sprint')
    expect(unpinned).toContain('code-review')
    expect(unpinned).toContain('git')
    expect(unpinned).toContain('settings')
    expect(unpinned).toContain('task-workbench')
  })

  it('returns empty array when all views are pinned', async () => {
    const { getUnpinnedViews } = await import('../sidebar')
    const allViews: View[] = [
      'dashboard',
      'agents',
      'ide',
      'sprint',
      'code-review',
      'git',
      'settings',
      'task-workbench'
    ]
    const unpinned = getUnpinnedViews(allViews)

    expect(unpinned).toHaveLength(0)
  })

  it('returns all views when none are pinned', async () => {
    const { getUnpinnedViews } = await import('../sidebar')
    const unpinned = getUnpinnedViews([])

    expect(unpinned).toHaveLength(8)
  })
})
