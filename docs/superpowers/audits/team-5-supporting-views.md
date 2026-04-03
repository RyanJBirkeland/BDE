# Team 5 — Supporting Views Audit

## Executive Summary

The supporting views (Dashboard, Cost, Memory, Settings, Notifications) are functionally solid but visually stuck in a utilitarian "VS Code" era. The **Dashboard** -- the first thing users see -- is a flat 2x2 grid of data lists with zero visual flair: no gradients, no ambient glows, no animation, no hero moment. It feels like a debug panel, not a premium landing page. Cost View has the strongest glass treatment of the group but lacks data visualization (no charts, no sparklines). Memory View works well as a two-pane editor but has no visual personality. Settings has **missing CSS definitions** for several component classes, causing unstyled elements. The Notification Bell is well-structured but the dropdown lacks entrance animation and the `viewLink` navigation is a TODO stub.

Key systemic issues:

1. **Dashboard uses 100% inline styles via `tokens`** -- no CSS file, no CSS classes, zero feast-site treatment. It needs a complete visual overhaul as the app's hero view.
2. **Design tokens are outdated** -- `tokens.ts` still defines `#0A0A0A` bg, `#141414` surface, `4px/6px/8px` radii. The Team 0 target tokens (`#050507`, `#111118`, `20px/16px` radii) are not reflected anywhere.
3. **Missing CSS classes** -- At least 6 class names used in Settings components (`settings-connection`, `settings-connection__label`, `settings-repo-form`, `settings-repo-form__row`, `settings-template-row`, `settings-field__hint`, `settings-repo__dot`, `settings-repo__github`, `settings-repos__add-btn`) have **no CSS definitions** in any stylesheet.
4. **No data visualization anywhere** -- Cost View has numbers in tables but zero charts/sparklines. Dashboard cost card is a static 3-column stat grid.

---

## UX Designer Findings

### Dashboard

**Current state:** A plain `display: grid; grid-template-columns: repeat(2, 1fr)` of four cards with `tokens.space[4]` (16px) gap. Cards use `tokens.color.surface` (#141414) with `tokens.color.border` (#333) border and `tokens.radius.lg` (8px) radius. No glassmorphism, no ambient glow, no entrance animation, no gradient headers.

**Problems:**

- **No hero moment.** This is the landing view (Cmd+1) and it feels like a secondary panel. There is no visual hierarchy -- all four cards are identical weight.
- **Card headers are text-only.** `DashboardCard` renders title in `fontSize: tokens.size.sm` (12px), uppercase, muted color. No gradient, no icon accent color, no hover treatment on the card itself.
- **Border radius too small.** At 8px (`tokens.radius.lg`), cards feel sharp and utilitarian. Target: 20px (`--bde-radius-xl`).
- **No hover/interaction on cards.** Cards are static rectangles. No `card-hover-lift`, no border brighten, no `active:scale(0.97)`.
- **Empty states are plain text.** "No active tasks" is a muted `<p>` tag. No illustration, no call-to-action, no friendly empty state.
- **Cost summary card is the closest to premium** with its 3-column stat grid and monospace numbers, but still lacks a gradient accent or sparkline trend indicator.
- **No ambient background glow.** The entire Dashboard view has no `radial-gradient` ambient treatment. It should feel like the command center of the app.

**Recommendations:**

1. Add a `dashboard.css` file with glass-surface treatment on the grid container and ambient glow behind the top-left card.
2. Upgrade `DashboardCard` to use gradient header bars (per card theme color), `border-radius: 20px`, layered shadows, and `card-hover-lift` on hover.
3. Make the ActiveTasksCard span full width at the top (hero card) when tasks are present. Use a larger font size for the task count as a "big number."
4. Add a subtle stagger animation on card entrance (`stagger-child` with 50ms delay per card).
5. Add sparkline trend to CostSummaryCard showing 7-day cost trajectory.
6. Upgrade empty states with the shared `EmptyState` component (which the other views already use) plus a CTA to navigate to Sprint view.

### Cost View

**Current state:** The strongest glass treatment of any supporting view. Has `cost-view--glass`, gradient title, `::after` header gradient line, proper skeleton loading states, and the color-tiered table rows (green/yellow/red cost borders). Uses `framer-motion` fade-in.

**Problems:**

- **No charts or sparklines.** All data is in a table. The "Tasks completed: X today / Y week / Z all" line is a text dump. A small bar chart or area chart for daily cost over the last 7/30 days would add significant value.
- **Two-panel layout is half-empty.** `grid-template-columns: 1fr 1fr` but only `ClaudeCodePanel` renders (the OpenClaw API panel was likely removed). The grid shows one panel taking up half the width with empty space beside it.
- **Table is horizontally crowded.** Eight columns (Task, Cost, Duration, Turns, Cache Hit %, Repo, PR, Date) is too many for comfortable scanning. Consider collapsing Turns and Cache Hit into a tooltip or secondary row.
- **Cost tier colors use `td:first-child` left border.** This is subtle and easy to miss. Consider a background tint on the entire row or a colored dot.

**Recommendations:**

1. Fix the grid layout -- either use `1fr` for a single panel or add a second panel (e.g., "This Week" summary chart).
2. Add a small area/bar chart above the table showing daily cost for the trailing 14 days.
3. Reduce table columns to 5-6, move less critical data (Turns, Cache %) to a row expansion or tooltip.
4. Add `backdrop-filter: blur(20px)` to the panel card and ambient glow to the header stat values.

### Memory View

**Current state:** Two-pane layout (sidebar + editor) with glass treatment in `memory.css`. Sidebar has file grouping (pinned/daily logs/projects/other), search with clear button, keyboard navigation. Editor is a plain `<textarea>` with save/discard toolbar.

**Problems:**

- **Editor textarea is visually raw.** It is a monospaced textarea with no line numbers, no syntax highlighting for Markdown, no visual differentiation from a settings input. This is the primary editing surface and deserves more treatment.
- **Pin emoji is a Unicode character** (`\uD83D\uDCCC` = pushpin). In the feast-site aesthetic, this should be a styled icon (e.g., lucide `Pin`) with an accent color tint, not an emoji.
- **Sidebar file items lack visual weight.** The `.memory-file` class has minimal styling -- the active state is a left border accent, but there is no file type icon, no hover animation, and the metadata (time + size) is the same muted color with no hierarchy.
- **Search results show raw line numbers.** The `memory-search-result__line` is a monospace number with no visual treatment. Consider highlighting the matched text within snippets.
- **No breadcrumb or path indicator** in the editor toolbar beyond the file path. No way to tell which group the file belongs to at a glance.

**Recommendations:**

1. Add `FileText` icon to each file row with accent color for `.md` files.
2. Upgrade the textarea to have a dark inset background with `border-radius: 12px`, subtle inner shadow, and mono font with adjusted line-height for readability.
3. Highlight search matches in the snippet text with `--bde-accent` background tint.
4. Replace the pushpin emoji with a styled `Pin` lucide icon.
5. Add `backdrop-filter: blur(20px)` to the sidebar background.

### Settings View

**Current state:** Tab bar at top with 7 tabs (Connections, Repositories, Templates, Agent, Agent Manager, Appearance, About). Each tab renders a section component inside a scrollable panel. Glass treatment on header and tab bar from `settings.css`.

**Problems:**

- **Missing CSS definitions.** The following classes used in components have NO CSS rules anywhere:
  - `settings-connection` (used in ConnectionsSection, CredentialForm)
  - `settings-connection__label` (used for subsection titles)
  - `settings-repo-form` (used for new repo add form)
  - `settings-repo-form__row` (layout for form inputs)
  - `settings-repo-form__path-row` (path input + browse button)
  - `settings-repo-form__actions` (cancel/save buttons)
  - `settings-template-row` (template list items)
  - `settings-template-row__header` (template header)
  - `settings-template-row__prefix` (template textarea)
  - `settings-field__hint` (restart notice in AgentManagerSection)
  - `settings-repo__dot` (color dot for repos)
  - `settings-repo__github` (github owner/repo display)
  - `settings-repos__add-btn` (add button)
    These elements render with browser defaults, causing inconsistent spacing, missing layouts, and unstyled text.
- **Duplicate settings between tabs.** Both "Connections" and "Agent Manager" tabs contain `maxConcurrent`, `worktreeBase`, and `maxRuntimeMinutes` fields. ConnectionsSection has an "Agent Manager" subsection that duplicates AgentManagerSection almost entirely.
- **Checkbox for auto-start is unstyled.** `AgentManagerSection` uses a native `<input type="checkbox">` with no custom styling. It looks out of place next to the styled inputs and buttons.
- **Tab bar has no active indicator animation.** The active tab gets a background color change but no sliding underline or animated border.
- **`max-width: 640px` on scroll area** is fine for form fields but could use a responsive approach -- on wider panels, the empty space to the right looks wasted.
- **Color picker circles** at 28px are quite small and have only a `scale(1.15)` hover. They need more visual pop.

**Recommendations:**

1. **Priority 1:** Add all missing CSS class definitions to `settings.css`. This is a real bug, not a cosmetic issue.
2. Remove the duplicate Agent Manager settings from ConnectionsSection (keep only the dedicated AgentManagerSection tab).
3. Style the checkbox as a toggle switch (consistent with the feast-site aesthetic).
4. Add a subtle animated underline on the active tab.
5. Increase color picker circle size to 32px and add a ring shadow on active.
6. Add `settings-connection` styles with left border accent, padding, and subtle background.

### Notification Bell & Dropdown

**Current state:** Bell icon with absolute-positioned red badge showing unread count. Dropdown is a 360px-wide glass panel with notification items showing type-specific icons, title/message/timestamp, and an unread dot.

**Problems:**

- **No entrance/exit animation.** The dropdown appears/disappears instantly (`{isOpen && <div ...>}`). This is jarring for a premium feel. It should fade+slide in.
- **`viewLink` navigation is a TODO stub** (line 56-58). Clicking a notification only marks it as read but does not navigate.
- **No dismiss/delete individual notifications.** Users can only "Mark all as read" -- no swipe-to-dismiss or X button per notification.
- **Notifications are not persisted.** The store uses in-memory state only (`let nextId = 0`). Refreshing the app loses all notifications. There is no localStorage persistence.
- **Badge does not animate.** When a new notification arrives, the badge count changes but there is no pulse/bounce animation to draw attention.
- **Dropdown positioning is `right: 0` absolute.** If the bell is near the right edge of the window (likely in the title bar), the dropdown may clip off-screen on narrow windows.
- **The `getUnreadCount` function is called directly in render** (`const unreadCount = getUnreadCount()`). This calls `get().notifications.filter(...)` on every render, creating a new array each time. This is the Zustand selector anti-pattern mentioned in CLAUDE.md -- it should be derived via `useMemo` from `notifications` state.

**Recommendations:**

1. Add `framer-motion` `AnimatePresence` + `motion.div` for the dropdown with `opacity` and `translateY` animation.
2. Implement `viewLink` navigation using the `bde:navigate` custom event pattern (already used in CostView).
3. Add a per-notification dismiss button (small X icon, right-aligned).
4. Persist notifications to `localStorage` with a hydration step on mount.
5. Add a CSS `@keyframes` pulse animation on the badge when count changes.
6. Fix the Zustand anti-pattern: replace `getUnreadCount()` with `useMemo(() => notifications.filter(n => !n.read).length, [notifications])`.
7. Consider using `Popover` or computing position relative to viewport to prevent clip.

---

## Product Manager Findings

### Dashboard as Landing Page

**Does it orient the user?** Barely. It shows four equal-weight cards with task lists and cost numbers, but there is no narrative: "Here is what is happening right now." There is no sense of urgency for active tasks, no celebration for completions, no trend indicators.

**What is the first impression?** A static data dump. The user sees four rectangles with small text. Nothing moves, nothing glows, nothing says "premium developer tool."

**What is missing?**

- **A "system health" indicator** -- are agents running? Is the agent manager connected? Is Supabase reachable?
- **A task throughput metric** -- tasks completed today/this week, trend arrow.
- **Quick action buttons** -- "Queue a task", "Open Sprint", "View Agents" as prominent CTAs.
- **A recent activity feed** -- combining task completions, PR merges, agent events in a unified timeline.
- **Greeting/time-of-day context** -- "Good morning, Ryan. 3 tasks completed overnight."

**Recommendation:** Redesign as a 3-section layout: (1) Hero banner with system status + greeting + quick actions, (2) Two-column cards for active work + completions, (3) Full-width cost/PR summary bar. Make it the "mission control" that orients the user in under 2 seconds.

### Settings Organization

**Are categories logical?** Mostly, but there are issues:

- **Connections tab is overloaded.** It contains Claude CLI auth status, Agent Manager config (maxConcurrent, worktreeBase, maxRuntime), AND GitHub token management. These are three distinct concerns.
- **Duplicate Agent Manager settings.** The "Connections" tab has Agent Manager fields that overlap with the dedicated "Agent Manager" tab. Users will be confused about which one to use, and saving in one does not update the other (they read from different settings keys -- `agentManager.maxConcurrent` as string vs JSON).
- **"Agent" vs "Agent Manager" tabs** -- the distinction between "Agent Runtime" (binary path, permission mode) and "Agent Manager" (concurrency, model, worktree) is unclear to users. Consider merging into a single "Agents" tab with subsections.
- **Appearance tab is under-featured.** Only theme toggle and accent color. Could include: font size preference, sidebar width, animation toggle (reduced motion), compact mode.

**Is anything hard to find?** The Supabase connection settings are conspicuously absent from the Settings UI -- they can only be configured via direct SQLite writes. This is a gap for onboarding.

### Cost Visibility

**Is cost info actionable?** Partially. Users can see total cost, per-run cost, and cache efficiency, which helps identify expensive tasks. But there are no:

- **Budgets or alerts** -- "You have spent $X this week, which is Y% higher than last week."
- **Cost optimization suggestions** -- "Task X had 0% cache hit rate, consider batching with similar tasks."
- **Time-range filters** -- The view shows all runs sorted by date, but no way to filter to "this week" or "last 30 days."
- **Export is clipboard-only** -- No file download option.

**Too granular?** The 8-column table is information-dense. For most users, Task + Cost + Date is sufficient; the rest is noise unless they are debugging token efficiency.

### Memory UX

**Is the file-based approach intuitive?** For technical users, yes. The sidebar grouping (pinned, daily logs, projects, other) makes sense. But:

- **No explanation of what memory files are for.** A first-time user seeing this view has no context. A brief subtitle ("Agent memory files at `~/.bde/memory/`") would help.
- **Editor is a raw textarea.** For Markdown files (which all memory files are), even basic bold/italic toolbar buttons or a preview toggle would improve the experience.
- **No delete file action.** Users can create files but not delete them from the UI.
- **Search is instant (on type) which is good**, but the search endpoint calls grep on the filesystem -- for large memory directories, this could be slow. No debounce is applied on the search input.

---

## Sr. Frontend Dev Findings

### Component-Level Changes

| Component                 | Issue                                                                                    | Fix                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `DashboardView.tsx`       | 100% inline styles, no CSS file, no motion                                               | Create `dashboard.css`, convert to className-based, add `framer-motion` stagger |
| `DashboardCard.tsx`       | Inline styles only, no hover/active states                                               | Add CSS class `.dashboard-card` with hover-lift, glass background, 20px radius  |
| `ActiveTasksCard.tsx`     | `StatusBadge` uses inline color math (`${color}22`)                                      | Move to CSS variables or a utility class per status                             |
| `OpenPRsCard.tsx`         | Direct `window.api.getPrList()` in component, no store                                   | Consider moving to a shared PR store or at minimum caching the result           |
| `CostSummaryCard.tsx`     | Inline grid with `gap: '1px'; background: tokens.color.border` hack for dividers         | Use proper border or CSS gap with border-image                                  |
| `NotificationBell.tsx`    | `getUnreadCount()` called in render body (Zustand anti-pattern)                          | Replace with `useMemo` derived from `notifications`                             |
| `NotificationBell.tsx`    | Instant show/hide with no animation                                                      | Wrap in `AnimatePresence` + `motion.div`                                        |
| `notifications.ts`        | `let nextId = 0` module-level mutable                                                    | Use `crypto.randomUUID()` or `Date.now()` alone                                 |
| `notifications.ts`        | No persistence -- state lost on refresh                                                  | Add `persist` middleware from `zustand/middleware` with localStorage            |
| `AgentManagerSection.tsx` | Duplicate of fields in `ConnectionsSection.tsx`                                          | Remove Agent Manager fields from ConnectionsSection                             |
| `ConnectionsSection.tsx`  | Saves `agentManager.maxConcurrent` as string, `AgentManagerSection` saves as JSON number | Data type conflict -- one will override the other incorrectly                   |
| `MemoryView.tsx`          | Search input has no debounce                                                             | Add 200ms debounce to `handleSearch`                                            |
| `tokens.ts`               | Radii are 4/6/8/12px, target design calls for 8/12/16/20/24/32px                         | Update token values to match Team 0 spec                                        |

### CSS Changes

| File                              | Issue                                                           | Fix                                                                                                                                                                |
| --------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `settings.css`                    | Missing 13+ class definitions used in components                | Add all `settings-connection`, `settings-repo-form`, `settings-template-row`, `settings-field__hint`, `settings-repo__dot/github`, `settings-repos__add-btn` rules |
| `main.css` (line 839)             | Settings scroll area styles are one-liners jammed together      | Expand for readability, add responsive max-width                                                                                                                   |
| `memory.css`                      | Uses `--text-primary`, `--text-secondary`, `--text-tertiary`    | These are legacy variable names; should be `--bde-text`, `--bde-text-muted`, `--bde-text-dim`                                                                      |
| `memory.css`                      | Uses `--font-mono`                                              | Should be `--bde-font-code`                                                                                                                                        |
| `cost.css`                        | `.cost-panel__placeholder` uses `--bde-text-dim, #555` fallback | Inconsistent with tokens; use `var(--bde-text-dim)` after ensuring variable is defined                                                                             |
| No file                           | Dashboard has zero CSS                                          | Create `src/renderer/src/assets/dashboard.css`                                                                                                                     |
| `main.css` (notification section) | Hardcoded `rgba()` values for icon backgrounds                  | Violates CSS theming rule; use `var(--bde-success-dim)` etc.                                                                                                       |

### Data Visualization Approach

**Current:** Zero charts. All data is presented as formatted text and HTML tables.

**Opportunities:**

1. **CostSummaryCard sparkline** -- A 7-day inline SVG sparkline (no dependency needed, just a `<polyline>` in an `<svg>`) showing daily cost trajectory. Data is already available from `cost.agentRuns` grouped by date.
2. **Cost View area chart** -- A 14-day area chart showing daily cost. Can be done with pure SVG (`<path>` with fill) or a lightweight lib like `recharts` (but dependency policy requires approval).
3. **Dashboard task throughput** -- A small "tasks completed per day" bar chart in the completions card. 7 bars, one per day, pure SVG.
4. **Cache efficiency histogram** -- In Cost View, a small horizontal bar showing cache hit % distribution across runs.

**Recommendation:** Start with zero-dependency SVG sparklines. A reusable `<Sparkline data={number[]} width={120} height={32} />` component using a `<polyline>` would cost ~30 lines of code and dramatically improve the data density of both Dashboard and Cost views.

---

## Priority Matrix

### P0 -- Bugs / Broken Functionality

| Item                                                            | View          | Impact                                                                                                |
| --------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| 13+ missing CSS class definitions in Settings                   | Settings      | Unstyled elements, broken layouts for repo forms, templates, connections subsections                  |
| Duplicate Agent Manager settings with data type conflict        | Settings      | `maxConcurrent` saved as string in one tab, JSON number in another -- last write wins with wrong type |
| Zustand anti-pattern in NotificationBell (`getUnreadCount()`)   | Notifications | Potential infinite re-render loop under certain conditions                                            |
| Legacy CSS variable names in memory.css (`--text-primary` etc.) | Memory        | Styles may break or fall back to wrong colors if legacy vars are removed                              |
| `viewLink` navigation is TODO stub                              | Notifications | Clicking notifications does nothing beyond marking as read                                            |

### P1 -- High-Impact Visual Upgrades

| Item                                                                            | View          | Impact                                                                |
| ------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------- |
| Dashboard complete visual overhaul (glass, gradients, ambient glow, animation)  | Dashboard     | First impression of the entire app; current state is a flat data dump |
| Update `tokens.ts` to Team 0 target values (radii, colors, surfaces)            | All           | Foundation for all feast-site visual upgrades                         |
| Create `dashboard.css` with glass-surface cards, stagger animation, hero layout | Dashboard     | Transforms landing page from debug panel to premium command center    |
| Add framer-motion entrance animation to notification dropdown                   | Notifications | Eliminates jarring instant appear/disappear                           |
| Add notification persistence (zustand persist middleware)                       | Notifications | Notifications currently lost on every refresh                         |

### P2 -- UX Improvements

| Item                                                          | View            | Impact                                                           |
| ------------------------------------------------------------- | --------------- | ---------------------------------------------------------------- |
| Add SVG sparkline component for cost trends                   | Dashboard, Cost | Adds data visualization without new dependencies                 |
| Fix Cost View grid layout (single panel taking half width)    | Cost            | Wasted space where second panel was removed                      |
| Add search input debounce in Memory View                      | Memory          | Prevents excessive IPC calls on fast typing                      |
| Merge "Agent" and "Agent Manager" settings tabs               | Settings        | Reduces confusion between similar tabs                           |
| Add system health indicator to Dashboard                      | Dashboard       | Users need to know at a glance if agents/connections are healthy |
| Style native checkbox as toggle switch in AgentManagerSection | Settings        | Visual consistency with premium aesthetic                        |
| Add per-notification dismiss button                           | Notifications   | Users cannot clear individual notifications                      |

### P3 -- Polish & Delight

| Item                                                            | View          | Impact                                      |
| --------------------------------------------------------------- | ------------- | ------------------------------------------- |
| Notification badge pulse animation on new notification          | Notifications | Draws attention to new events               |
| Dashboard greeting with time-of-day context                     | Dashboard     | Personal, premium feel                      |
| Memory editor upgrade (inset background, adjusted line-height)  | Memory        | Better editing experience for markdown      |
| Replace pushpin emoji with styled lucide Pin icon               | Memory        | Consistent icon treatment                   |
| Animated tab underline in Settings                              | Settings      | Smooth tab switching feedback               |
| Quick action buttons on Dashboard ("Queue Task", "Open Sprint") | Dashboard     | Reduces navigation steps for common actions |
| Cost table column reduction with expandable rows                | Cost          | Less visual noise, progressive disclosure   |
