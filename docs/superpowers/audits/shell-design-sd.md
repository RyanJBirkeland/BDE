# Shell & Design System — Senior Developer Audit

**Auditor:** SD (Code Quality, Security, Performance, Error Boundaries, Keyboard Handling, Zustand Patterns)
**Date:** 2026-03-28
**Scope:** App.tsx, DashboardView, SettingsView, layout/_, neon/_, ui/_, panels/_, stores/panelLayout.ts

---

## 1. Executive Summary

The shell and design system layer is architecturally sound: panel layout uses pure recursive functions, views are lazy-loaded with error boundaries, and Zustand usage is generally idiomatic with single-field selectors. However, there are several significant issues: a Zustand selector anti-pattern in `NeonSidebar.tsx` that causes full re-renders on every store mutation; the keyboard handler in `App.tsx` misses `contentEditable` elements; the `NotificationBell` calls `getUnreadCount()` (a function that computes a new value each render) as a selector, defeating referential stability; and the `ErrorBoundary` has no recovery mechanism. The neon component library is well-structured with consistent token usage, but the `DashboardView` has excessive inline styles and hardcoded `rgba()` values that violate the CSS theming rule.

---

## 2. Critical Issues

### 2.1 Keyboard shortcuts fire inside contentEditable elements

**File:** `src/renderer/src/App.tsx`, line 177-178

```ts
const tag = (e.target as HTMLElement).tagName
const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
```

The guard checks `tagName` but does not check `contentEditable`. Monaco editor and any `contentEditable` div will not be caught — typing `?` in the editor will toggle the shortcuts overlay, and `Cmd+P` will open the command palette instead of Monaco's own quick-open. The `[` and `]` bracket shortcuts in focused views could also conflict.

**Fix:** Add `(e.target as HTMLElement).isContentEditable` to the `inInput` check.

### 2.2 `window.confirm()` used in CommandPalette — blocks main thread

**File:** `src/renderer/src/components/layout/CommandPalette.tsx`, line 131

```ts
if (!window.confirm(`Kill ${processes.length} running agent...`))
```

`window.confirm()` is a synchronous blocking dialog. In Electron this freezes the renderer process. The codebase already has `useConfirm()` hook and `ConfirmModal` component for this purpose.

**Fix:** Replace with the `useConfirm()` hook pattern.

### 2.3 ErrorBoundary has no recovery/retry mechanism

**File:** `src/renderer/src/components/ui/ErrorBoundary.tsx`, lines 25-47
Once a view crashes, the error boundary displays the error message permanently. There is no "Try Again" button or way to reset the boundary state. The user must reload the entire application to recover a crashed panel.

**Fix:** Add a retry button that calls `this.setState({ error: null })` to re-attempt rendering.

### 2.4 Unsanitized `viewLink` cast to `View` type in NotificationBell

**File:** `src/renderer/src/components/layout/NotificationBell.tsx`, line 72

```ts
const viewName = viewLink.replace(/^\//, '').split('/')[0] as View
setView(viewName)
```

The `viewLink` string is cast directly to `View` with no validation. If the notification payload contains an unexpected value (e.g., from a malformed IPC message), this will silently set a non-existent view, potentially causing a runtime crash in `resolveView()` since the switch has no `default` case.

**Fix:** Validate against the `View` union values before calling `setView()`.

---

## 3. Significant Issues

### 3.1 NeonSidebar destructures action functions without selectors — re-renders on every store mutation

**File:** `src/renderer/src/components/layout/NeonSidebar.tsx`, line 67

```ts
const { splitPanel, addTab, closeTab, findPanelByView } = usePanelLayoutStore()
```

Calling `usePanelLayoutStore()` with no selector subscribes to the **entire** store. Every `root` mutation (any tab/panel change anywhere) forces NeonSidebar to re-render. This is compounded by line 72 calling `getOpenViews(root)` which creates a new array on every render.

**Fix:** Extract each function via individual selectors (functions are referentially stable in Zustand), or use `useShallow` for the batch.

### 3.2 Similarly, `useSidebarStore()` is called without a selector

**File:** `src/renderer/src/components/layout/NeonSidebar.tsx`, line 63

```ts
const { pinView, unpinView } = useSidebarStore()
```

Same anti-pattern — subscribes to entire sidebar store.

### 3.3 `getUnreadCount` called as a selector returns a new value on each state change

**File:** `src/renderer/src/components/layout/NotificationBell.tsx`, line 41-44

```ts
const getUnreadCount = useNotificationsStore((s) => s.getUnreadCount)
const unreadCount = getUnreadCount()
```

`getUnreadCount` is a function that calls `get().notifications.filter(...)` — it recomputes on every call but the selector `(s) => s.getUnreadCount` returns a stable function reference, so that part is fine. However, the component will not re-render when the count changes because the selector returns the same function reference. This means the badge count may be stale until something else triggers a re-render.

**Fix:** Use `const unreadCount = useNotificationsStore((s) => s.notifications.filter(n => !n.read).length)` as a derived selector, or move `getUnreadCount` to a computed property pattern.

### 3.4 `UnifiedHeader` derives `focusedPanel` during render via tree traversal

**File:** `src/renderer/src/components/layout/UnifiedHeader.tsx`, line 21

```ts
const focusedPanel = focusedPanelId ? findLeaf(root, focusedPanelId) : null
```

`findLeaf` walks the entire panel tree on every render. Since the component subscribes to `root` (which changes on every panel mutation), this runs frequently. For typical 2-3 panel layouts this is negligible, but it's an O(n) traversal in the render path that could be memoized.

### 3.5 `DashboardView` violates CSS theming rule with hardcoded rgba values

**File:** `src/renderer/src/views/DashboardView.tsx`, multiple locations (lines 346, 368, 376, 420, 427, 438, 516)

```ts
color: 'rgba(255, 255, 255, 0.3)' // line 346
color: 'rgba(255, 255, 255, 0.4)' // line 368
color: '#fff' // line 438
```

Per the CSS theming rule in CLAUDE.md: "Never use hardcoded `rgba()` for overlays or `box-shadow`." These values will not adapt to the light theme.

### 3.6 ParticleField uses `willChange: 'transform'` on 18 elements

**File:** `src/renderer/src/components/neon/ParticleField.tsx`, line 56
Each of the 18 particle divs has `willChange: 'transform'`, promoting them to compositor layers. This consumes GPU memory and may cause compositing overhead on lower-end machines.

**Fix:** Consider using a single `<canvas>` element for particle effects, or at minimum reduce the default density.

### 3.7 Panel layout persistence subscription fires on every state change

**File:** `src/renderer/src/stores/panelLayout.ts`, lines 519-525

```ts
usePanelLayoutStore.subscribe((state) => {
  ...
  _saveTimeout = setTimeout(() => {
    window.api.settings.setJson('panel.layout', state.root).catch(() => {})
  }, 500)
})
```

The subscriber fires on every state change (including `activeView`, `focusedPanelId`), not just `root` changes. The debounce helps, but the subscriber should filter to only persist when `root` actually changes.

### 3.8 `setView` triggers multiple sequential state updates

**File:** `src/renderer/src/stores/panelLayout.ts`, lines 492-510
`setView` calls `focusPanel` then `setActiveTab` then `set({ activeView })` — up to 3 separate `set()` calls in sequence. Each triggers the subscriber and potentially a re-render cycle.

**Fix:** Batch the logic into a single `set()` call.

### 3.9 `closeTab` in NeonSidebar "Close All" runs in a while loop

**File:** `src/renderer/src/components/layout/NeonSidebar.tsx`, lines 99-109

```ts
let leaf = findPanelByView(view)
while (leaf) {
  const tabIdx = leaf.tabs.findIndex((t) => t.viewKey === view)
  if (tabIdx >= 0) {
    closeTab(leaf.panelId, tabIdx)
  }
  leaf = usePanelLayoutStore.getState().findPanelByView(view)
}
```

Each iteration triggers a full state update, subscriber, and potential re-render. If a view appears in many panels, this creates a cascade. Not a likely real-world scenario (typically 1-2 panels), but the pattern is fragile. If `closeTab` fails to remove the view for any reason, this becomes an infinite loop.

---

## 4. Minor Issues

### 4.1 Duplicate `VIEW_LABELS` and `VIEW_ICONS` maps

`VIEW_LABELS` is defined identically in three places:

- `src/renderer/src/stores/panelLayout.ts` (line 43)
- `src/renderer/src/components/layout/NeonSidebar.tsx` (line 31)
- `src/renderer/src/components/layout/OverflowMenu.tsx` (line 30)

`VIEW_ICONS` is duplicated between NeonSidebar and OverflowMenu. `VIEW_TITLES` in App.tsx is a fourth copy.

**Fix:** Export from a single source (e.g., `panelLayout.ts` or a new `view-constants.ts`).

### 4.2 `ConfirmModal.tsx` has `import { useState }` at line 167, after the component

**File:** `src/renderer/src/components/ui/ConfirmModal.tsx`, line 167
A second `import { useState } from 'react'` appears at the bottom of the file, inside the helper function section. This works in bundlers but violates the ES module spec (imports must be at top level) and is confusing.

### 4.3 `SidebarItem` context menu uses inline styles instead of CSS classes

**File:** `src/renderer/src/components/layout/SidebarItem.tsx`, lines 92-140
The context menu has extensive inline styles with `onMouseEnter`/`onMouseLeave` handlers that imperatively set `style.background` and `style.color`. This bypasses the CSS theming system and is fragile.

### 4.4 `OverflowMenu` click-outside handler uses `setTimeout(fn, 0)`

**File:** `src/renderer/src/components/layout/OverflowMenu.tsx`, line 67-68

```ts
const timer = setTimeout(() => {
  document.addEventListener('mousedown', handleClickOutside)
}, 0)
```

The zero-timeout hack avoids the trigger click closing the menu immediately. This is a timing-dependent workaround that could break under heavy main-thread load.

### 4.5 `ElapsedTime` ticks every second regardless of visibility

**File:** `src/renderer/src/components/ui/ElapsedTime.tsx`, lines 11-14
The 1-second interval runs even when the component is scrolled out of view or in a hidden tab. For a single instance this is negligible, but if many are rendered (e.g., in a task list), it adds up.

### 4.6 Missing `key` stability in `PanelLeaf` tab rendering

**File:** `src/renderer/src/components/panels/PanelLeaf.tsx`, line 177

```ts
key={`${tab.viewKey}-${index}`}
```

If tabs are reordered, the `index` portion of the key changes, causing unnecessary unmount/remount of the view components. This could lose internal state (e.g., scroll position, form inputs).

### 4.7 Global module-level `idCounter` in panelLayout store

**File:** `src/renderer/src/stores/panelLayout.ts`, line 58

```ts
let idCounter = 0
```

This mutable global is not reset between hot-module reloads, potentially causing panel ID collisions during development. The `_resetIdCounter()` export is only for tests.

### 4.8 `DashboardView` has no `ErrorBoundary` wrapping

The `DashboardView` is the only view that renders directly without its own internal error boundary. While the `PanelLeaf` wraps each view in an `ErrorBoundary`, a crash in any of the neon sub-components (e.g., `MiniChart` receiving malformed data) would take down the entire dashboard, which is the default landing view.

### 4.9 `Textarea` auto-resize triggers layout thrash

**File:** `src/renderer/src/components/ui/Textarea.tsx`, lines 21-26

```ts
el.style.height = 'auto'
el.style.height = `${el.scrollHeight}px`
```

Setting height to `auto` then reading `scrollHeight` forces a synchronous layout reflow on every value change. For rapidly typed input this causes jank.

### 4.10 `CommandPalette` `flatIndexMap` uses `Map` (minor)

**File:** `src/renderer/src/components/layout/CommandPalette.tsx`, line 234
Uses `new Map<string, number>()` inside a `useMemo`. This is fine for a local variable (not Zustand state), but worth noting as a style inconsistency given the CLAUDE.md Zustand `Map` anti-pattern warning.

---

## 5. Re-render Risk Map

| Component                                         | Risk        | Trigger                   | Root Cause                                                                                                                         |
| ------------------------------------------------- | ----------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **NeonSidebar**                                   | HIGH        | Any panel/tab mutation    | `usePanelLayoutStore()` with no selector (line 67) subscribes to entire store; `getOpenViews(root)` computes new array each render |
| **UnifiedHeader**                                 | MEDIUM-HIGH | Any panel/tab mutation    | Subscribes to `root` (new ref on every mutation) + `focusedPanelId`; derives `tabs` array via `findLeaf` every render              |
| **App**                                           | MEDIUM      | Panel focus/view change   | Subscribes to `activeView`, `root`, `paletteOpen`, `shortcutsOpen`; `handleKeyDown` recreated when any dependency changes          |
| **DashboardView**                                 | MEDIUM      | Any sprint task change    | `useSprintTasks((s) => s.tasks)` — `tasks` is a new array on every fetch/poll cycle                                                |
| **NotificationBell**                              | LOW-MEDIUM  | Any notification mutation | `getUnreadCount` selector is stable but the computed `unreadCount` may be stale (see issue 3.3)                                    |
| **ToastContainer**                                | LOW         | Toast add/remove only     | Clean selectors; only re-renders when toast list changes                                                                           |
| **PanelLeaf**                                     | LOW         | Focus change + tab change | Subscribes to `focusedPanelId` and `focusPanel` (both stable)                                                                      |
| **CommandPalette**                                | LOW         | Only when open            | Heavy computation (commands, filtering, grouping) but only runs when palette is visible                                            |
| **Neon primitives** (NeonCard, StatCounter, etc.) | NONE        | Props-only                | Pure presentational, no store subscriptions                                                                                        |
| **UI primitives** (Button, Badge, Input, etc.)    | NONE        | Props-only                | Pure presentational                                                                                                                |

### Cascade Risk

The most concerning cascade is: any `panelLayout` store mutation (tab switch, panel focus, split, close) triggers re-renders in **NeonSidebar**, **UnifiedHeader**, and **App** simultaneously. NeonSidebar is the worst offender because it subscribes to the full store and then calls `getOpenViews()` which creates new arrays, plus iterates all pinned views to render `SidebarItem` components. For a typical 8-view sidebar with 2-3 open panels, this is ~20 component re-renders per tab click.
