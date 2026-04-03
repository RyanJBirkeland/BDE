# Feast-Site UI Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform BDE from a utilitarian VS Code-like IDE into a premium, playful, glassmorphic desktop experience inspired by the feast-site aesthetic — gradients, soft corners, ambient glows, depth.

**Architecture:** Bottom-up approach. Phase 1 updates foundation tokens (instant global impact). Phase 2 fixes bugs. Phase 3 adds design system utilities. Phase 4-5 clean and extract. Phase 6-9 apply feast-site treatment view-by-view. Each task is a self-contained PR-able unit.

**Tech Stack:** CSS custom properties, TypeScript tokens, Zustand stores, React components, Vitest

**Spec:** `docs/superpowers/specs/2026-03-24-feast-site-ui-redesign-design.md`
**Audit Reports:** `docs/superpowers/audits/team-{0-5}-*.md`

---

## File Map

### Foundation (Tasks 1-3)

- **Modify:** `src/renderer/src/assets/base.css` — token values in `:root`
- **Modify:** `src/renderer/src/design-system/tokens.ts` — matching TypeScript values
- **Modify:** `src/renderer/src/assets/design-system.css` — new utility classes, button unification

### Bug Fixes (Task 4)

- **Modify:** `src/renderer/src/components/terminal/TerminalPane.tsx` — fontSize fix
- **Modify:** `src/renderer/src/components/agents/HealthBar.tsx` — hardcoded data fix
- **Modify:** `src/renderer/src/assets/settings.css` — missing class definitions
- **Modify:** `src/renderer/src/components/layout/NotificationBell.tsx` — Zustand selector fix
- **Modify:** `src/renderer/src/components/panels/PanelTabBar.tsx` — inline→CSS
- **Modify:** `src/renderer/src/components/panels/PanelLeaf.tsx` — inline→CSS

### Dead CSS Cleanup (Task 5)

- **Modify:** `src/renderer/src/assets/sprint.css` — remove ~400 dead lines

### Inline Style Extraction (Tasks 6-8)

- **Create:** `src/renderer/src/assets/dashboard.css`
- **Modify:** `src/renderer/src/views/DashboardView.tsx`
- **Modify:** `src/renderer/src/components/dashboard/*.tsx`
- **Modify:** `src/renderer/src/components/agents/AgentCard.tsx`
- **Modify:** `src/renderer/src/assets/agents.css` — expand from 49 lines
- **Modify:** `src/renderer/src/components/git-tree/*.tsx`

### Shell Polish (Task 9)

- **Modify:** `src/renderer/src/assets/main.css` — titlebar, activity bar, status bar, panels
- **Modify:** `src/renderer/src/components/layout/StatusBar.tsx`

### Feature View Upgrades (Tasks 10-13)

- **Modify:** `src/renderer/src/assets/sprint.css` — feast-site treatment
- **Modify:** `src/renderer/src/assets/agents.css` — running agent glow
- **Modify:** `src/renderer/src/assets/terminal.css` — chrome polish
- **Modify:** `src/renderer/src/assets/pr-station.css` — card treatment, merge CTA
- **Modify:** `src/renderer/src/assets/diff.css` — softer highlighting
- **Modify:** `src/renderer/src/assets/dashboard.css` — hero treatment
- **Modify:** `src/renderer/src/assets/cost.css` — layout fix
- **Modify:** `src/renderer/src/assets/memory.css` — glass sidebar

### Token Consolidation (Task 14)

- **Modify:** `src/renderer/src/assets/base.css` — remove v2 duplicates
- **Modify:** `src/renderer/src/assets/design-system.css` — update references

---

## Task 1: Foundation Token Swap — CSS Variables

**Files:**

- Modify: `src/renderer/src/assets/base.css:34-116` (`:root` token values)

- [ ] **Step 1: Update color tokens in base.css**

In `base.css`, update the `:root` color block (lines 34-51):

```css
/* Colors */
--bde-bg: #050507; /* was #0A0A0A */
--bde-surface: #111118; /* was #141414 */
--bde-surface-high: #16161f; /* was #1E1E1E */
--bde-border: #1e1e2a; /* was #333333 */
--bde-border-hover: #2a2a3a; /* was #444444 */
--bde-accent: #00d37f; /* unchanged */
--bde-accent-dim: rgba(0, 211, 127, 0.15); /* unchanged */
--bde-text: #f5f5f7; /* was #E8E8E8 */
--bde-text-muted: #98989f; /* was #888888 */
--bde-text-dim: #5c5c63; /* was #555555 */
```

- [ ] **Step 2: Update radius tokens in base.css**

Update lines 101-106:

```css
/* Radii */
--bde-radius-sm: 8px; /* was 4px */
--bde-radius-md: 12px; /* was 6px */
--bde-radius-lg: 16px; /* was 8px */
--bde-radius-xl: 20px; /* was 12px */
--bde-radius-2xl: 24px; /* NEW */
--bde-radius-3xl: 32px; /* NEW */
--bde-radius-full: 9999px;
```

- [ ] **Step 3: Update shadow tokens in base.css**

Update lines 108-111:

```css
/* Shadows */
--bde-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2);
--bde-shadow-md: 0 4px 16px rgba(0, 0, 0, 0.4), 0 2px 4px rgba(0, 0, 0, 0.2);
--bde-shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.4), 0 4px 16px rgba(0, 0, 0, 0.2);
```

- [ ] **Step 4: Add new feast-site tokens after shadows**

Add after the shadow block:

```css
/* Glow shadows */
--bde-shadow-glow: 0 4px 16px rgba(0, 211, 127, 0.3);
--bde-shadow-glow-hover: 0 4px 24px rgba(0, 211, 127, 0.4), 0 0 8px rgba(0, 211, 127, 0.3);
--bde-shadow-elevation: 0 24px 80px rgba(0, 0, 0, 0.6), 0 8px 24px rgba(0, 0, 0, 0.25);

/* Feast-site additions */
--bde-border-subtle: rgba(255, 255, 255, 0.04);
--bde-text-ghost: #3a3a42;
--bde-gradient-cta: linear-gradient(135deg, #00d37f, #00a863);
--bde-gradient-ambient: radial-gradient(circle, rgba(0, 211, 127, 0.08) 0%, transparent 70%);
```

- [ ] **Step 5: Update font-ui to Inter-first**

Update line 81:

```css
--bde-font-ui: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

- [ ] **Step 6: Run typecheck and tests**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck && npm test`
Expected: All pass (CSS changes don't affect TS types or test assertions)

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/assets/base.css
git commit -m "feat: update design tokens to feast-site values (colors, radii, shadows, font)"
```

---

## Task 2: Foundation Token Swap — TypeScript tokens.ts

**Files:**

- Modify: `src/renderer/src/design-system/tokens.ts`

- [ ] **Step 1: Update color values**

```typescript
color: {
  bg: '#050507',              // was #0A0A0A
  surface: '#111118',          // was #141414
  surfaceHigh: '#16161F',      // was #1E1E1E
  border: '#1E1E2A',           // was #333333
  borderHover: '#2A2A3A',      // was #444444
  text: '#F5F5F7',             // was #E8E8E8
  textMuted: '#98989F',        // was #888888
  textDim: '#5C5C63',          // was #555555
  // ... rest unchanged
},
```

- [ ] **Step 2: Update radius values**

```typescript
radius: {
  sm: '8px',     // was 4px
  md: '12px',    // was 6px
  lg: '16px',    // was 8px
  xl: '20px',    // was 12px
  '2xl': '24px', // NEW
  '3xl': '32px', // NEW
  full: '9999px',
},
```

- [ ] **Step 3: Update shadow values**

```typescript
shadow: {
  sm: '0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)',
  md: '0 4px 16px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.2)',
  lg: '0 8px 32px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.2)',
},
```

- [ ] **Step 4: Update font-ui**

```typescript
font: {
  ui: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  code: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
},
```

- [ ] **Step 5: Run typecheck and tests**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck && npm test`
Expected: All pass. Any test snapshots using exact token values will need updating.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/design-system/tokens.ts
git commit -m "feat: update tokens.ts to match feast-site CSS variable values"
```

---

## Task 3: Design System Utilities & Button Unification

**Files:**

- Modify: `src/renderer/src/assets/design-system.css` — add utility classes
- Modify: `src/renderer/src/components/ui/Button.tsx` — remove dual-class application

- [ ] **Step 1: Add new utility classes to design-system.css**

Append before the `@media (prefers-reduced-motion)` block:

```css
/* ── Feast-Site Utilities ───────────────────────────── */

/* Ambient Glow — "lit from within" radial gradient */
.ambient-glow {
  position: relative;
}
.ambient-glow::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 120%;
  height: 120%;
  transform: translate(-50%, -50%);
  background: var(--bde-gradient-ambient);
  pointer-events: none;
  z-index: 0;
}

/* Glass Surface — blurred translucent background */
.glass-surface {
  background: rgba(10, 10, 18, 0.75);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid var(--bde-border-subtle);
}

/* CTA Glow Button — feast-site signature gradient */
.btn-cta {
  background: var(--bde-gradient-cta);
  color: #000;
  font-weight: 600;
  border: none;
  border-radius: var(--bde-radius-md);
  box-shadow: var(--bde-shadow-glow);
  transition: all 200ms ease-out;
}
.btn-cta:hover {
  box-shadow: var(--bde-shadow-glow-hover);
  filter: brightness(1.1);
}
.btn-cta:active {
  transform: scale(0.97);
  filter: brightness(0.95);
}

/* Accent Section Label — uppercase green */
.section-label-accent {
  font-size: var(--bde-size-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--bde-accent);
}

/* Hover Border Brighten — subtle border transition */
.hover-border-brighten {
  border: 1px solid var(--bde-border-subtle);
  transition: border-color 200ms ease-out;
}
.hover-border-brighten:hover {
  border-color: rgba(255, 255, 255, 0.08);
}

/* Card Hover Lift — subtle elevation on hover */
.card-hover-lift {
  transition:
    transform 200ms ease-out,
    box-shadow 200ms ease-out;
}
.card-hover-lift:hover {
  transform: translateY(-1px);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.4),
    0 4px 16px rgba(0, 211, 127, 0.08);
}

/* Stagger Animation — entrance delay per child */
.stagger-child {
  animation: bde-slide-up-fade 300ms ease-out both;
}
.stagger-child:nth-child(1) {
  animation-delay: 0ms;
}
.stagger-child:nth-child(2) {
  animation-delay: 40ms;
}
.stagger-child:nth-child(3) {
  animation-delay: 80ms;
}
.stagger-child:nth-child(4) {
  animation-delay: 120ms;
}
.stagger-child:nth-child(5) {
  animation-delay: 160ms;
}
.stagger-child:nth-child(6) {
  animation-delay: 200ms;
}
.stagger-child:nth-child(7) {
  animation-delay: 240ms;
}
.stagger-child:nth-child(8) {
  animation-delay: 280ms;
}

/* Glow Breathe — for running/active indicators */
@keyframes bde-glow-breathe {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
}
```

- [ ] **Step 2: Read Button.tsx to identify dual-class lines**

Read `src/renderer/src/components/ui/Button.tsx` and locate where both `.bde-btn--primary` and `.btn-primary` (and `.bde-btn--ghost` / `.btn-glass`) are applied simultaneously.

- [ ] **Step 3: Unify Button classes**

Remove the v2 class additions from Button.tsx. The v1 `.bde-btn--*` classes should be the sole classes. Then update `.bde-btn--primary` in design-system.css to include the gradient and glow from the v2 `.btn-primary` styles:

In design-system.css, update `.bde-btn--primary`:

```css
.bde-btn--primary {
  background: var(--bde-gradient-cta);
  color: var(--bde-btn-primary-text);
  border: none;
  border-radius: var(--bde-radius-md);
  box-shadow: var(--bde-shadow-glow);
}
.bde-btn--primary:hover:not(:disabled) {
  box-shadow: var(--bde-shadow-glow-hover);
  filter: brightness(1.1);
}
```

Remove or comment out the now-redundant `.btn-primary` and `.btn-glass` classes.

- [ ] **Step 4: Run typecheck and tests**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck && npm test`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/assets/design-system.css src/renderer/src/components/ui/Button.tsx
git commit -m "feat: add feast-site utility classes and unify Button dual-class system"
```

---

## Task 4: Bug Fixes

**Files:**

- Modify: `src/renderer/src/components/terminal/TerminalPane.tsx`
- Modify: `src/renderer/src/components/agents/HealthBar.tsx`
- Modify: `src/renderer/src/assets/settings.css`
- Modify: `src/renderer/src/components/layout/NotificationBell.tsx`
- Modify: `src/renderer/src/components/panels/PanelTabBar.tsx`
- Modify: `src/renderer/src/components/panels/PanelLeaf.tsx`
- Modify: `src/renderer/src/assets/main.css`

### 4a: Terminal Zoom Fix

- [ ] **Step 1: Read TerminalPane.tsx and terminal store**

Read `src/renderer/src/components/terminal/TerminalPane.tsx` and `src/renderer/src/stores/terminal.ts`. Find where `fontSize` is hardcoded to `13` instead of reading from the store.

- [ ] **Step 2: Fix TerminalPane to use store fontSize**

Replace the hardcoded `fontSize: 13` with the store's `fontSize` value. The store already tracks it — the component just doesn't read it.

- [ ] **Step 3: Run tests**

Run: `cd /Users/ryan/projects/BDE && npm test -- --grep -i terminal`

- [ ] **Step 4: Commit**

```bash
git commit -m "fix: terminal zoom — use store fontSize instead of hardcoded 13"
```

### 4b: HealthBar Hardcoded Data Fix

- [ ] **Step 5: Read HealthBar.tsx**

Read `src/renderer/src/components/agents/HealthBar.tsx`. Find the hardcoded `queued: 0` and `doneToday: 0` values.

- [ ] **Step 6: Fix HealthBar to use real data**

Replace hardcoded values with actual data from the agents store or props. If the data isn't available, remove the misleading display rather than showing zeros.

- [ ] **Step 7: Commit**

```bash
git commit -m "fix: HealthBar — remove hardcoded zero values for queued/doneToday"
```

### 4c: Missing Settings CSS Classes

- [ ] **Step 8: Read Settings components to identify referenced classes**

Grep for class names like `settings-connection`, `settings-repo-form`, `settings-template-row`, `settings-field__hint`, `settings-repo__dot`, `settings-repo__github`, `settings-repos__add-btn` in `src/renderer/src/components/settings/`.

- [ ] **Step 9: Add missing class definitions to settings.css**

Add CSS rules for each missing class in `src/renderer/src/assets/settings.css`. Use the new feast-site tokens for all values (radii, colors, borders).

- [ ] **Step 10: Commit**

```bash
git commit -m "fix: add missing CSS class definitions for Settings components"
```

### 4d: NotificationBell Zustand Fix

- [ ] **Step 11: Read NotificationBell.tsx**

Read `src/renderer/src/components/layout/NotificationBell.tsx`. Find the `getUnreadCount()` call in render that creates new arrays.

- [ ] **Step 12: Fix to use a derived selector**

Replace `getUnreadCount()` in render with a stable Zustand selector:

```typescript
const unreadCount = useNotificationStore((s) => s.notifications.filter((n) => !n.read).length)
```

Or better, add a `selectUnreadCount` selector to the store that returns a number (stable primitive, no shallow equality issues).

- [ ] **Step 13: Commit**

```bash
git commit -m "fix: NotificationBell — replace getUnreadCount() render call with stable selector"
```

### 4e: SpawnModal Missing CSS Classes

- [ ] **Step 14: Read SpawnModal.tsx**

Read `src/renderer/src/components/agents/SpawnModal.tsx`. Identify all `.spawn-modal__*` class references.

- [ ] **Step 15: Add missing class definitions to agents.css**

Add CSS rules for each `.spawn-modal__*` class in `src/renderer/src/assets/agents.css`. Use feast-site tokens (glass surface for the modal body, gradient CTA for the spawn button, 16px radius for form inputs).

- [ ] **Step 16: Commit**

```bash
git commit -m "fix: add missing SpawnModal CSS class definitions"
```

### 4f: Duplicate MergeButton State Consolidation

- [ ] **Step 17: Read PRStationDetail.tsx and PRStationActions.tsx**

Identify where both components independently manage merge strategy state (squash/merge/rebase).

- [ ] **Step 18: Consolidate merge strategy state**

Lift the merge strategy state to the parent or a shared store so both locations read from the same source. Remove the duplicate state from whichever component doesn't own it.

- [ ] **Step 19: Commit**

```bash
git commit -m "fix: consolidate MergeButton state between PRStationDetail and PRStationActions"
```

### 4g: PanelTabBar/PanelLeaf Inline Style → CSS

- [ ] **Step 20: Read PanelTabBar.tsx and PanelLeaf.tsx**

Read both files. Identify all inline `style={{...}}` using `tokens.*` values.

- [ ] **Step 21: Extract inline styles to CSS classes in main.css**

Create CSS classes like `.panel-tab`, `.panel-tab--active`, `.panel-leaf`, `.panel-leaf--focused` in the panel section of `main.css` using CSS variables instead of the static tokens object.

- [ ] **Step 22: Replace inline styles with class names in both components**

- [ ] **Step 23: Run tests**

Run: `cd /Users/ryan/projects/BDE && npm test`

- [ ] **Step 24: Commit**

```bash
git commit -m "fix: PanelTabBar/PanelLeaf — extract inline styles to CSS classes for theming"
```

---

## Task 5: Dead CSS Cleanup in sprint.css

**Files:**

- Modify: `src/renderer/src/assets/sprint.css`

- [ ] **Step 1: Identify dead CSS sections**

Grep the codebase for references to these CSS class patterns:

- `.design-mode` — should be ~221 lines of unused rules
- Duplicate `.spec-drawer__prompt-*` rules — ~46 lines
- `.pr-list`, `.pr-row`, `.pr-confirm` — may be dead (PR components moved to `pr-station/`)

For each class, verify it's unused: `grep -r "design-mode\|pr-list\|pr-row\|pr-confirm" src/renderer/src/`

- [ ] **Step 2: Delete confirmed dead CSS**

Remove all verified dead sections from `sprint.css`.

- [ ] **Step 3: Fix legacy CSS variable references**

Search sprint.css for any non-`--bde-*` variable references (e.g., `--bg`, `--border`, `--text-muted`) and update to the canonical `--bde-*` names.

- [ ] **Step 4: Run tests**

Run: `cd /Users/ryan/projects/BDE && npm test`

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: remove ~400 lines of dead CSS from sprint.css"
```

---

## Task 6: Dashboard Inline Style Extraction

**Files:**

- Create: `src/renderer/src/assets/dashboard.css`
- Modify: `src/renderer/src/views/DashboardView.tsx`
- Modify: `src/renderer/src/components/dashboard/DashboardCard.tsx`
- Modify: `src/renderer/src/components/dashboard/ActiveTasksCard.tsx`
- Modify: `src/renderer/src/components/dashboard/RecentCompletionsCard.tsx`
- Modify: `src/renderer/src/components/dashboard/CostSummaryCard.tsx`
- Modify: `src/renderer/src/components/dashboard/OpenPRsCard.tsx`

- [ ] **Step 1: Read all dashboard component files**

Read `DashboardView.tsx` and all 5 card components. Catalog every inline `style={{...}}` usage.

- [ ] **Step 2: Create dashboard.css with feast-site treatment**

Create `src/renderer/src/assets/dashboard.css`. Define classes for:

- `.dashboard` — grid layout with ambient glow background
- `.dashboard-card` — glass-surface treatment, 20px radius, hover lift, gradient header accent
- `.dashboard-card__header` — section label accent style
- `.dashboard-card__body` — content area padding
- `.dashboard-card__list` — task/PR list styling
- `.dashboard-card__empty` — empty state treatment
- `.dashboard-card__stat` — stat grid for cost summary

Use CSS variables from the new token system, not hardcoded values.

- [ ] **Step 3: Import dashboard.css in the app**

Add import in `DashboardView.tsx` or in the main CSS import chain.

- [ ] **Step 4: Replace inline styles with CSS classes in all 6 files**

Replace every `style={{...}}` with appropriate CSS class names. Remove `tokens` import if no longer needed.

- [ ] **Step 5: Run tests**

Run: `cd /Users/ryan/projects/BDE && npm test`

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/assets/dashboard.css src/renderer/src/views/DashboardView.tsx src/renderer/src/components/dashboard/
git commit -m "feat: extract Dashboard inline styles to CSS with feast-site treatment"
```

---

## Task 7: Agent Components Inline Style Extraction

**Files:**

- Modify: `src/renderer/src/assets/agents.css` (expand from 49 lines)
- Modify: `src/renderer/src/components/agents/AgentCard.tsx`
- Modify: `src/renderer/src/components/agents/ChatBubble.tsx`
- Modify: `src/renderer/src/components/agents/AgentDetail.tsx`
- Modify: `src/renderer/src/components/agents/AgentList.tsx`

- [ ] **Step 1: Read AgentCard.tsx, ChatBubble.tsx, AgentDetail.tsx, AgentList.tsx**

Catalog all inline styles. Note the current agents.css is only 49 lines.

- [ ] **Step 2: Expand agents.css with comprehensive styling**

Add CSS classes for:

- `.agent-card` — card container with border-radius 16px, hover border brighten
- `.agent-card--running` — ambient glow left border, pulse animation
- `.agent-card--completed` — settled/muted treatment
- `.agent-card--failed` — danger-tinted left border
- `.agent-card__status-dot` — 8px dot with glow ring for running state
- `.agent-card__meta` — model, cost, elapsed time
- `.chat-bubble` — 14px radius, glass surface background
- `.chat-bubble--assistant` — surface-high background
- `.chat-bubble--user` — accent-tinted background
- `.agent-detail` — layout classes
- `.agent-list` — list container, section headers

- [ ] **Step 3: Replace inline styles in all 4 components**

- [ ] **Step 4: Run tests**

Run: `cd /Users/ryan/projects/BDE && npm test`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/assets/agents.css src/renderer/src/components/agents/
git commit -m "feat: extract Agent component inline styles to CSS with feast-site treatment"
```

---

## Task 8: Git Tree Inline Style Extraction

**Files:**

- Modify: `src/renderer/src/components/git-tree/GitFileRow.tsx`
- Modify: `src/renderer/src/components/git-tree/FileTreeSection.tsx`
- Modify: `src/renderer/src/components/git-tree/CommitBox.tsx`
- Modify: `src/renderer/src/components/git-tree/BranchSelector.tsx`
- Modify: `src/renderer/src/components/git-tree/InlineDiffDrawer.tsx`
- Modify: `src/renderer/src/assets/main.css` (or create git-tree section)

- [ ] **Step 1: Read all 5 Git Tree components**

These use 100% inline styles via `tokens.*`. Also check `InlineDiffDrawer.tsx` for hardcoded `rgba()` values.

- [ ] **Step 2: Add git-tree CSS section to main.css**

Add classes for:

- `.git-file-row` — file row with hover state via CSS (not JS onMouseEnter/onMouseLeave)
- `.git-file-row__status` — status indicator badge
- `.git-section` — collapsible section with header
- `.git-commit-box` — commit input with feast-site radius and focus glow
- `.git-branch-selector` — dropdown with glass surface
- `.git-diff-drawer` — inline diff panel using CSS variables (not hardcoded rgba)

Replace all JS-managed hover states (`onMouseEnter`/`onMouseLeave`) with CSS `:hover` pseudo-classes.

- [ ] **Step 3: Replace inline styles in all 5 components**

- [ ] **Step 4: Run tests**

Run: `cd /Users/ryan/projects/BDE && npm test`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/git-tree/ src/renderer/src/assets/main.css
git commit -m "feat: extract Git Tree inline styles to CSS, replace JS hover with CSS :hover"
```

---

## Task 9: Shell & Navigation Polish

**Files:**

- Modify: `src/renderer/src/assets/main.css`
- Modify: `src/renderer/src/components/layout/StatusBar.tsx`
- Modify: `src/renderer/src/assets/command-palette.css`
- Modify: `src/renderer/src/assets/toasts.css`

- [ ] **Step 1: Read current titlebar, activity bar, status bar CSS in main.css**

- [ ] **Step 2: Update titlebar styles**

```css
.titlebar {
  height: 38px; /* was 32px */
  padding-right: 16px; /* was 12px */
}
/* Add ambient glow behind logo area */
.titlebar::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  width: 200px;
  height: 100%;
  background: radial-gradient(circle at 10% 50%, rgba(0, 211, 127, 0.06) 0%, transparent 70%);
  pointer-events: none;
}
```

- [ ] **Step 3: Update activity bar active indicator**

Add glow effect on active icon:

```css
.activity-btn--active::after {
  /* existing active indicator */
  box-shadow: 0 0 8px rgba(0, 211, 127, 0.3);
}
```

- [ ] **Step 4: Update panel focus and resize handles**

Replace hard outline with glow:

```css
.panel-leaf--focused {
  box-shadow: inset 0 0 0 1px rgba(0, 211, 127, 0.15);
  /* was: outline: 1px solid var(--bde-accent) */
}
```

- [ ] **Step 5: Update command palette radius and selection**

In `command-palette.css`, update border-radius values to use `--bde-radius-lg` (16px) and add accent glow on selected item.

- [ ] **Step 6: Update toast styles**

In `toasts.css`, add glass surface and accent border:

```css
.toast {
  background: rgba(10, 10, 18, 0.85);
  backdrop-filter: blur(16px);
  border: 1px solid var(--bde-border-subtle);
  border-radius: var(--bde-radius-lg);
}
```

- [ ] **Step 7: Run tests**

Run: `cd /Users/ryan/projects/BDE && npm test`

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/assets/main.css src/renderer/src/assets/command-palette.css src/renderer/src/assets/toasts.css
git commit -m "feat: shell polish — taller titlebar, ambient glow, panel focus glow, toast glass"
```

---

## Task 10: Sprint & Kanban Feast-Site Treatment

**Files:**

- Modify: `src/renderer/src/assets/sprint.css`

- [ ] **Step 1: Read sprint.css current state (after Task 5 cleanup)**

- [ ] **Step 2: Update kanban column styles**

```css
.kanban-col {
  border-radius: var(--bde-radius-xl); /* was --bde-radius-md */
  /* Add glass surface treatment */
  background: rgba(10, 10, 18, 0.6);
  backdrop-filter: blur(8px);
  border: 1px solid var(--bde-border-subtle);
}
.kanban-col--drop-target {
  box-shadow: 0 0 20px rgba(0, 211, 127, 0.12);
  border-color: var(--bde-accent);
}
```

- [ ] **Step 3: Update task card styles**

```css
.sprint-card {
  border-radius: var(--bde-radius-lg); /* was 4px/hardcoded */
  transition:
    transform 200ms ease-out,
    box-shadow 200ms ease-out,
    border-color 200ms ease-out;
}
.sprint-card:hover {
  transform: translateY(-1px);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.4),
    0 4px 16px rgba(0, 211, 127, 0.06);
  border-color: rgba(255, 255, 255, 0.08);
}
```

- [ ] **Step 4: Update all hardcoded border-radius values**

Search sprint.css for remaining hardcoded `border-radius` values (not using `var(--bde-radius-*)`) and replace with appropriate token references.

- [ ] **Step 5: Run tests**

Run: `cd /Users/ryan/projects/BDE && npm test`

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/assets/sprint.css
git commit -m "feat: sprint feast-site treatment — glass columns, card hover lift, soft radii"
```

---

## Task 11: Running Agent Glow & Terminal Polish

**Files:**

- Modify: `src/renderer/src/assets/agents.css`
- Modify: `src/renderer/src/assets/terminal.css`

- [ ] **Step 1: Add running agent breathing glow to agents.css**

```css
.agent-card--running {
  background:
    radial-gradient(circle at 0% 50%, rgba(0, 211, 127, 0.06) 0%, transparent 60%),
    var(--bde-surface);
  border-left: 2px solid var(--bde-accent);
}
.agent-card--running .agent-card__status-dot {
  width: 8px;
  height: 8px;
  background: var(--bde-accent);
  border-radius: 50%;
  box-shadow: 0 0 8px rgba(0, 211, 127, 0.4);
  animation: bde-glow-breathe 2s ease-in-out infinite;
}
```

- [ ] **Step 2: Add thinking block shimmer**

```css
.thinking-block--active {
  background: linear-gradient(
    90deg,
    var(--bde-surface) 0%,
    var(--bde-surface-high) 50%,
    var(--bde-surface) 100%
  );
  background-size: 200% 100%;
  animation: bde-shimmer 1.5s ease-in-out infinite;
}
```

- [ ] **Step 3: Update terminal chrome**

In `terminal.css`:

```css
.terminal-pane {
  border-radius: var(--bde-radius-lg);
  box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.3);
}
.terminal-tab--active {
  border-bottom: 2px solid var(--bde-accent);
  box-shadow: 0 1px 0 var(--bde-accent);
}
```

- [ ] **Step 4: Update all hardcoded radius values in terminal.css**

- [ ] **Step 5: Run tests**

Run: `cd /Users/ryan/projects/BDE && npm test`

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/assets/agents.css src/renderer/src/assets/terminal.css
git commit -m "feat: running agent glow/breathe animation, terminal chrome polish"
```

---

## Task 12: PR Station & Diff Feast-Site Treatment

**Files:**

- Modify: `src/renderer/src/assets/pr-station.css`
- Modify: `src/renderer/src/assets/diff.css`

- [ ] **Step 1: Read pr-station.css and diff.css current state**

- [ ] **Step 2: Update PR list row to card treatment**

```css
.pr-station__row {
  border-radius: var(--bde-radius-lg);
  border: 1px solid var(--bde-border-subtle);
  transition:
    border-color 200ms ease-out,
    transform 200ms ease-out;
}
.pr-station__row:hover {
  border-color: rgba(255, 255, 255, 0.08);
  transform: translateY(-1px);
}
```

- [ ] **Step 3: Upgrade Merge Button to feast-site CTA**

The `.merge-btn` (or `.pr-station__merge-btn`) should use the CTA gradient:

```css
.merge-btn {
  background: var(--bde-gradient-cta);
  color: #000;
  font-weight: 600;
  border: none;
  border-radius: var(--bde-radius-md);
  box-shadow: var(--bde-shadow-glow);
  transition: all 200ms ease-out;
}
.merge-btn:hover {
  box-shadow: var(--bde-shadow-glow-hover);
  filter: brightness(1.1);
}
.merge-btn:active {
  transform: scale(0.97);
}
```

- [ ] **Step 4: Update diff viewer styling**

In `diff.css`:

- Soften line highlight backgrounds (reduce opacity)
- Update hunk headers: glass surface treatment, larger radius
- Update file headers: sticky glassmorphic bar
- Replace any hardcoded border-radius with token references

- [ ] **Step 5: Update all hardcoded radius values in both files**

- [ ] **Step 6: Run tests**

Run: `cd /Users/ryan/projects/BDE && npm test`

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/assets/pr-station.css src/renderer/src/assets/diff.css
git commit -m "feat: PR Station feast-site — card treatment, merge CTA gradient, diff polish"
```

---

## Task 13: Dashboard Hero Treatment & Supporting Views

**Files:**

- Modify: `src/renderer/src/assets/dashboard.css` (created in Task 6)
- Modify: `src/renderer/src/assets/cost.css`
- Modify: `src/renderer/src/assets/memory.css`

- [ ] **Step 1: Add hero treatment to dashboard.css**

```css
/* Ambient background glow for entire dashboard */
.dashboard::before {
  content: '';
  position: absolute;
  top: -10%;
  left: 30%;
  width: 40%;
  height: 50%;
  background: radial-gradient(ellipse, rgba(0, 211, 127, 0.06) 0%, transparent 70%);
  pointer-events: none;
  z-index: 0;
}

/* Card gradient header accent */
.dashboard-card__header {
  border-bottom: 1px solid var(--bde-border-subtle);
  background: linear-gradient(135deg, rgba(0, 211, 127, 0.04) 0%, transparent 50%);
}

/* Stagger card entrance */
.dashboard-card {
  animation: bde-slide-up-fade 300ms ease-out both;
}
.dashboard-card:nth-child(1) {
  animation-delay: 0ms;
}
.dashboard-card:nth-child(2) {
  animation-delay: 60ms;
}
.dashboard-card:nth-child(3) {
  animation-delay: 120ms;
}
.dashboard-card:nth-child(4) {
  animation-delay: 180ms;
}
```

- [ ] **Step 2: Fix Cost View grid layout**

In `cost.css`, fix the single-panel-in-two-column-grid issue. Likely change to `grid-template-columns: 1fr` or make the panel span both columns.

- [ ] **Step 3: Update memory.css legacy variables**

Replace `--text-primary`, `--font-mono` etc. with `--bde-text`, `--bde-font-code`:

```css
/* Fix legacy variable references */
/* Replace: var(--text-primary) → var(--bde-text) */
/* Replace: var(--font-mono) → var(--bde-font-code) */
```

Add glassmorphic treatment to sidebar:

```css
.memory-sidebar {
  background: rgba(10, 10, 18, 0.6);
  backdrop-filter: blur(8px);
  border-right: 1px solid var(--bde-border-subtle);
  border-radius: var(--bde-radius-lg) 0 0 var(--bde-radius-lg);
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/ryan/projects/BDE && npm test`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/assets/dashboard.css src/renderer/src/assets/cost.css src/renderer/src/assets/memory.css
git commit -m "feat: dashboard hero glow, cost grid fix, memory glass sidebar"
```

---

## Task 14: V2 Token Consolidation

**Files:**

- Modify: `src/renderer/src/assets/base.css`
- Modify: `src/renderer/src/assets/design-system.css`

- [ ] **Step 1: Identify all v2 token references**

Grep for v2-only tokens across all CSS files:

```bash
grep -rn '\-\-bg-void\|--bg-base\|--bg-surface\|--bg-card\|--bg-hover\|--bg-active\|--text-primary\|--text-secondary\|--text-muted[^)]' src/renderer/src/assets/
```

Note: `--text-muted` is tricky because it exists in both v1 (`--bde-text-muted`) and v2 (`--text-muted`). Only update the non-`--bde-` prefixed ones.

- [ ] **Step 2: Update v2 references in design-system.css**

Replace each v2 token reference with its `--bde-*` equivalent:

- `--bg-void` → `--bde-bg`
- `--bg-surface` → `--bde-surface`
- `--bg-card` → `--bde-surface-high`
- `--text-primary` → `--bde-text`
- `--text-secondary` → `--bde-text-muted`
- `--border` (v2) → `--bde-border`
- `--border-light` (v2) → `--bde-border-hover`

- [ ] **Step 3: Remove v2 token definitions from base.css**

Remove the `/* ── Visual Identity v2 ── */` block (lines 118+) that defines the duplicate tokens. Keep any v2 tokens that DON'T have `--bde-*` equivalents (e.g., gradient definitions, glass tints).

- [ ] **Step 4: Remove legacy aliases from top of :root**

Remove lines 11-32 (the legacy alias block) since all references should now use `--bde-*` directly.

- [ ] **Step 5: Run typecheck and full test suite**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck && npm test`

- [ ] **Step 6: Visual smoke test**

Run: `cd /Users/ryan/projects/BDE && npm run dev`
Check: Dashboard, Sprint, Agents, PR Station, Settings all render correctly. No missing colors or broken layouts.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/assets/base.css src/renderer/src/assets/design-system.css
git commit -m "chore: consolidate v2 tokens into --bde-* namespace, remove duplicates"
```

---

## Dependency Graph

```
Task 1 (CSS tokens) ─┐
Task 2 (TS tokens)  ──┼── Task 3 (utilities + button) ──┐
                      │                                   │
                      ├── Task 4 (bug fixes)             │
                      │                                   │
                      ├── Task 5 (dead CSS)              │
                      │                                   │
                      └────────────────────────────────── ├── Task 9 (shell polish)
                                                          ├── Task 10 (sprint)
Task 6 (dashboard extract) ──────────────────────────── ├── Task 13 (dashboard hero)
Task 7 (agent extract) ─────────────────────────────── ├── Task 11 (agent glow)
Task 8 (git tree extract) ──────────────────────────── ├── Task 12 (PR station)
                                                          │
                                                          └── Task 14 (v2 consolidation)
```

**Parallelizable groups:**

- Tasks 1+2 are sequential (CSS first, then TS)
- Tasks 4, 5, 6, 7, 8 can ALL run in parallel after Tasks 1+2
- Tasks 3, 9, 10, 11, 12, 13 can run in parallel after their extraction dependencies
- Task 14 runs last (after all other CSS changes are stable)

---

## Verification Checklist

After all tasks:

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] All views render correctly in `npm run dev`:
  - [ ] Dashboard (⌘1) — ambient glow, glass cards, stagger animation
  - [ ] Agents (⌘2) — running agents glow/breathe
  - [ ] Terminal (⌘3) — zoom works, polished chrome
  - [ ] Sprint (⌘4) — glass columns, card hover lift
  - [ ] PR Station (⌘5) — merge button gradient CTA
  - [ ] Source Control (⌘6) — CSS-driven hover states
  - [ ] Memory (⌘7) — glass sidebar
  - [ ] Cost (⌘8) — fixed grid layout
  - [ ] Settings (⌘9) — all classes styled
- [ ] Light theme toggle doesn't break (CSS variables respected)
- [ ] Reduced motion preference disables animations
