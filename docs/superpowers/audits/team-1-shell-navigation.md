# Team 1 — Shell & Navigation Audit

## Executive Summary

The shell and navigation layer is functionally solid with good ARIA patterns and a working panel system, but visually it reads as a utilitarian VS Code clone rather than a premium IntelliJ-class IDE. The current token values (`--bde-radius-sm: 4px`, `--bde-surface: #141414`, flat borders) produce a boxy, low-contrast aesthetic that is far from the feast-site's glassmorphic, glow-infused feel. The largest gaps are: no Inter font in the `--bde-font-ui` stack, flat/small radii everywhere, zero ambient glow or gradient treatment on shell chrome, inline styles throughout panel components preventing CSS-driven theming, and several accessibility holes in keyboard navigation.

## UX Designer Findings

### TitleBar

**Current state:** 32px tall, `glass` class gives it `--glass-tint-dark` background with a 1px top-edge shimmer pseudo-element. Left side: "BDE" logotype with gradient text + blur glow. Right side: conflict badge, session badge, cost, notification bell, theme toggle. Clean but cramped and visually flat.

**Feast-site gaps:**

- Height too short at 32px for the premium feel -- should be 38-40px to give breathing room.
- `padding-left: 80px` for macOS traffic lights is correct, but `padding-right: 12px` is too tight. Should be 16px.
- The `titlebar__separator` uses a gradient on `--border-light` which is good, but its height (16px) and margin feel VS Code-ish. Should be 20px tall with a softer gradient.
- No ambient glow behind the logotype area. Feast-site would have a `radial-gradient(circle at 10% 50%, rgba(0,211,127,0.06) 0%, transparent 50%)` on the titlebar to create a "lit from within" feel near the logo.
- The `titlebar__cost` uses `--bde-font-code` in `--bde-size-xs` -- correct, but needs a subtle background pill treatment (`background: var(--bde-hover-strong); border-radius: var(--bde-radius-full); padding: 2px 8px`) to match the badge-heavy feast-site approach.
- Gap between right items is `10px` -- should be `8px` for tighter grouping with a visual separator before the theme toggle.

**Specific CSS changes:**

```css
.titlebar {
  height: 38px; /* was 32px */
  padding-right: 16px; /* was 12px */
  background: var(--glass-tint-dark);
  border-bottom: 1px solid var(--border);
}

/* Add ambient glow behind logo area */
.titlebar::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  width: 200px;
  height: 100%;
  background: radial-gradient(circle at 20% 50%, rgba(0, 211, 127, 0.06) 0%, transparent 70%);
  pointer-events: none;
}

.titlebar__right {
  gap: 8px; /* was 10px */
}

.titlebar__cost {
  background: var(--bde-hover-strong);
  padding: 2px 8px;
  border-radius: var(--bde-radius-full);
}

.titlebar__separator {
  height: 20px; /* was 16px */
}
```

### ActivityBar

**Current state:** 64px wide vertical nav with 9 items (icon + 10px label). Active item has a 3px left-edge accent bar via `::before`. Items are 56x52px with `--bde-radius-md` (6px) rounding. Open-view indicator is a 4px green dot absolutely positioned. Context menu uses inline styles with token values.

**Feast-site gaps:**

- Border radius on items should be `--bde-radius-lg` (8px) minimum, ideally 10px per Team 0 token `md=12px`.
- No hover glow effect. Feast-site items would get `box-shadow: 0 0 0 1px var(--border-light)` on hover, creating the "hover-border-brighten" pattern.
- Active indicator bar (`3px wide, left: -4px`) is too VS Code. Feast-site would use a bottom-aligned accent dot or a filled background tint: `background: var(--accent-subtle); border: 1px solid rgba(0,211,127,0.15)`.
- Item label at 10px is too small. Should be 10.5px or `var(--text-2xs)` (10px) with `--tracking-wide` (0.06em) for readability.
- The open-view indicator dot (4px) is too small and positioned awkwardly. Should be 5px with a subtle glow: `box-shadow: 0 0 4px rgba(0,211,127,0.4)`.
- Context menu is entirely inline-styled -- impossible to theme globally. Must be extracted to CSS classes.
- No transition on the active indicator bar appearance.
- Gap between items is only 2px -- too tight. Should be 4px.

**Specific CSS changes:**

```css
.activity-bar {
  width: 64px;
  background: var(--glass-tint-dark);
  border-right: 1px solid var(--border);
}

.activity-bar__nav {
  gap: 4px; /* was 2px */
  padding-top: 8px; /* was 6px */
}

.activity-bar__item {
  width: 52px; /* was 56px -- slightly narrower for more padding feel */
  height: 48px; /* was 52px */
  border-radius: 10px; /* was var(--bde-radius-md) = 6px */
  transition:
    color 0.15s,
    background 0.15s,
    box-shadow 0.15s;
}

.activity-bar__item:hover {
  color: var(--bde-text);
  background: var(--bde-hover-strong);
  box-shadow: 0 0 0 1px var(--border-light);
}

.activity-bar__item--active {
  color: var(--bde-text);
  background: var(--accent-subtle);
}

/* Replace left-bar indicator with bottom dot */
.activity-bar__item--active::before {
  content: '';
  position: absolute;
  bottom: 4px; /* was top: 6px */
  left: 50%;
  transform: translateX(-50%);
  width: 16px; /* was 3px */
  height: 3px; /* was auto (top:6px bottom:6px) */
  border-radius: var(--bde-radius-full);
  background: var(--bde-accent);
  box-shadow: 0 0 6px rgba(0, 211, 127, 0.3);
}

.activity-bar__item-label {
  font-size: 10px;
  letter-spacing: var(--tracking-wide); /* add tracking */
}
```

### StatusBar

**Current state:** 24px tall, extremely minimal -- just a "Local" muted badge on the left and model name on the right. Uses `--bde-surface` background with `--bde-border` top border.

**Feast-site gaps:**

- Height should be 26-28px. 24px is too cramped.
- Background should use the same `--glass-tint-dark` as the titlebar and activity bar for shell consistency.
- Missing information: no git branch indicator, no active agent count, no connection status. This is the primary "glanceable info" bar in IntelliJ and it's nearly empty.
- No accent glow or gradient. The statusbar should have a subtle `--gradient-horizon` overlay to tie it to the rest of the shell.
- The "Local" badge is using `variant="muted"` which renders as `--bde-surface-high` bg / `--bde-text-dim` color -- nearly invisible. Should be a subtle accent-tinted badge to indicate environment.

**Specific CSS changes:**

```css
.statusbar {
  height: 28px; /* was 24px */
  background: var(--glass-tint-dark);
  border-top: 1px solid var(--border);
}
```

### CommandPalette

**Current state:** Framer Motion animated, 560px wide modal with `glass-modal` class (backdrop-filter blur, border glow, layered shadow). Input with 15px font, grouped command list with fuzzy search, keyboard navigation. Well-implemented functionally.

**Feast-site gaps:**

- Width of 560px is good, but `border-radius: 10px` on `.command-palette` class is too small. Should be 16px per Team 0 `lg` token.
- Input padding `12px 16px` is fine but the input should have a search icon prefix (Search from lucide-react) for discoverability.
- Item border-radius at `var(--bde-radius-sm)` (4px) is too sharp. Should be 8px.
- Selected item background `var(--bde-hover-strong)` is too subtle. Should be `var(--accent-subtle)` with a left accent border: `border-left: 2px solid var(--bde-accent)`.
- Group headers use `var(--bde-size-xs)` uppercase -- correct for feast-site but missing the green color. Should be `color: var(--bde-accent); font-weight: 700`.
- No empty-state illustration or icon for "No matching commands."
- The `glass-modal` class already provides good glassmorphism -- this is one of the better-aligned components.

**Specific CSS changes:**

```css
.command-palette {
  border-radius: 16px; /* was 10px */
}

.command-palette__input {
  padding: 14px 16px; /* was 12px 16px */
  font-size: 15px; /* keep */
  border-bottom: 1px solid var(--border-light); /* was var(--bde-border) */
}

.command-palette__item {
  border-radius: 8px; /* was var(--bde-radius-sm) = 4px */
  padding: 10px 12px; /* was 8px 12px */
  transition:
    background 0.1s ease,
    border-color 0.1s ease;
}

.command-palette__item--selected {
  background: var(--accent-subtle);
  border-left: 2px solid var(--bde-accent);
  padding-left: 10px; /* compensate for border */
}

.command-palette__group-header {
  color: var(--bde-accent); /* was var(--bde-text-muted) */
  font-weight: 700; /* was inherited (not set) */
  font-size: var(--text-2xs); /* 10px, slightly smaller */
  letter-spacing: var(--tracking-widest); /* was 0.5px */
  padding: 8px 12px 4px; /* was 6px 12px 2px */
}

.command-palette__empty {
  padding: 32px 16px; /* was 16px */
}
```

### NotificationBell

**Current state:** 14px Bell icon in a `bde-btn--icon bde-btn--sm` (28x28). Unread badge is a red pill absolutely positioned. Dropdown uses `glass-modal elevation-3` classes -- good glassmorphism. Notification items have type-colored icon circles, title/message/time layout, and an unread dot.

**Feast-site gaps:**

- Badge radius is `8px` -- should be `var(--bde-radius-full)` (already close, 8px on a 14px element is pill-shaped).
- Dropdown width at 360px is fine. `border-radius: var(--bde-radius-lg)` (8px) should be 16px to match elevation-3.
- Notification item icon circles use hardcoded `rgba()` for backgrounds (`rgba(34, 197, 94, 0.1)`) which violates the CSS theming rule. Must use CSS variables or the semantic tokens.
- Missing: slide-in animation for the dropdown. Should use `@keyframes` or framer-motion for entrance.
- Missing: empty state icon should have a subtle glow pulse animation.
- The `notification-item:hover` background `var(--bde-hover)` is too subtle. Should be `var(--bde-hover-strong)` with a left accent border matching the notification type color.
- No `max-height` animation on dropdown open/close -- it just pops in.

**Specific CSS changes:**

```css
.notification-bell__dropdown {
  border-radius: 16px; /* was var(--bde-radius-lg) = 8px */
  animation: bde-scale-fade-in 150ms ease;
}

.notification-item--success .notification-item__icon {
  color: var(--bde-success);
  background: var(--bde-accent-dim); /* was rgba(34, 197, 94, 0.1) */
}

.notification-item--error .notification-item__icon {
  color: var(--bde-danger);
  background: var(--bde-danger-dim); /* was rgba(239, 68, 68, 0.1) */
}

.notification-item--warning .notification-item__icon {
  color: var(--bde-warning);
  background: var(--bde-warning-dim); /* was rgba(251, 191, 36, 0.1) */
}

.notification-item:hover {
  background: var(--bde-hover-strong); /* was var(--bde-hover) */
}

.notification-bell__empty svg {
  opacity: 0.3;
  animation: pulse-glow 2.5s ease-in-out infinite;
}
```

### Panel System (TabBar, Resize Handles, Drop Overlay)

**Current state:**

**PanelTabBar:** 28px tall, entirely inline-styled using `tokens.*` values. Tabs show label + close button (X, 11px). Active tab gets `surfaceHigh` background. Draggable for reordering. Good ARIA with `role="tablist"` and `role="tab"`.

**PanelResizeHandle:** Simple 4px transparent bar using react-resizable-panels `Separator`. No visual affordance on hover.

**PanelDropOverlay:** 5-zone drop system (top/bottom/left/right/center) with `var(--bde-info-dim)` highlight. Functional.

**PanelLeaf:** Wraps tab bar + view content. Focused panel gets `1px solid accent` outline. Entirely inline-styled.

**Feast-site gaps:**

- **TabBar:** All inline styles prevent CSS theming. 28px is too short -- should be 32px. No tab hover effect. Active tab indicator is just a background change -- should have a bottom accent border. Tab close button is invisible until hover (opacity: 0.6 always). Font size in `tokens.size.sm` (12px) is fine.
- **ResizeHandle:** No hover indicator at all -- transparent to transparent. Should show `var(--border-light)` on hover and `var(--bde-accent)` when actively dragging. Width of 4px is fine but should be 5-6px for easier grab target.
- **DropOverlay:** The highlight color `var(--bde-info-dim)` is blue-tinted -- should be accent-green: `var(--accent-subtle)` with a border. Center zone inset of 10% feels arbitrary.
- **PanelLeaf:** The focused outline `1px solid accent` is too sharp. Should use `box-shadow: 0 0 0 1px var(--bde-accent), 0 0 8px rgba(0,211,127,0.1)` for a softer glow.
- All panel components use `tokens.*` (the TS object) for inline styles instead of CSS variables. This means the light theme CSS variable overrides DON'T APPLY to panel styles. This is a critical bug for theming.

**Specific CSS changes (new classes to replace inline styles):**

```css
.panel-tab-bar {
  height: 32px; /* was 28px */
  background: var(--bde-surface);
  border-bottom: 1px solid var(--bde-border);
}

.panel-tab {
  font-size: var(--bde-size-sm);
  transition:
    color 0.1s ease,
    background 0.1s ease;
}

.panel-tab:hover {
  background: var(--bde-hover);
}

.panel-tab--active {
  background: var(--bde-surface-high);
  color: var(--bde-text);
  box-shadow: inset 0 -2px 0 var(--bde-accent); /* bottom accent line */
}

.panel-tab__close {
  opacity: 0;
  transition: opacity 0.1s ease;
}

.panel-tab:hover .panel-tab__close {
  opacity: 0.6;
}

.panel-tab__close:hover {
  opacity: 1;
  color: var(--bde-text);
}

/* Resize handle */
.panel-resize-handle {
  width: 5px; /* was 4px */
}

.panel-resize-handle:hover {
  background: var(--border-light);
}

.panel-resize-handle[data-resize-handle-active] {
  background: var(--bde-accent);
}

/* Drop overlay */
.panel-drop-zone {
  background: var(--accent-subtle);
  border: 1px dashed rgba(0, 211, 127, 0.3);
  border-radius: 8px;
}

/* Focused panel glow */
.panel-leaf--focused {
  box-shadow:
    0 0 0 1px var(--bde-accent),
    0 0 8px rgba(0, 211, 127, 0.08);
  border-radius: 0;
}
```

### Toast Notifications

**Current state:** Fixed bottom-right positioning with Framer Motion `slideUp` animation. Pill-shaped (`border-radius: 20px`) with solid color backgrounds. Success = accent green, Error = `--color-error`, Info = `--bg-card` with border. Action buttons use `--bde-hover-strong` border. Click-to-dismiss.

**Feast-site gaps:**

- The toast pill shape (20px radius) actually matches feast-site well -- one of the better-aligned components.
- Missing glassmorphism on info toasts. Info toast should use `backdrop-filter: blur(16px)` with glass-tint background instead of solid `--bg-card`.
- Success toast uses flat `var(--bde-accent)` -- should use `linear-gradient(135deg, #00D37F, #00A863)` for the feast-site CTA gradient.
- Missing glow shadow on success toast: `box-shadow: 0 4px 16px rgba(0,211,127,0.3)`.
- `bottom: 40px` positioning may overlap with the new 28px status bar. Should be `bottom: 44px` to account for statusbar + gap.
- Error toast uses `--color-error` which maps to `#FF453A` in v2 tokens -- correct.
- The `--bg-void` color reference in `.toast--success` (`color: var(--bg-void)`) is correct for dark text on green.
- Missing: a close X button. Only click-to-dismiss is not discoverable.

**Specific CSS changes:**

```css
.toast-container {
  bottom: 44px; /* was 40px, account for taller statusbar */
}

.toast--success {
  background: linear-gradient(135deg, #00d37f, #00a863);
  box-shadow:
    0 4px 16px rgba(0, 211, 127, 0.3),
    var(--bde-shadow-md);
}

.toast--info {
  background: var(--glass-tint-mid);
  backdrop-filter: var(--glass-blur-md) var(--glass-saturate);
  -webkit-backdrop-filter: var(--glass-blur-md) var(--glass-saturate);
  border: 1px solid var(--border-light);
}

.toast--error {
  box-shadow:
    0 4px 16px rgba(255, 69, 58, 0.2),
    var(--bde-shadow-md);
}
```

## Product Manager Findings

### Navigation Flow Issues

1. **No breadcrumb or path indicator.** When a user has multiple panels open with several tabs each, there is no way to see "where you are" at a glance. IntelliJ shows the current file path in the title bar. BDE should show the active view label (e.g., "Sprint > Task Workbench") in the titlebar center.

2. **Command palette navigation shortcuts are stale.** The command palette maps `Go to Agents` to `Cmd+1` but the ActivityBar maps `Cmd+1` to Dashboard and `Cmd+2` to Agents. These are out of sync. The palette hints show unicode chars like `\u23181` which render as obscure symbols.

3. **ActivityBar has no visual grouping.** All 9 items are in a flat list. IntelliJ groups: primary views (Dashboard/Agents/Terminal/Sprint), secondary views (PR/Git/Memory/Cost), and system (Settings). A subtle divider between groups (after Sprint and after Cost) would reduce cognitive load.

4. **Panel focus is invisible to casual users.** The only indicator that a panel is focused is a 1px accent outline. In a multi-panel layout, users cannot tell which panel will receive keyboard commands. IntelliJ uses a brighter tab bar and a colored title strip.

5. **No "Go to last panel" shortcut.** Users split panels but have no quick way to toggle focus between the two most recent panels (IntelliJ: `Ctrl+Tab`).

### Information Hierarchy

1. **StatusBar is wasted space.** Only shows "Local" badge and model name. Should include: active agent count (with green dot), current git branch (with repo name), queue depth, and last sync time. This is the most persistent, always-visible UI surface.

2. **TitleBar right section bunches everything together.** Conflict badge, session count, cost, notifications, and theme toggle are all at the same visual weight. The conflict badge and session count are the most actionable -- they should be visually separated from informational items (cost) and controls (bell, theme).

3. **Notification dropdown has no filtering or grouping.** All notification types are in a flat chronological list. At scale (20+ notifications), users need tabs or type-based filtering (Agent / PR / System).

### Missing UX Patterns

1. **No recently-opened quick switcher.** IntelliJ's `Cmd+E` shows recent files/tabs. BDE's command palette has "Recent Agents" but no "Recent Tabs" or "Recent Views" -- the most common navigation pattern in multi-panel IDEs.

2. **No mini-map or panel overview.** When the panel layout gets complex (3+ splits), there is no way to see the overall layout. IntelliJ shows a layout diagram in the Window menu.

3. **No drag handle on PanelTabBar for reordering tabs within the same panel.** Tabs can be dragged to other panels but reorder within a panel requires close + reopen.

4. **No tab overflow handling.** `PanelTabBar` sets `overflow: hidden` which simply clips tabs. IntelliJ shows a chevron dropdown for overflowed tabs. At 3-4 tabs per panel, this becomes an issue.

5. **No "Pin tab" feature.** In IntelliJ, pinned tabs stay at the left of the tab bar and cannot be accidentally closed. BDE's task-workbench and other "always open" views would benefit from this.

6. **NotificationBell dropdown is not keyboard accessible.** Opening with click, no Escape to close handler, no arrow key navigation between items.

## Sr. Frontend Dev Findings

### Component-Level Changes

**PanelTabBar.tsx — Critical: inline styles must move to CSS classes**

The entire component uses `style={{...}}` with `tokens.*` references. This means:

- Light theme CSS variable overrides do not apply (the TS `tokens` object is static).
- Cannot be targeted by global CSS changes.
- Performance: creates new style objects every render.

Specific change: Replace all `style={{...}}` with `className` references. The CSS classes already exist in `main.css` (`.panel-tab-bar`, `.panel-tab`, `.panel-tab--active`, `.panel-tab__close`) but are unused.

**PanelLeaf.tsx — Same inline style problem**

The container div, tab panels, and skeleton all use inline styles. The `outline: isFocused ? '1px solid accent' : '1px solid transparent'` pattern should be `className={isFocused ? 'panel-leaf--focused' : 'panel-leaf'}`.

**PanelResizeHandle.tsx — Add hover/active visual states**

The `Separator` component from react-resizable-panels supports `className`. Add `className="panel-resize-handle"` and use the CSS class for hover states. The `data-resize-handle-active` attribute is automatically set by the library and can be targeted in CSS.

**PanelDropOverlay.tsx — Extract zone styles to CSS**

The `zoneStyle()` function returns inline styles. These should be CSS classes: `.panel-drop-zone--top`, `.panel-drop-zone--bottom`, etc. The `HIGHLIGHT_COLOR` constant should reference the CSS variable directly.

**ActivityBar.tsx — Context menu inline styles**

Lines 148-238: The entire context menu (overlay, container, menu items) uses inline `style={{...}}` with `tokens.*`. This should be extracted to CSS classes like `.activity-bar__context-menu`, `.activity-bar__context-item`. The `onMouseEnter`/`onMouseLeave` handlers that mutate `style.backgroundColor` are an anti-pattern -- use CSS `:hover`.

**ActivityBar.tsx — Open-view indicator inline styles**

Lines 128-139: The green dot indicator is inline-styled. Should be a CSS class `.activity-bar__open-dot`.

**NotificationBell.tsx — Add keyboard handling**

- Add `onKeyDown` handler to toggle button for Enter/Space.
- Add `role="menu"` to dropdown, `role="menuitem"` to items.
- Add `onKeyDown` to dropdown for Escape (close) and Arrow keys (navigate items).
- Add `aria-expanded` to the bell button.
- Add `aria-haspopup="true"` to the bell button.

**StatusBar.tsx — Expand component interface**

The current `StatusBarProps` only accepts `model: string`. Should be expanded:

```ts
interface StatusBarProps {
  model: string
  gitBranch?: string
  repoName?: string
  activeAgentCount?: number
  queueDepth?: number
}
```

**ToastContainer.tsx — Add close button**

Each `ToastItem` should render a small X button (visible on hover) in addition to click-to-dismiss, for accessibility and discoverability.

### CSS Changes

**`base.css` — Update token values to Team 0 targets**

```css
/* Team 0 token updates */
--bde-bg: #050507; /* was #0A0A0A */
--bde-surface: #111118; /* was #141414 */
--bde-surface-high: #16161f; /* was #1E1E1E */
--bde-border: #1e1e2a; /* was #333333 */
--bde-text: #f5f5f7; /* was #E8E8E8 */

--bde-radius-sm: 8px; /* was 4px */
--bde-radius-md: 12px; /* was 6px */
--bde-radius-lg: 16px; /* was 8px */
--bde-radius-xl: 20px; /* was 12px */

/* New tokens */
--bde-radius-2xl: 24px;
--bde-radius-3xl: 32px;
--bde-shadow-glow: 0 4px 16px rgba(0, 211, 127, 0.3);
--bde-shadow-elevation: 0 24px 80px rgba(0, 0, 0, 0.6);

--bde-font-ui: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

**`tokens.ts` — Sync TS tokens with CSS**

Update all values to match the new CSS variables. This is critical because PanelTabBar, PanelLeaf, and ActivityBar context menu read from this object directly. Until those components are refactored to use CSS classes, the TS tokens must match.

```ts
color: {
  bg: '#050507',
  surface: '#111118',
  surfaceHigh: '#16161F',
  border: '#1E1E2A',
  text: '#F5F5F7',
  // ...rest unchanged
},
radius: {
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',
  full: '9999px',
},
font: {
  ui: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  code: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
},
```

**`command-palette.css` — radius + selected state upgrade**

Already detailed in UX Designer section above.

**`toasts.css` — glassmorphism + glow**

Already detailed in UX Designer section above.

**`main.css` — Shell chrome consistency**

- `.titlebar`, `.activity-bar`, `.statusbar` should all use `--glass-tint-dark` background and `--border` (v2 token) for borders, creating a unified glass shell.
- Panel CSS classes (`.panel-tab-bar`, `.panel-tab`, etc.) exist but are unused. They must be connected to the components and then updated with the new token values.

### Accessibility Gaps

1. **PanelTabBar: no keyboard navigation between tabs.** The tab elements have `role="tab"` but no `tabIndex` management and no `onKeyDown` for ArrowLeft/ArrowRight navigation per WAI-ARIA tab pattern. The active tab should have `tabIndex={0}`, inactive tabs `tabIndex={-1}`, and arrow keys should cycle through.

2. **PanelTabBar: close button has no `aria-label`.** The `<button>` wrapping `<X size={11} />` has `aria-label={`Close ${tab.label}`}` -- this IS implemented, so this is fine. However, the tab `<div>` with `role="tab"` has no `tabIndex` attribute, which means it is not keyboard-focusable.

3. **ActivityBar context menu: no keyboard support.** The `role="menu"` items have `role="menuitem"` but there is no `onKeyDown` handler for ArrowUp/ArrowDown navigation, no `tabIndex` management, and no auto-focus on first item when menu opens.

4. **NotificationBell: dropdown not keyboard accessible.** No `role` on dropdown, no `aria-expanded` on button, no Escape handler, no arrow key navigation. Should follow WAI-ARIA menu button pattern.

5. **PanelLeaf: focus management on tab close.** When the active tab is closed, focus does not move to the new active tab. It should be programmatically moved with `ref.focus()`.

6. **ToastContainer: no dismiss keyboard shortcut.** Toasts can only be dismissed by click. There should be a global Escape handler to dismiss the most recent toast, or each toast should be focusable with an explicit close button.

7. **StatusBar: "Local" badge has no explanation.** The badge text "Local" has no `title` or `aria-label` explaining what it means (local vs. remote agent mode).

8. **CommandPalette: `listbox` role without `aria-activedescendant`.** The list uses `role="listbox"` and items use `role="option"` with `aria-selected`, but the input does not have `aria-activedescendant` pointing to the selected option's ID. This means screen readers won't announce the selected item as the user arrows through.

## Priority Matrix

| Change                                                                 | Impact | Effort | Priority |
| ---------------------------------------------------------------------- | ------ | ------ | -------- |
| Update `base.css` token values to Team 0 targets (colors, radii, font) | High   | Low    | P0       |
| Sync `tokens.ts` with new CSS variable values                          | High   | Low    | P0       |
| Refactor PanelTabBar from inline styles to CSS classes                 | High   | Medium | P0       |
| Refactor PanelLeaf from inline styles to CSS classes                   | High   | Medium | P0       |
| Fix notification icon backgrounds from hardcoded rgba to CSS vars      | Medium | Low    | P0       |
| Add `aria-activedescendant` to CommandPalette input                    | Medium | Low    | P0       |
| Add keyboard navigation to PanelTabBar (Arrow keys)                    | Medium | Medium | P1       |
| Add keyboard accessibility to NotificationBell dropdown                | Medium | Medium | P1       |
| Extract ActivityBar context menu to CSS classes                        | Medium | Medium | P1       |
| Increase titlebar height to 38px, add ambient logo glow                | Medium | Low    | P1       |
| Update command-palette radii + selected state styling                  | Medium | Low    | P1       |
| Add glassmorphism + gradient to toasts                                 | Low    | Low    | P1       |
| Expand StatusBar with git branch, agent count, queue depth             | High   | Medium | P1       |
| Add tab overflow dropdown to PanelTabBar                               | Medium | High   | P2       |
| ActivityBar visual grouping with dividers                              | Low    | Low    | P2       |
| Add keyboard support to ActivityBar context menu                       | Low    | Medium | P2       |
| Add slide-in animation to NotificationBell dropdown                    | Low    | Low    | P2       |
| Add close button to toast items                                        | Low    | Low    | P2       |
| PanelResizeHandle hover/active visual states                           | Low    | Low    | P2       |
| PanelDropOverlay zone styles to CSS + accent color                     | Low    | Low    | P2       |
| Add "Recent Tabs" to command palette                                   | Medium | Medium | P2       |
| Panel focus glow instead of hard outline                               | Low    | Low    | P3       |
| StatusBar gradient-horizon overlay                                     | Low    | Low    | P3       |
| Tab reorder within same panel                                          | Low    | High   | P3       |
| Pin tab feature                                                        | Low    | High   | P3       |
| Panel layout mini-map overview                                         | Low    | High   | P3       |
