# Shell & Design System PM Audit

**Date:** 2026-03-27
**Scope:** App shell (`App.tsx`), Dashboard, Settings, Layout components, Panel system, Navigation sidebar, Command palette
**Auditor lens:** UX completeness, first-run experience, navigation, discoverability, information architecture

---

## 1. Executive Summary

The BDE shell provides a functional IDE-style layout with a sidebar, header tabs, panel splitting, and a command palette. The foundation is solid -- keyboard shortcuts, drag-and-drop docking, and persistent layouts are all present. However, the app suffers from a significant discoverability gap: the panel system's most powerful features (splitting, tab docking, drag-and-drop) are invisible to users who don't know to right-click sidebar items or drag them. The Dashboard is dense with operational data but lacks actionable next-steps for new or returning users. Settings is well-organized with 9 tabs but the "Connections" default landing tab shows credentials that a first-time user won't have, making it feel broken rather than welcoming.

---

## 2. Critical Issues

### 2.1 No onboarding for the panel system -- users can't discover splitting or recover from bad layouts

The panel system supports splitting (Cmd+\), drag-and-drop docking (5-zone hit testing), tab management (Cmd+W, Cmd+Shift+[/]), and layout reset. None of these features are taught or even hinted at anywhere in the UI. The shortcuts overlay (`App.tsx` lines 48-62) mentions "Switch views" and "Command palette" but does not mention Cmd+\, Cmd+W, or Cmd+Shift+[/]. The only way to discover splitting is via the right-click context menu on sidebar items (`SidebarItem.tsx` lines 103-108) or the command palette's "Split Right" / "Split Below" commands.

**Impact:** Users who accidentally split their layout have no way to know they can close panels (Cmd+W) or reset the layout. The "Reset Layout" action exists only inside the command palette (`CommandPalette.tsx` line 189-194), which itself requires knowing Cmd+P.

**Files:** `src/renderer/src/App.tsx` lines 48-62 (shortcuts list is incomplete), `src/renderer/src/components/panels/PanelLeaf.tsx` (no visual affordance for drop zones), `src/renderer/src/components/layout/CommandPalette.tsx` lines 186-194 (reset layout buried)

### 2.2 Dashboard has no empty state guidance

When a new user passes onboarding, the default layout opens to Dashboard (`panelLayout.ts` line 354: `DEFAULT_LAYOUT = createLeaf('dashboard')`). With zero tasks, zero agents, and zero cost data, the dashboard shows:

- All StatCounters at 0
- Empty MiniCharts (no data bars)
- "No completions yet" in Recent Completions
- "No terminal tasks" in Success Rate
- "$0.00" cost
- Empty activity feed

There is no call-to-action, no "Get Started" prompt, no link to create a first task or spawn an agent. The dashboard becomes a wall of zeroes.

**Files:** `src/renderer/src/views/DashboardView.tsx` lines 392-394 (only empty state is "No completions yet"), lines 464-469 ("No terminal tasks" for success ring)

### 2.3 Sidebar does not load saved pin configuration on startup

The `sidebar.ts` store has a `loadSaved()` method (`src/renderer/src/stores/sidebar.ts` lines 43-54) that reads persisted sidebar pin preferences, but it is never called on app startup. `App.tsx` calls `loadLayout()` for the panel layout and `restorePendingReview()` for reviews, but there is no `loadSaved()` call for the sidebar store. Users who unpin views will find them all restored on next launch.

**Files:** `src/renderer/src/stores/sidebar.ts` lines 43-54 (loadSaved exists), `src/renderer/src/App.tsx` lines 140-150 (loadLayout and restorePendingReview called, but no sidebar loadSaved)

---

## 3. Significant Issues

### 3.1 Dashboard stat counters navigate with wrong filter mapping

The "Queued" counter navigates to sprint with filter `'todo'` (`DashboardView.tsx` line 309), and "PRs" navigates with `'awaiting-review'` (line 317). These filter values are `StatusFilter` type from `sprintUI` store, not raw task statuses. If the sprint pipeline's partition logic doesn't map these identically, users could see mismatched counts between dashboard and pipeline.

**Files:** `src/renderer/src/views/DashboardView.tsx` lines 302-331

### 3.2 Notification bell dropdown has no persistence -- all notifications vanish on reload

The `notifications.ts` store (`src/renderer/src/stores/notifications.ts`) is purely in-memory with a module-level `nextId` counter. On window reload, all notifications are lost. For a desktop app where agents run for extended periods, losing the notification history on any app restart is a significant gap.

**Files:** `src/renderer/src/stores/notifications.ts` (no persistence mechanism)

### 3.3 Command palette "Kill All" uses `window.confirm` -- breaks visual consistency

The "Kill All" command in the command palette (`CommandPalette.tsx` lines 131-136) uses the native `window.confirm()` dialog instead of the app's own `useConfirm` hook. This produces an OS-native dialog that looks jarring inside the neon-themed Electron app and doesn't match the design system.

**Files:** `src/renderer/src/components/layout/CommandPalette.tsx` lines 131-136

### 3.4 Header tab strip only shows focused panel's tabs

`UnifiedHeader.tsx` (lines 21-23) only renders tabs from the focused panel (`focusedPanel?.tabs`). In a multi-panel split layout, the header shows 1-2 tabs for the focused panel while other panels' tabs are invisible in the header. Users must click unfocused panels to see their tabs in the header, which is not intuitive for an IDE-style experience (VS Code shows all open editors in tabs regardless of focus).

**Files:** `src/renderer/src/components/layout/UnifiedHeader.tsx` lines 21-23, 49-59

### 3.5 Unfocused panels show a minimal "panel-label-slim" bar instead of tabs

When a panel is not focused, `PanelLeaf.tsx` (lines 167-170) renders a tiny label bar (`panel-label-slim`) showing only the active tab's label. There is no tab bar, no close button, and no way to switch tabs within an unfocused panel without first clicking to focus it. This two-click tax adds friction to multi-panel workflows.

**Files:** `src/renderer/src/components/panels/PanelLeaf.tsx` lines 167-170

### 3.6 Settings "Customize sidebar..." link in overflow menu goes to Settings but not to any specific section

The overflow menu's "Customize sidebar..." button (`OverflowMenu.tsx` lines 162-178) navigates to the Settings view but doesn't deep-link to any particular settings tab. There is no "Sidebar" settings section -- the Appearance tab is the closest match but it handles theme toggle. Users click "Customize sidebar" and land on the Connections tab with no guidance on where sidebar customization lives.

**Files:** `src/renderer/src/components/layout/OverflowMenu.tsx` lines 108-111, `src/renderer/src/views/SettingsView.tsx` lines 19-29 (no sidebar-specific tab)

### 3.7 Onboarding labels Supabase as connected/not-connected but Supabase is optional/legacy

The onboarding screen (`Onboarding.tsx` lines 223-227) checks for Supabase connectivity and shows it as an optional check. However, per the codebase docs, sprint tasks migrated to local SQLite and Supabase is only for a one-time import. Showing "Supabase connected" as a health check misleads new users into thinking they need to configure Supabase for the app to work.

**Files:** `src/renderer/src/components/Onboarding.tsx` lines 153-156, 223-227

### 3.8 Panel resize handle has no visual indicator

`PanelResizeHandle.tsx` renders a 4px transparent bar with only a cursor change on hover. There is no visible divider line, no drag handle dots, and no hover highlight. Users have no visual cue that panels can be resized.

**Files:** `src/renderer/src/components/panels/PanelResizeHandle.tsx` lines 5-22

---

## 4. Minor Issues

### 4.1 Shortcuts overlay is incomplete

The shortcuts overlay (`App.tsx` lines 48-62) documents 10 shortcuts across two columns but is missing several functional shortcuts: Cmd+\ (split panel), Cmd+W (close tab), Cmd+Shift+[/] (cycle tabs), and Cmd+0 (Task Workbench). The "[/]" shortcut listed as "Prev / next diff file" is context-specific to PR Station but shown as a global shortcut.

**Files:** `src/renderer/src/App.tsx` lines 48-62

### 4.2 Dashboard uses inline styles extensively instead of CSS classes

`DashboardView.tsx` uses inline `style` objects for nearly all layout (grid template, flex, gaps, colors). This makes the dashboard the only major view without a dedicated `*-neon.css` file, inconsistent with the neon styling convention documented in CLAUDE.md. It also uses hardcoded `rgba()` values (e.g., line 346: `rgba(255, 255, 255, 0.3)`, line 439: `#fff`) instead of CSS custom properties, violating the CSS theming rule.

**Files:** `src/renderer/src/views/DashboardView.tsx` (pervasive inline styles, lines 217-449)

### 4.3 VIEW_LABELS and VIEW_ICONS are duplicated in 3 files

`VIEW_LABELS` is defined in `panelLayout.ts` (lines 43-52), `NeonSidebar.tsx` (lines 31-40), and `OverflowMenu.tsx` (lines 30-39). `VIEW_ICONS` is duplicated in `NeonSidebar.tsx` (lines 20-29) and `OverflowMenu.tsx` (lines 19-28). These must be kept in sync manually. A single source of truth would prevent drift.

**Files:** `src/renderer/src/stores/panelLayout.ts` lines 43-52, `src/renderer/src/components/layout/NeonSidebar.tsx` lines 20-40, `src/renderer/src/components/layout/OverflowMenu.tsx` lines 19-39

### 4.4 SidebarItem context menu uses inline styles for a complex menu

`SidebarItem.tsx` (lines 92-140) renders a full context menu with 5 options using inline styles and manual `onMouseEnter`/`onMouseLeave` handlers for hover effects. This should use a shared context menu component or at least CSS classes for maintainability.

**Files:** `src/renderer/src/components/layout/SidebarItem.tsx` lines 92-140

### 4.5 Toast container `aria-atomic="true"` may cause screen readers to re-read all toasts

With `aria-atomic="true"` on the container (`ToastContainer.tsx` line 63), every time a new toast is added, screen readers will announce the entire container's content, not just the new toast. For a queue that can hold up to 4 toasts, this means repetitive announcements.

**Files:** `src/renderer/src/components/layout/ToastContainer.tsx` line 63

### 4.6 Logo "B" in header has no tooltip or label

The `UnifiedHeader.tsx` logo zone (line 44-46) renders a single "B" letter that navigates to Dashboard on click. There is no `title`, `aria-label`, or tooltip explaining what clicking it does.

**Files:** `src/renderer/src/components/layout/UnifiedHeader.tsx` lines 44-46

### 4.7 Default `activeView` is 'agents' but default layout opens 'dashboard'

`panelLayout.ts` line 386 initializes `activeView: 'agents'` but the default layout (line 354) creates a dashboard leaf. This mismatch means `activeView` briefly disagrees with what's rendered until `loadSavedLayout` runs. For returning users, `loadSavedLayout` reconciles this. For new users, the mismatch is quickly overridden but may cause a flash of incorrect window title.

**Files:** `src/renderer/src/stores/panelLayout.ts` lines 354, 386

### 4.8 Cost badge in header shows "$0.00" for new users with no context

The `NeonBadge` in `UnifiedHeader.tsx` (line 64) shows `$0.00` for users with no cost data. Without a label or tooltip, it's unclear what this number represents -- is it account balance, session cost, daily cost?

**Files:** `src/renderer/src/components/layout/UnifiedHeader.tsx` line 64

---

## 5. First-Run Experience Walkthrough

1. **App launches -> Onboarding screen.** The user sees a "Setup Check" card centered on screen with 4 required checks (CLI installed, login completed, token not expired, Git available) and 2 optional checks (repos configured, Supabase connected). This is clean and well-structured. If all required checks pass, it auto-advances. If not, clear instructions are shown with a "Check Again" button and a "Continue Anyway" escape hatch. The Supabase check is misleading for new users (see issue 3.7).

2. **Onboarding passes -> App shell renders.** The user sees: a narrow icon sidebar on the left (8 pinned views by default), a header bar with a "B" logo, a single tab ("Dashboard"), a cost badge ("$0.00"), a notification bell, and a theme toggle. No welcome message, no tutorial, no "what to do first" guidance.

3. **Dashboard loads as default view.** The user sees the "BDE Command Center" status bar, then a 3-column grid: left column has 5 stat counters all showing 0, center column has an empty pipeline flow, empty completions chart, "No terminal tasks" success ring, empty cost chart, and right column has an empty activity feed, "No completions yet", and "$0.00" cost. This is a wall of empty widgets with no explanation of what they measure or how to populate them. There is no "Create your first task" or "Spawn an agent" call-to-action.

4. **User explores the sidebar.** Icons have tooltips (via `NeonTooltip`) that show the view name and keyboard shortcut on hover. This is good discoverability. The icons themselves are standard (Terminal for Agents, Workflow for Pipeline, GitPullRequest for PR Station) and reasonably guessable.

5. **User tries Command Palette (Cmd+P).** The palette opens with 4 grouped sections: Navigate (8 items), Agent Actions (Spawn Agent, Kill All), Panels (Split Right, Split Below, Close Panel, Reset Layout), and Recent Agents. For a new user, "Spawn Agent" is the first actionable command they might try. The palette has fuzzy search, keyboard navigation, and hint badges showing shortcuts. This is the most discoverable power-user feature.

6. **User opens Settings (Cmd+7).** Lands on "Connections" tab showing credential/API configuration fields. For a first-time user, this is reasonable if they need to configure repos. The tab organization (Connections, Repositories, Templates, Agent, Agent Manager, Cost, Memory, Appearance, About) is logical but dense -- 9 tabs is a lot. There is no search within settings.

7. **User tries to split panels.** Unless they right-click a sidebar item or use Cmd+P -> "Split Right", there is no affordance for this. If they accidentally drag a sidebar icon onto the main content area, the drop overlay appears with zone highlighting -- but there's no indication that sidebar icons are draggable. The `draggable` attribute is set on `SidebarItem` buttons (line 52-56) but there's no drag handle icon or visual cue.

**Overall first-run verdict:** The onboarding gate is solid, but once past it, the app drops the user into an empty dashboard with zero guidance. The gap between "environment is configured" and "I know how to use this tool" is not bridged. The most powerful features (panel splitting, command palette, drag-and-drop docking) are hidden behind keyboard shortcuts and right-click menus that are never introduced.
