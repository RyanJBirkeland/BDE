# Neon App Shell Redesign — Design Spec

**Date**: 2026-03-24
**Status**: Approved
**Scope**: Full app shell — unified header, neon sidebar, status bar removal, neon visual treatment

## Overview

Redesign BDE's app shell from a 3-tier layout (TitleBar + ActivityBar + StatusBar) into a streamlined 2-tier layout inspired by Arc Browser. The TitleBar and PanelTabBar merge into one unified header. The ActivityBar becomes an ultra-slim 52px icon-only sidebar with pin/unpin customization. The StatusBar is eliminated — useful info moves to the sidebar footer and header actions. All shell chrome gets the V2 neon cyberpunk treatment using existing primitives.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout style | Arc Browser (option C) | Most space-efficient, clean, modern. Icon-only sidebar maximizes content area. |
| Header | Unified header merging TitleBar + tab bar | Eliminates wasted vertical space, provides wide drag region |
| Sidebar | 52px icon-only with tooltips | Minimal chrome, customizable via pin/unpin |
| StatusBar | Eliminated | Redundant — model badge moves to sidebar footer, cost to header |
| Customization | Pin/unpin with overflow "more" menu | All features remain discoverable, users prioritize what they use |
| Panel detachment | Out of scope (future spec) | Multi-window requires separate IPC/state architecture |

## Section 1: Unified Header Bar (44px)

The TitleBar and PanelTabBar merge into a single 44px unified header row.

### Layout

```
┌──────┬──────────────────────────────────────────┬──────────┐
│ [B]  │  ◉ Dashboard  ×  │  IDE  ×  │  Sprint  × │ $4.20 ☽ │
│ logo │  ← tabs flow here, drag region in gaps → │ actions  │
└──────┴──────────────────────────────────────────┴──────────┘
  52px              flex: 1                          ~100px
```

### Logo Zone (52px)

- Width matches sidebar (52px) so edges align vertically.
- Single "B" lettermark in neon purple with glow (`text-shadow: var(--neon-purple-glow)`).
- Clickable — navigates to Dashboard (home).
- NOT a drag region (`-webkit-app-region: no-drag`).

### Tab Strip (flex: 1)

- Shows tabs for the **focused panel only**.
- Active tab: Raised glass card with `backdrop-filter: blur(16px)`, neon purple border-top, `border-bottom: transparent` to visually connect to content below. Green status dot before label.
- Inactive tabs: Minimal text, muted color, transparent background.
- Each tab has a close × button (hidden if it's the only tab in the only panel).
- Tabs are draggable for reordering within the strip.
- **Empty space between/around tabs is the drag region** (`-webkit-app-region: drag`). Tabs and buttons are `no-drag`.

### Action Buttons (~100px)

- **Cost badge**: Neon cyan `NeonBadge` showing current cost (e.g., `$4.20`).
- **Notification bell**: Icon with pink dot indicator for unread notifications.
- **Theme toggle**: Moon/sun icon for dark/light mode.
- All are `no-drag`.

### Multi-Panel Behavior

When multiple panels are open (split layout), the header shows tabs for the **focused panel only**. A subtle colored indicator (thin 2px line at the bottom of the header, matching the focused panel's position) shows which panel is active. Clicking a different panel in the content area updates the header tabs.

### What Moves Here

- Cost display (from old StatusBar/TitleBar)
- Notification bell (from old TitleBar)
- Theme toggle (from old TitleBar)
- Panel tabs (from old PanelTabBar inside PanelLeaf)

### What's Removed

- Old TitleBar component (32px) — replaced by UnifiedHeader
- Old PanelTabBar inside PanelLeaf — tabs render in header instead
- "BDE" logotype — replaced by single "B" lettermark

## Section 2: Neon Sidebar (52px, icon-only)

The ActivityBar becomes an ultra-slim 52px icon rail with neon treatment.

### Layout

```
┌──────┐
│  [B] │  ← logo zone (part of header, aligned)
├──────┤
│  ⬡   │  Dashboard (active — glow + left accent bar)
│  ◎   │  Agents
│  ⟨⟩  │  IDE
│  ▶   │  Sprint
│  ⎇   │  PR Station
│      │
│      │  (spacer)
│      │
│  ⋯   │  "More" overflow menu
│ haiku│  model badge
└──────┘
```

### Icon Buttons (32×32px)

- **Icon-only** — no labels in the sidebar. Labels appear as neon-tinted tooltips on hover.
- Icon size: 18px, lucide-react icons (same icon set as current).
- Button size: 32×32px with 8px border-radius.

### States

- **Active**: Left 3px accent bar (neon purple) + icon color brightens to `var(--neon-purple)` + subtle glow background `var(--neon-purple-surface)`.
- **Hover**: Glass surface background, icon brightens to white.
- **Open-in-tab dot**: Small 4px neon dot (top-right corner of icon) if that view is open in a panel tab but not currently focused.
- **Default**: Icon at `rgba(255, 255, 255, 0.3)`, no background.

### Tooltips

- Appear after 300ms hover delay, positioned to the right of the icon.
- Glass panel style with neon purple tint.
- Show view name + keyboard shortcut (e.g., "Dashboard ⌘1").
- Dismiss on mouse leave or click.

### Pin/Unpin System

- All 9+ views start pinned by default in current order.
- **Right-click context menu** on any icon:
  - "Unpin from sidebar" — removes icon, moves to overflow menu
  - "Open to the Right" (existing)
  - "Open Below" (existing)
  - "Open in New Tab" (existing)
  - "Close All" (existing)
- The **"More" button (⋯)** at the bottom opens a popover showing unpinned items.
  - Each unpinned item shows icon + label + "Pin to sidebar" action.
  - Popover styled as `GlassPanel` with neon treatment.
  - Also shows a "Customize sidebar..." link that navigates to Settings view.
- Pinned icons are **draggable to reorder**. Drag indicators show drop positions.
- Pin order persisted to `sidebar.pinnedViews` setting (JSON array of View strings).

### Sidebar Footer

- **Model badge**: Tiny monospace text in a glass pill (e.g., "haiku", "sonnet", "opus").
  - Shows current model from settings.
  - Positioned above the "More" button.
  - `font-size: 9px`, `color: rgba(255, 255, 255, 0.3)`, glass border.

### Sidebar Background

- `background: linear-gradient(180deg, rgba(138, 43, 226, 0.04), rgba(10, 0, 21, 0.4))`
- `border-right: 1px solid var(--neon-purple-border)`
- Subtle atmosphere matching the neon bg gradient.

## Section 3: Component Architecture

### New Components

| Component | File | Responsibility |
|-----------|------|----------------|
| `UnifiedHeader` | `src/renderer/src/components/layout/UnifiedHeader.tsx` | Replaces TitleBar + PanelTabBar. Logo zone + tab strip + action buttons. Drag region management. |
| `HeaderTab` | `src/renderer/src/components/layout/HeaderTab.tsx` | Single tab — glass active state, close button, status dot, drag support. |
| `NeonSidebar` | `src/renderer/src/components/layout/NeonSidebar.tsx` | Replaces ActivityBar. 52px icon rail with pin/unpin, reorder, tooltips. |
| `SidebarItem` | `src/renderer/src/components/layout/SidebarItem.tsx` | Single nav icon — active glow, hover glass, tooltip, right-click menu, drag reorder. |
| `OverflowMenu` | `src/renderer/src/components/layout/OverflowMenu.tsx` | Popover for unpinned items. `GlassPanel` with pin actions. |
| `NeonTooltip` | `src/renderer/src/components/neon/NeonTooltip.tsx` | Reusable neon-styled tooltip. Positioned right of trigger, accent-tinted, 300ms delay. |

### Modified Files

| File | Change |
|------|--------|
| `src/renderer/src/App.tsx` | Swap TitleBar/ActivityBar/StatusBar for UnifiedHeader + NeonSidebar. Remove StatusBar. |
| `src/renderer/src/components/panels/PanelLeaf.tsx` | Remove PanelTabBar rendering — tabs now render in UnifiedHeader. Keep view content rendering. |
| `src/renderer/src/stores/panelLayout.ts` | Minor: PanelLeaf tab rendering logic adjustments for focused/unfocused behavior. |
| `src/renderer/src/stores/sidebar.ts` | **New store** for sidebar pin/unpin state, persisted separately from panel layout. |
| `src/renderer/src/assets/main.css` | Remove old TitleBar/ActivityBar/StatusBar CSS. Add neon shell styles (or create `neon-shell.css`). |

### Deleted Components

| Component | Reason |
|-----------|--------|
| `TitleBar.tsx` | Replaced by UnifiedHeader |
| `ActivityBar.tsx` | Replaced by NeonSidebar |
| `StatusBar.tsx` | Eliminated — info moved to sidebar footer and header actions |
| `PanelTabBar.tsx` | Tabs moved into UnifiedHeader |

### Reused Neon Primitives

- `GlassPanel` — overflow menu popover
- `NeonBadge` — cost badge, notification indicator
- `neonVar()` — all accent colors throughout shell
- Neon CSS tokens — `--neon-purple-*`, `--neon-cyan-*`, glass variables

## Section 4: State & Data Flow

### Sidebar State

Sidebar customization state lives in its own store (`src/renderer/src/stores/sidebar.ts`), separate from `panelLayout.ts`. Panel layout and sidebar customization are orthogonal concerns — keeping them in separate stores follows the "max one Zustand store per domain concern" convention.

```typescript
// src/renderer/src/stores/sidebar.ts
interface SidebarStore {
  // State
  pinnedViews: View[]  // ordered list of pinned sidebar items

  // Derived (computed in selectors, not stored)
  // unpinnedViews: ALL_VIEWS.filter(v => !pinnedViews.includes(v))

  // Actions
  pinView(view: View): void      // add to end of pinnedViews
  unpinView(view: View): void    // remove from pinnedViews
  reorderViews(views: View[]): void  // set new pinned order after drag
}
```

- Persisted to `sidebar.pinnedViews` setting via its own subscription (separate from `panel.layout`).
- Default value: all views in current order (`['dashboard', 'agents', 'ide', 'sprint', 'pr-station', 'git', 'memory', 'cost', 'settings', 'task-workbench']`).

### Tab State

The panel tab data model stays the same (PanelNode tree with leaf nodes containing `tabs[]` and `activeTab`). What changes is **where tabs render**:

- **Before**: Each PanelLeaf renders its own PanelTabBar inside the panel.
- **After**: The UnifiedHeader reads tabs from the **focused panel's leaf node** and renders them in the header.

**Unfocused panels retain a minimal inline tab bar.** When a panel is not focused, PanelLeaf renders a slim 24px collapsed tab bar showing just the active tab label (no close buttons, no full tab strip). This serves as both a label for the panel content and a click target to focus the panel. When clicked, the panel focuses and its full tabs appear in the header. This ensures users can always see what's in each panel and can switch focus.

When the focused panel changes (click or keyboard), the header tabs update to show that panel's tabs.

### Drag Region

- Entire header background: `-webkit-app-region: drag`
- Logo, tabs, action buttons: `-webkit-app-region: no-drag`
- This gives a wide, natural drag target in all the gaps between interactive elements.

### Keyboard Shortcuts

All existing shortcuts preserved:
- ⌘1-9: Switch to view (unchanged — triggers via NeonSidebar or direct)
- ⌘P: Command palette (unchanged)
- ⌘\: Split panel (unchanged)
- ⌘W: Close tab (now reflected in header tab strip)
- ⌘Shift-[ / ]: Cycle tabs (reflected in header)

### Removed State

- StatusBar component and rendering
- Old TitleBar internal state
- Old ActivityBar internal state
- PanelTabBar component (but tab data in panelLayout store remains)

## File Locations

| What | Where |
|------|-------|
| UnifiedHeader | `src/renderer/src/components/layout/UnifiedHeader.tsx` |
| HeaderTab | `src/renderer/src/components/layout/HeaderTab.tsx` |
| NeonSidebar | `src/renderer/src/components/layout/NeonSidebar.tsx` |
| SidebarItem | `src/renderer/src/components/layout/SidebarItem.tsx` |
| OverflowMenu | `src/renderer/src/components/layout/OverflowMenu.tsx` |
| NeonTooltip | `src/renderer/src/components/neon/NeonTooltip.tsx` |
| Shell CSS | `src/renderer/src/assets/neon-shell.css` (new) |
| Sidebar store | `src/renderer/src/stores/sidebar.ts` (new) |
| Panel store tweaks | `src/renderer/src/stores/panelLayout.ts` |
| App shell | `src/renderer/src/App.tsx` |

## Non-Goals

- Panel detachment / floating windows (separate future spec)
- Mobile/responsive layout (Electron desktop only)
- Changes to the panel split system (PanelRenderer stays untouched)
- Changes to the view components themselves (only the shell chrome changes)
- Light theme polish (follow-up, same as Ops Deck Phase 4)
