# Neon App Shell Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign BDE's app shell into a streamlined Arc-Browser-style layout: unified header (merged TitleBar + tab bar), 52px neon sidebar with pin/unpin customization, and eliminated status bar.

**Architecture:** New shell components compose existing V2 neon primitives (NeonBadge, GlassPanel, neonVar). A new sidebar Zustand store manages pin/unpin state separately from panel layout. The unified header renders focused panel tabs and replaces both TitleBar and PanelTabBar. Unfocused panels get a slim 24px inline tab indicator.

**Tech Stack:** React, TypeScript, Zustand, Framer Motion, lucide-react, CSS custom properties, Vitest + React Testing Library

**Spec:** `docs/superpowers/specs/2026-03-24-neon-app-shell-redesign-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|----------------|
| `src/renderer/src/assets/neon-shell.css` | Shell-specific neon CSS: unified header, sidebar, tooltip styles |
| `src/renderer/src/components/neon/NeonTooltip.tsx` | Reusable neon-styled tooltip with delay and positioning |
| `src/renderer/src/components/neon/__tests__/NeonTooltip.test.tsx` | Tests for NeonTooltip |
| `src/renderer/src/stores/sidebar.ts` | Sidebar pin/unpin state, persisted to settings |
| `src/renderer/src/stores/__tests__/sidebar.test.ts` | Tests for sidebar store |
| `src/renderer/src/components/layout/SidebarItem.tsx` | Single nav icon with tooltip, active glow, right-click menu |
| `src/renderer/src/components/layout/OverflowMenu.tsx` | Popover for unpinned items |
| `src/renderer/src/components/layout/NeonSidebar.tsx` | 52px icon rail composing SidebarItem + OverflowMenu |
| `src/renderer/src/components/layout/HeaderTab.tsx` | Single tab in unified header |
| `src/renderer/src/components/layout/UnifiedHeader.tsx` | Merged TitleBar + tab strip + action buttons |
| `src/renderer/src/components/layout/__tests__/NeonSidebar.test.tsx` | Tests for NeonSidebar |
| `src/renderer/src/components/layout/__tests__/UnifiedHeader.test.tsx` | Tests for UnifiedHeader |

### Modified Files

| File | Change |
|------|--------|
| `src/renderer/src/components/neon/index.ts` | Add NeonTooltip export |
| `src/renderer/src/components/panels/PanelLeaf.tsx` | Conditional tab bar: full PanelTabBar when focused, slim 24px label when not |
| `src/renderer/src/App.tsx` | Swap TitleBar/ActivityBar/StatusBar for UnifiedHeader + NeonSidebar, import neon-shell.css |
| `src/renderer/src/assets/main.css` | Remove old TitleBar/ActivityBar/StatusBar CSS sections |

### Deleted Files

| File | Reason |
|------|--------|
| `src/renderer/src/components/layout/StatusBar.tsx` | Eliminated — info moves to sidebar + header |

---

## Task 1: Neon Shell CSS

**Files:**
- Create: `src/renderer/src/assets/neon-shell.css`

- [ ] **Step 1: Create the shell CSS file**

```css
/* src/renderer/src/assets/neon-shell.css */
/* ═══════════════════════════════════════════════════════
   Neon App Shell — Header, Sidebar, Tooltips
   ═══════════════════════════════════════════════════════ */

/* ── Unified Header ── */
.unified-header {
  height: 44px;
  display: flex;
  align-items: center;
  background: linear-gradient(180deg, rgba(138, 43, 226, 0.06), transparent);
  border-bottom: 1px solid var(--neon-purple-border);
  -webkit-app-region: drag;
  flex-shrink: 0;
  position: relative;
  z-index: 10;
}

.unified-header__logo {
  width: 52px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 1px solid rgba(191, 90, 242, 0.1);
  -webkit-app-region: no-drag;
  cursor: pointer;
  transition: background 150ms ease;
}

.unified-header__logo:hover {
  background: var(--neon-purple-surface);
}

.unified-header__logo-letter {
  color: var(--neon-purple);
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 1px;
  text-shadow: var(--neon-purple-glow);
}

.unified-header__tabs {
  flex: 1;
  display: flex;
  align-items: flex-end;
  height: 100%;
  padding: 0 8px;
  gap: 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.unified-header__tabs::-webkit-scrollbar {
  display: none;
}

.unified-header__actions {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 0 14px;
  -webkit-app-region: no-drag;
  flex-shrink: 0;
}

/* ── Header Tab ── */
.header-tab {
  height: 32px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  gap: 6px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  cursor: pointer;
  -webkit-app-region: no-drag;
  border-radius: 8px 8px 0 0;
  transition: color 150ms ease, background 150ms ease;
  white-space: nowrap;
  position: relative;
  bottom: -1px;
  border: 1px solid transparent;
  border-bottom: none;
}

.header-tab:hover {
  color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.03);
}

.header-tab--active {
  height: 34px;
  color: #fff;
  background: rgba(10, 0, 21, 0.8);
  border-color: var(--neon-purple-border);
  border-bottom-color: transparent;
  font-weight: 500;
}

.header-tab__dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--neon-cyan);
  box-shadow: var(--neon-cyan-glow);
  flex-shrink: 0;
}

.header-tab__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.2);
  cursor: pointer;
  transition: color 100ms ease, background 100ms ease;
}

.header-tab__close:hover {
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.1);
}

/* ── Neon Sidebar ── */
.neon-sidebar {
  width: 52px;
  background: linear-gradient(180deg, rgba(138, 43, 226, 0.04), rgba(10, 0, 21, 0.4));
  border-right: 1px solid var(--neon-purple-border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 8px;
  flex-shrink: 0;
  overflow: hidden;
}

.neon-sidebar__nav {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  flex: 1;
  padding: 0 6px;
}

.neon-sidebar__footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 0 6px 8px;
}

/* ── Sidebar Item ── */
.sidebar-item {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  position: relative;
  transition: background 150ms ease;
  color: rgba(255, 255, 255, 0.3);
}

.sidebar-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.8);
}

.sidebar-item--active {
  background: var(--neon-purple-surface);
  color: var(--neon-purple);
  border-left: 3px solid var(--neon-purple);
  border-radius: 0 8px 8px 0;
  margin-left: -6px;
  padding-left: 3px;
}

.sidebar-item__open-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--neon-cyan);
  box-shadow: 0 0 4px var(--neon-cyan);
}

/* ── Neon Tooltip ── */
.neon-tooltip {
  position: fixed;
  z-index: 1000;
  padding: 6px 12px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--neon-purple-surface), rgba(10, 0, 21, 0.9));
  border: 1px solid var(--neon-purple-border);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  box-shadow: var(--neon-glass-shadow);
  color: #fff;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  pointer-events: none;
  animation: neon-tooltip-in 150ms ease forwards;
}

.neon-tooltip__shortcut {
  color: var(--neon-purple);
  margin-left: 8px;
  font-size: 10px;
  font-family: var(--bde-font-code);
}

@keyframes neon-tooltip-in {
  from {
    opacity: 0;
    transform: translateX(-4px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

/* ── Overflow Menu ── */
.overflow-menu {
  position: fixed;
  z-index: 100;
  min-width: 200px;
}

.overflow-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  transition: background 100ms ease, color 100ms ease;
  border-radius: 6px;
}

.overflow-menu__item:hover {
  background: var(--neon-purple-surface);
  color: #fff;
}

.overflow-menu__item-pin {
  margin-left: auto;
  color: var(--neon-purple);
  font-size: 10px;
  opacity: 0;
  transition: opacity 100ms ease;
}

.overflow-menu__item:hover .overflow-menu__item-pin {
  opacity: 1;
}

/* ── Slim Panel Label (unfocused panels) ── */
.panel-label-slim {
  height: 24px;
  display: flex;
  align-items: center;
  padding: 0 10px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
  background: rgba(10, 0, 21, 0.4);
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: color 100ms ease;
  flex-shrink: 0;
}

.panel-label-slim:hover {
  color: rgba(255, 255, 255, 0.6);
}

/* ── Model Badge ── */
.sidebar-model-badge {
  padding: 3px 6px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 9px;
  color: rgba(255, 255, 255, 0.25);
  font-family: var(--bde-font-code);
  text-align: center;
}

/* ── Reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  .neon-tooltip {
    animation: none;
  }
}
```

- [ ] **Step 2: Import in App.tsx**

Add `import './assets/neon-shell.css'` alongside the existing neon.css import in `src/renderer/src/App.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/assets/neon-shell.css src/renderer/src/App.tsx
git commit -m "feat: add neon shell CSS for unified header, sidebar, and tooltips"
```

---

## Task 2: NeonTooltip Primitive

**Files:**
- Create: `src/renderer/src/components/neon/NeonTooltip.tsx`
- Create: `src/renderer/src/components/neon/__tests__/NeonTooltip.test.tsx`
- Modify: `src/renderer/src/components/neon/index.ts`

- [ ] **Step 1: Write failing tests**

```tsx
// src/renderer/src/components/neon/__tests__/NeonTooltip.test.tsx
import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NeonTooltip } from '../NeonTooltip';

describe('NeonTooltip', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('does not show tooltip initially', () => {
    render(
      <NeonTooltip label="Dashboard" shortcut="⌘1">
        <button>Nav</button>
      </NeonTooltip>
    );
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('shows tooltip after hover delay', async () => {
    render(
      <NeonTooltip label="Dashboard" shortcut="⌘1">
        <button>Nav</button>
      </NeonTooltip>
    );
    fireEvent.mouseEnter(screen.getByText('Nav'));
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('⌘1')).toBeInTheDocument();
  });

  it('hides tooltip on mouse leave', () => {
    render(
      <NeonTooltip label="Dashboard" shortcut="⌘1">
        <button>Nav</button>
      </NeonTooltip>
    );
    fireEvent.mouseEnter(screen.getByText('Nav'));
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByText('Nav'));
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('renders without shortcut', () => {
    render(
      <NeonTooltip label="Settings">
        <button>Gear</button>
      </NeonTooltip>
    );
    fireEvent.mouseEnter(screen.getByText('Gear'));
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/neon/__tests__/NeonTooltip.test.tsx`

- [ ] **Step 3: Implement NeonTooltip**

```tsx
// src/renderer/src/components/neon/NeonTooltip.tsx
import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface NeonTooltipProps {
  label: string;
  shortcut?: string;
  delay?: number;
  children: ReactNode;
}

export function NeonTooltip({ label, shortcut, delay = 300, children }: NeonTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setPosition({
          top: rect.top + rect.height / 2 - 14,
          left: rect.right + 8,
        });
      }
      setVisible(true);
    }, delay);
  }, [delay]);

  const hide = useCallback(() => {
    clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        style={{ display: 'contents' }}
      >
        {children}
      </div>
      {visible &&
        createPortal(
          <div
            className="neon-tooltip"
            style={{ top: position.top, left: position.left }}
            role="tooltip"
          >
            {label}
            {shortcut && <span className="neon-tooltip__shortcut">{shortcut}</span>}
          </div>,
          document.body,
        )}
    </>
  );
}
```

- [ ] **Step 4: Add to barrel export**

Add to `src/renderer/src/components/neon/index.ts`:
```typescript
export { NeonTooltip } from './NeonTooltip';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/neon/__tests__/NeonTooltip.test.tsx`

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/neon/NeonTooltip.tsx src/renderer/src/components/neon/__tests__/NeonTooltip.test.tsx src/renderer/src/components/neon/index.ts
git commit -m "feat: add NeonTooltip primitive component"
```

---

## Task 3: Sidebar Store

**Files:**
- Create: `src/renderer/src/stores/sidebar.ts`
- Create: `src/renderer/src/stores/__tests__/sidebar.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement sidebar store**

```typescript
// src/renderer/src/stores/sidebar.ts
import { create } from 'zustand';
import type { View } from './panelLayout';

const ALL_VIEWS: View[] = [
  'dashboard', 'agents', 'ide', 'sprint', 'pr-station',
  'git', 'memory', 'cost', 'settings', 'task-workbench',
];

interface SidebarState {
  pinnedViews: View[];
  pinView: (view: View) => void;
  unpinView: (view: View) => void;
  reorderViews: (views: View[]) => void;
  loadSaved: () => Promise<void>;
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
  pinnedViews: [...ALL_VIEWS],

  pinView: (view) => {
    const { pinnedViews } = get();
    if (pinnedViews.includes(view)) return;
    set({ pinnedViews: [...pinnedViews, view] });
    persistPinned([...get().pinnedViews]);
  },

  unpinView: (view) => {
    set((s) => ({ pinnedViews: s.pinnedViews.filter((v) => v !== view) }));
    persistPinned(get().pinnedViews);
  },

  reorderViews: (views) => {
    set({ pinnedViews: views });
    persistPinned(views);
  },

  loadSaved: async () => {
    try {
      const saved = await window.api.settings.getJson('sidebar.pinnedViews');
      if (Array.isArray(saved) && saved.length > 0) {
        // Filter to only valid views
        const valid = saved.filter((v: string) => ALL_VIEWS.includes(v as View)) as View[];
        if (valid.length > 0) set({ pinnedViews: valid });
      }
    } catch {
      // Use defaults
    }
  },
}));

function persistPinned(views: View[]): void {
  // settings.set expects a string value, settings.getJson parses it back
  // Verify this contract by reading src/preload/index.ts and src/main/handlers/config-handlers.ts
  window.api.settings.set('sidebar.pinnedViews', JSON.stringify(views)).catch(() => {});
}

/** Helper: get unpinned views (not stored, computed) */
export function getUnpinnedViews(pinned: View[]): View[] {
  return ALL_VIEWS.filter((v) => !pinned.includes(v));
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/stores/sidebar.ts src/renderer/src/stores/__tests__/sidebar.test.ts
git commit -m "feat: add sidebar store with pin/unpin/reorder"
```

---

## Task 4: SidebarItem Component

**Files:**
- Create: `src/renderer/src/components/layout/SidebarItem.tsx`

- [ ] **Step 1: Implement SidebarItem**

This component renders a single sidebar nav icon with tooltip, active state, open-dot indicator, and right-click context menu. It imports `NeonTooltip` from the neon primitives.

Read `src/renderer/src/components/layout/ActivityBar.tsx` first to understand the existing context menu pattern (right-click → "Open to Right", "Open Below", etc.). Port that context menu logic into SidebarItem, adding the new "Unpin from sidebar" option.

Key props:
```typescript
interface SidebarItemProps {
  view: View;
  icon: React.ReactNode;
  label: string;
  shortcut: string;
  isActive: boolean;
  isOpen: boolean; // view is open in some tab but not focused
  onActivate: (view: View) => void;
  onContextAction: (action: string, view: View) => void;
}
```

The component should:
- Render a 36×36px button with the icon centered
- Apply `.sidebar-item--active` class when active
- Show `.sidebar-item__open-dot` when `isOpen && !isActive`
- Wrap in `<NeonTooltip label={label} shortcut={shortcut}>`
- On right-click: show context menu with "Unpin from sidebar", "Open to the Right", "Open Below", "Open in New Tab", "Close All"
- On click: call `onActivate(view)`
- Support drag source for panel operations (same dataTransfer as current ActivityBar)

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/layout/SidebarItem.tsx
git commit -m "feat: add SidebarItem component with tooltip and context menu"
```

---

## Task 5: OverflowMenu Component

**Files:**
- Create: `src/renderer/src/components/layout/OverflowMenu.tsx`

- [ ] **Step 1: Implement OverflowMenu**

Popover component that shows unpinned sidebar items. Uses `GlassPanel` from neon primitives for the container.

Key props:
```typescript
interface OverflowMenuProps {
  unpinnedViews: View[];
  anchorRect: DOMRect | null;
  onPin: (view: View) => void;
  onActivate: (view: View) => void;
  onClose: () => void;
}
```

The component should:
- Render inside a portal (document.body)
- Position above the "⋯" button using `anchorRect`
- Use `GlassPanel accent="purple"` as the container
- List each unpinned view with its icon + label
- Show "Pin to sidebar" action on hover (right side)
- Click item → `onActivate(view)` then `onClose()`
- Click pin → `onPin(view)`
- Close on click outside or Escape
- Include "Customize sidebar..." footer link that navigates to Settings

Refer to `src/renderer/src/components/layout/ActivityBar.tsx` for the icon mapping (NAV_ITEMS array maps view keys to lucide-react icons). You'll need the same icon mapping.

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/layout/OverflowMenu.tsx
git commit -m "feat: add OverflowMenu component for unpinned sidebar items"
```

---

## Task 6: NeonSidebar Component

**Files:**
- Create: `src/renderer/src/components/layout/NeonSidebar.tsx`
- Create: `src/renderer/src/components/layout/__tests__/NeonSidebar.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
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
```

- [ ] **Step 2: Run tests, verify fail**

- [ ] **Step 3: Implement NeonSidebar**

Compose `SidebarItem` + `OverflowMenu`. Read the existing `ActivityBar.tsx` for the NAV_ITEMS icon mapping and port it here.

The component should:
- Use `useSidebarStore` for pinnedViews
- Use `usePanelLayoutStore` for getOpenViews and focusedPanelId
- Use `useUIStore` for activeView and setView
- Render `SidebarItem` for each pinned view
- Render "More" button (⋯) that toggles OverflowMenu
- Render model badge in footer
- Handle context menu actions (unpin, split, etc.) by delegating to store actions

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/layout/NeonSidebar.tsx src/renderer/src/components/layout/__tests__/NeonSidebar.test.tsx
git commit -m "feat: add NeonSidebar with pin/unpin and overflow menu"
```

---

## Task 7: HeaderTab Component

**Files:**
- Create: `src/renderer/src/components/layout/HeaderTab.tsx`

- [ ] **Step 1: Implement HeaderTab**

A single tab in the unified header.

Key props:
```typescript
interface HeaderTabProps {
  label: string;
  isActive: boolean;
  showDot?: boolean;
  showClose?: boolean;
  onClick: () => void;
  onClose: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}
```

Uses CSS classes from `neon-shell.css`: `.header-tab`, `.header-tab--active`, `.header-tab__dot`, `.header-tab__close`.

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/layout/HeaderTab.tsx
git commit -m "feat: add HeaderTab component"
```

---

## Task 8: UnifiedHeader Component

**Files:**
- Create: `src/renderer/src/components/layout/UnifiedHeader.tsx`
- Create: `src/renderer/src/components/layout/__tests__/UnifiedHeader.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// src/renderer/src/components/layout/__tests__/UnifiedHeader.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../stores/panelLayout', () => ({
  usePanelLayoutStore: vi.fn((sel: any) => sel({
    root: { type: 'leaf', panelId: 'p1', tabs: [
      { viewKey: 'dashboard', label: 'Dashboard' },
      { viewKey: 'ide', label: 'IDE' },
    ], activeTab: 0 },
    focusedPanelId: 'p1',
    closeTab: vi.fn(),
    setActiveTab: vi.fn(),
  })),
}));

vi.mock('../../../stores/ui', () => ({
  useUIStore: vi.fn((sel: any) => sel({ activeView: 'dashboard', setView: vi.fn() })),
}));

vi.mock('../../../stores/costData', () => ({
  useCostDataStore: vi.fn((sel: any) => sel({ totalCost: 4.2 })),
}));

vi.mock('../../../stores/theme', () => ({
  useThemeStore: vi.fn((sel: any) => sel({ theme: 'dark', toggleTheme: vi.fn() })),
}));

describe('UnifiedHeader', () => {
  it('renders the logo', async () => {
    const { UnifiedHeader } = await import('../UnifiedHeader');
    render(<UnifiedHeader />);
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('renders tabs for focused panel', async () => {
    const { UnifiedHeader } = await import('../UnifiedHeader');
    render(<UnifiedHeader />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('IDE')).toBeInTheDocument();
  });

  it('renders cost badge', async () => {
    const { UnifiedHeader } = await import('../UnifiedHeader');
    render(<UnifiedHeader />);
    expect(screen.getByText('$4.20')).toBeInTheDocument();
  });

  it('renders theme toggle', async () => {
    const { UnifiedHeader } = await import('../UnifiedHeader');
    render(<UnifiedHeader />);
    expect(screen.getByLabelText(/theme/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

- [ ] **Step 3: Implement UnifiedHeader**

Read these files first:
- `src/renderer/src/components/layout/TitleBar.tsx` — port action buttons (cost display, NotificationBell, theme toggle)
- `src/renderer/src/components/panels/PanelTabBar.tsx` — understand tab rendering
- `src/renderer/src/stores/costData.ts` — verify the field name for total cost (used in test mock as `totalCost`)
- `src/renderer/src/stores/theme.ts` — verify theme store shape

The component should:
- Logo zone (52px): "B" lettermark, click → navigate to dashboard
- Tab strip: Read focused panel's tabs from `usePanelLayoutStore`, render `HeaderTab` for each
- Action buttons: Cost (NeonBadge), NotificationBell (port from TitleBar), theme toggle
- Drag region: `.unified-header` has `-webkit-app-region: drag`, interactive elements are `no-drag`

**Important**: The `NotificationBell` component is imported in TitleBar — check if it's a separate component or inline. Port it to UnifiedHeader.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/layout/UnifiedHeader.tsx src/renderer/src/components/layout/__tests__/UnifiedHeader.test.tsx
git commit -m "feat: add UnifiedHeader with merged tabs and action buttons"
```

---

## Task 9: PanelLeaf Modification

**Files:**
- Modify: `src/renderer/src/components/panels/PanelLeaf.tsx`

- [ ] **Step 1: Read PanelLeaf.tsx and PanelTabBar.tsx**

Understand how tabs currently render. PanelLeaf renders PanelTabBar at line 181.

- [ ] **Step 2: Modify PanelLeaf**

Add conditional rendering:
- When the panel **is focused**: do NOT render PanelTabBar (tabs now render in UnifiedHeader)
- When the panel **is not focused**: render a slim 24px label showing the active tab name

```tsx
// Replace the PanelTabBar line with:
{isFocused ? null : (
  <div
    className="panel-label-slim"
    onClick={() => focusPanel(node.panelId)}
  >
    {node.tabs[node.activeTab]?.label ?? 'Untitled'}
  </div>
)}
```

The `isFocused` variable already exists in PanelLeaf (it's derived from `focusedPanelId === node.panelId`).

- [ ] **Step 3: Run existing PanelLeaf tests**

Run: `npx vitest run src/renderer/src/components/panels/__tests__/PanelLeaf.test.tsx`

Update any tests that assert PanelTabBar presence to account for the new conditional behavior.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/panels/PanelLeaf.tsx
git commit -m "feat: conditional tab bar — slim label for unfocused panels"
```

---

## Task 10: App.tsx Integration

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Delete: `src/renderer/src/components/layout/StatusBar.tsx`
- Modify: `src/renderer/src/assets/main.css`

- [ ] **Step 1: Read App.tsx fully**

Understand the current layout structure at lines 264-308.

- [ ] **Step 2: Swap shell components in App.tsx**

Replace:
- `<TitleBar ...>` → `<UnifiedHeader />`
- `<ActivityBar />` → `<NeonSidebar model={model} />`
- Remove `<StatusBar model={model} />`

Update imports accordingly. The `model` value is already computed in App.tsx — pass it to NeonSidebar instead of StatusBar.

Remove the TitleBar, ActivityBar, and StatusBar imports.

- [ ] **Step 3: Remove old CSS from main.css**

Remove these CSS sections from `src/renderer/src/assets/main.css`:
- Lines 46-117: TitleBar styles (`.titlebar`, `.titlebar__*`)
- Lines 296-384: ActivityBar styles (`.activity-bar`, `.activity-bar__*`)
- Lines 385-443: StatusBar styles (`.statusbar`, `.statusbar__*`)

Update the `.app-shell__body` flex layout to account for the new 52px sidebar and 44px header.

- [ ] **Step 4: Delete StatusBar and its test, plus old TitleBar, ActivityBar, and their tests**

**Note:** `neon/StatusBar.tsx` (the neon primitive) is a DIFFERENT component — do NOT delete that. Only delete `layout/StatusBar.tsx`.

```bash
git rm src/renderer/src/components/layout/StatusBar.tsx
git rm src/renderer/src/components/layout/__tests__/StatusBar.test.tsx
git rm src/renderer/src/components/layout/TitleBar.tsx
git rm src/renderer/src/components/layout/__tests__/TitleBar.test.tsx
git rm src/renderer/src/components/layout/ActivityBar.tsx
```

Check if PanelTabBar is still imported anywhere. If it's no longer used (tabs moved to UnifiedHeader), also delete:
```bash
git rm src/renderer/src/components/panels/PanelTabBar.tsx
git rm src/renderer/src/components/panels/__tests__/PanelTabBar.test.tsx
```

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Fix any broken tests. Tests that import StatusBar, TitleBar, or ActivityBar will need updating.

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add -u
git add src/renderer/src/components/layout/UnifiedHeader.tsx src/renderer/src/components/layout/NeonSidebar.tsx
git commit -m "feat: integrate unified header and neon sidebar into app shell"
```

---

## Task 11: Final Integration & Cleanup

**Files:**
- All modified files for consistency

- [ ] **Step 1: Run full test suite**

```bash
npm test && npm run test:main
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

- [ ] **Step 4: Fix any issues**

- [ ] **Step 5: Verify no stale imports remain**

Search for any remaining imports of deleted components (StatusBar, TitleBar, ActivityBar, PanelTabBar). Fix any that remain.

- [ ] **Step 6: Commit any fixes**

```bash
git add -u
git commit -m "chore: final cleanup for neon app shell redesign"
```

- [ ] **Step 7: Create PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: Neon app shell redesign — unified header + sidebar" --body "$(cat <<'EOF'
## Summary
- Unified header merging TitleBar + panel tabs into one 44px bar with full drag region
- 52px neon sidebar with icon-only nav, tooltips, and pin/unpin customization
- StatusBar eliminated — model badge in sidebar footer, cost in header
- Unfocused panels get slim 24px label bar
- Full neon V2 treatment on all shell chrome

## Test plan
- [ ] All tests pass (`npm test && npm run test:main`)
- [ ] Typecheck passes
- [ ] App window draggable from header gaps
- [ ] Sidebar shows pinned icons with tooltips on hover
- [ ] Right-click sidebar → unpin/pin works
- [ ] Overflow menu shows unpinned items
- [ ] Tab strip shows focused panel tabs
- [ ] Splitting panels → unfocused panel shows slim label
- [ ] Keyboard shortcuts (⌘1-9) still work
- [ ] Theme toggle works from header
- [ ] Cost badge shows in header
- [ ] Model name shows in sidebar footer

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
