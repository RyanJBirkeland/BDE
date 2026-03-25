// src/renderer/src/components/layout/__tests__/NeonSidebar.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('framer-motion', () => ({
  motion: { div: ({ children, ...props }: any) => <div {...props}>{children}</div> },
  useReducedMotion: () => false,
}));

vi.mock('../../../stores/sidebar', () => ({
  useSidebarStore: vi.fn((sel: any) => sel({
    pinnedViews: ['dashboard', 'agents', 'ide'],
  })),
  getUnpinnedViews: vi.fn(() => ['sprint', 'pr-station']),
}));

vi.mock('../../../stores/panelLayout', () => ({
  usePanelLayoutStore: vi.fn((sel: any) => sel({
    root: { type: 'leaf', panelId: 'p1', tabs: [{ viewKey: 'dashboard', label: 'Dashboard' }], activeTab: 0 },
    focusedPanelId: 'p1',
  })),
  // getOpenViews is a standalone exported function, not a store method
  getOpenViews: vi.fn(() => ['dashboard']),
}));

vi.mock('../../../stores/ui', () => ({
  useUIStore: vi.fn((sel: any) => sel({ activeView: 'dashboard', setView: vi.fn() })),
}));

describe('NeonSidebar', () => {
  it('renders pinned view icons', async () => {
    const { NeonSidebar } = await import('../NeonSidebar');
    render(<NeonSidebar />);
    // Should render 3 pinned items + more button
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(3);
  });

  it('renders the more button', async () => {
    const { NeonSidebar } = await import('../NeonSidebar');
    render(<NeonSidebar />);
    expect(screen.getByLabelText('More views')).toBeInTheDocument();
  });

  it('renders model badge', async () => {
    const { NeonSidebar } = await import('../NeonSidebar');
    render(<NeonSidebar model="haiku" />);
    expect(screen.getByText('haiku')).toBeInTheDocument();
  });
});
