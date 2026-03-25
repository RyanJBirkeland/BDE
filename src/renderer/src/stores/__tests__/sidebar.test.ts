// src/renderer/src/stores/__tests__/sidebar.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock window.api.settings
vi.stubGlobal('window', {
  ...window,
  api: {
    settings: {
      getJson: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    },
  },
});

describe('sidebar store', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { useSidebarStore } = await import('../sidebar');
    useSidebarStore.setState({
      pinnedViews: ['dashboard', 'agents', 'ide', 'sprint', 'pr-station', 'git', 'memory', 'cost', 'settings', 'task-workbench'],
    });
  });

  it('starts with all views pinned', async () => {
    const { useSidebarStore } = await import('../sidebar');
    const state = useSidebarStore.getState();
    expect(state.pinnedViews).toHaveLength(10);
    expect(state.pinnedViews).toContain('dashboard');
    expect(state.pinnedViews).toContain('task-workbench');
  });

  it('unpins a view', async () => {
    const { useSidebarStore } = await import('../sidebar');
    useSidebarStore.getState().unpinView('cost');
    const state = useSidebarStore.getState();
    expect(state.pinnedViews).not.toContain('cost');
    expect(state.pinnedViews).toHaveLength(9);
  });

  it('pins a view back', async () => {
    const { useSidebarStore } = await import('../sidebar');
    useSidebarStore.getState().unpinView('cost');
    useSidebarStore.getState().pinView('cost');
    expect(useSidebarStore.getState().pinnedViews).toContain('cost');
  });

  it('reorders views', async () => {
    const { useSidebarStore } = await import('../sidebar');
    const newOrder = ['ide', 'dashboard', 'agents'];
    useSidebarStore.getState().reorderViews(newOrder);
    expect(useSidebarStore.getState().pinnedViews.slice(0, 3)).toEqual(newOrder);
  });

  it('does not pin a view that is already pinned', async () => {
    const { useSidebarStore } = await import('../sidebar');
    const before = useSidebarStore.getState().pinnedViews.length;
    useSidebarStore.getState().pinView('dashboard');
    expect(useSidebarStore.getState().pinnedViews.length).toBe(before);
  });
});
