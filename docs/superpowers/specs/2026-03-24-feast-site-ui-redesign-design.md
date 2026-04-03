# BDE UI/UX Redesign — Feast-Site Inspired

**Date:** 2026-03-24
**Direction:** Premium consumer dark mode. More IntelliJ IDEA, less VS Code. Fun and playful. Gradients, glassmorphism, soft corners, ambient glows.
**Inspiration:** feast-site repo (RyanJBirkeland/feast-site)

## Background

A comprehensive 6-team UI/UX audit was conducted across every view and component in BDE. Each team consisted of 3 personas (UX Designer, Product Manager, Sr. Frontend Dev) providing tactical findings with exact CSS values and component changes. Full audit reports are in `docs/superpowers/audits/team-{0-5}-*.md`.

## Scope Summary

- **100+ components** across 9 views audited
- **7,495 LOC of CSS** across 13 files reviewed
- **20 Zustand stores** analyzed for patterns/anti-patterns

## Key Findings

### Bugs (Must Fix)

1. **Terminal zoom broken** — store tracks `fontSize` but TerminalPane hardcodes `fontSize: 13`
2. **HealthBar shows fake data** — hardcodes `queued: 0` and `doneToday: 0`
3. **13+ missing CSS class definitions in Settings** — components reference classes with no rules
4. **SpawnModal references nonexistent CSS classes** — `.spawn-modal__*` undefined
5. **Duplicate Merge Button state** — PRStationDetail header vs PRStationActions independent state
6. **Zustand anti-pattern in NotificationBell** — `getUnreadCount()` in render creates new arrays
7. **PanelTabBar/PanelLeaf theming bug** — inline styles from static `tokens.ts` ignore CSS variable overrides

### Systemic Issues

1. **Inline style epidemic** — 356 `style={}` across 58 files. Dashboard (100%), Git Tree (100%), AgentCard, ChatBubble, TaskWorkbench (4 components) all bypass CSS variables entirely.
2. **Dual token system** — v1 (`--bde-*`) powers components with stale values. v2 (`--bg-*`, `--text-*`) has feast-site-correct values but only drives utility classes. Button.tsx applies BOTH class systems with conflicting values.
3. **Border radius gap** — Current 4-12px everywhere, target 8-20px. 30+ hardcoded values in CSS + 50+ inline `borderRadius` in TSX.
4. **Running agents feel dead** — 6px pulsing dot is the only "alive" signal. `glow-pulse` and `glow-accent-sm` classes exist in design-system.css but are unused.
5. **~400 lines dead CSS** in sprint.css — duplicate rules, dead design-mode section, unused PR list/row styles.
6. **Inter font imported but unused** — `--bde-font-ui` still points to system fonts.

## Design Spec

### Phase 1: Foundation Token Swap (Global Impact, Minimal Risk)

Update `base.css` `:root` and `tokens.ts` to feast-site values:

**Colors:**

```css
--bde-bg: #050507; /* was #0A0A0A */
--bde-surface: #111118; /* was #141414 */
--bde-surface-high: #16161f; /* was #1E1E1E */
--bde-border: #1e1e2a; /* was #333333 */
--bde-border-hover: #2a2a3a; /* was #444444 */
--bde-text: #f5f5f7; /* was #E8E8E8 */
--bde-text-muted: #98989f; /* was #888888 */
--bde-text-dim: #5c5c63; /* was #555555 */
--bde-font-ui: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

**Radii:**

```css
--bde-radius-sm: 8px; /* was 4px */
--bde-radius-md: 12px; /* was 6px */
--bde-radius-lg: 16px; /* was 8px */
--bde-radius-xl: 20px; /* was 12px */
/* New: */
--bde-radius-2xl: 24px;
--bde-radius-3xl: 32px;
```

**Shadows:**

```css
--bde-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2);
--bde-shadow-md: 0 4px 16px rgba(0, 0, 0, 0.4), 0 2px 4px rgba(0, 0, 0, 0.2);
--bde-shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.4), 0 4px 16px rgba(0, 0, 0, 0.2);
/* New: */
--bde-shadow-glow: 0 4px 16px rgba(0, 211, 127, 0.3);
--bde-shadow-glow-hover: 0 4px 24px rgba(0, 211, 127, 0.4), 0 0 8px rgba(0, 211, 127, 0.3);
--bde-shadow-elevation: 0 24px 80px rgba(0, 0, 0, 0.6), 0 8px 24px rgba(0, 0, 0, 0.25);
--bde-border-subtle: rgba(255, 255, 255, 0.04);
--bde-text-ghost: #3a3a42;
--bde-gradient-cta: linear-gradient(135deg, #00d37f, #00a863);
--bde-gradient-ambient: radial-gradient(circle, rgba(0, 211, 127, 0.08) 0%, transparent 70%);
```

### Phase 2: Bug Fixes

All 7 bugs listed above — terminal zoom, HealthBar data, missing CSS classes, SpawnModal CSS, duplicate MergeButton state, Zustand anti-pattern, PanelTabBar theming.

### Phase 3: Design System Utilities & Button Unification

Add to `design-system.css`:

- `.glass-surface` — glass background with blur and subtle border
- `.ambient-glow` — radial gradient pseudo-element for "lit from within"
- `.btn-cta` — feast-site gradient CTA with glow shadow
- `.section-label-accent` — uppercase green section labels
- `.hover-border-brighten` — border transition on hover
- `.stagger-child` — staggered entrance animation
- `.card-hover-lift` — subtle lift with shadow on hover

Unify Button dual-class problem — merge v2 styles into v1 classes, remove dual application.

### Phase 4: Dead CSS Cleanup

- Delete ~221-line `.design-mode` section from sprint.css
- Delete duplicate `.spec-drawer__prompt-*` rules (46 lines)
- Verify and delete dead `.pr-list`/`.pr-row`/`.pr-confirm` CSS
- Remove legacy CSS variable aliases from base.css
- Fix 10+ legacy CSS variable references in sprint.css

### Phase 5: Inline Style Extraction (High-Priority Components)

Extract inline styles to CSS classes for the components that block the feast-site migration most:

- **Dashboard** — 100% inline, no CSS file. Create `dashboard.css`.
- **Git Tree** — 100% inline (5 components). Create git-tree CSS classes.
- **AgentCard** — 100% inline. Create comprehensive `agents.css`.
- **ChatBubble** — inline styles. Move to CSS.
- **PanelTabBar/PanelLeaf** — inline styles causing theming bug. Move to CSS.
- **TaskWorkbench** (4 components) — 100% inline. Create workbench CSS.
- **EventCard** — 33 inline styles. Move to CSS.

### Phase 6: Shell & Navigation Polish

- TitleBar: increase to 38px, add ambient logo glow, cost pill badge
- ActivityBar: active icon ambient glow, visual grouping dividers
- StatusBar: expand with git branch, agent count, queue depth
- CommandPalette: radius upgrade, selected state styling
- Panel system: focus glow instead of hard outline, resize handle hover states
- Toast notifications: glassmorphism + accent gradient border

### Phase 7: Feature View Visual Upgrades

**Sprint & Tasks:**

- TaskCard: 16px radius, hover lift, status-colored ambient glow, glassmorphic column headers
- Kanban columns: 20px radius, glass treatment, drop target glow
- SprintToolbar: pill-shaped filter chips

**Agents & Terminal:**

- Running agent "breathing" glow — ambient radial gradient + pulse-glow animation
- AgentCard: card container treatment, status-colored left border glow
- ChatBubble: 14px asymmetric corners, glass treatment
- ThinkingBlock: shimmer animation while running
- Terminal: richer chrome, inner shadow, font zoom fix integration

**Code Review & Git:**

- Merge Button → feast-site gradient CTA (poster child)
- PR list rows: card treatment with glass, hover border brighten
- Diff viewer: softer line highlighting, glassmorphic sticky file headers
- Commit button: gradient treatment
- Filter bar: pill-shaped chips

**Dashboard (Hero View):**

- Complete visual overhaul — gradient card headers, ambient glow background
- Stagger entrance animation for cards
- Glass-surface card treatment
- Active tasks with status-colored dots and micro-animations
- Hero greeting section (time-of-day context)

**Supporting Views:**

- Cost: fix grid layout, add SVG sparkline trends
- Memory: glassmorphic sidebar, editor polish
- Settings: grouped card layout, define missing CSS classes, toggle switches
- Notifications: entrance animation, persistence, per-item dismiss

### Phase 8: V2 Token Consolidation

- Remove duplicate v2 tokens (`--bg-*`, `--border`, `--text-*`, `--accent-*`) from `:root`
- Update ~20 utility class references to use `--bde-*` equivalents
- Remove legacy aliases

### Phase 9: Accessibility & Polish

- Keyboard navigation: PanelTabBar arrows, NotificationBell dropdown, AgentList, Kanban
- ARIA: ReviewSubmitDialog dialog semantics, CommandPalette aria-activedescendant
- Missing primitives: Toggle/Switch, Select/Dropdown, Skeleton component
- Remaining inline style extraction (lower-priority files)

## Non-Goals (Out of Scope)

- Light theme redesign (follow-up work after dark theme is settled)
- New features (bulk task actions, git stash/amend, vertical terminal split)
- Data visualization library (SVG sparklines only, no charting dependency)
- Mobile/responsive layout (Electron app, always full-window)

## Success Criteria

1. Every view uses CSS variables for all visual properties — zero hardcoded colors/radii in component code
2. Border radius minimum 8px on all interactive surfaces
3. Running agents have visible "alive" animations (glow, breathe, shimmer)
4. Merge Button uses feast-site CTA gradient with glow shadow
5. Dashboard feels like a premium command center, not a debug panel
6. All 7 bugs fixed
7. sprint.css reduced by ~400 lines
8. Button component uses a single class system (no dual v1/v2 conflict)
9. `npm run build` and `npm test` pass after every phase

## Audit Reports Reference

- `docs/superpowers/audits/team-0-design-system.md` — Token spec, migration path
- `docs/superpowers/audits/team-1-shell-navigation.md` — Shell chrome, panels, command palette
- `docs/superpowers/audits/team-2-sprint-tasks.md` — Kanban, cards, workbench, sprint.css
- `docs/superpowers/audits/team-3-agents-terminal.md` — Agent cards, chat, terminal, running state
- `docs/superpowers/audits/team-4-code-review-git.md` — PR Station, diff viewer, git tree
- `docs/superpowers/audits/team-5-supporting-views.md` — Dashboard, cost, memory, settings, notifications
