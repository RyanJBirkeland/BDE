# Shell & Design System -- Architectural Audit (AX)

**Auditor:** Architectural Engineer
**Date:** 2026-03-27
**Scope:** App shell, panel system, design tokens, neon primitives, ui primitives, layout components, DashboardView, SettingsView, CSS layers (base.css, neon.css, neon-shell.css, design-system.css)

---

## 1. Executive Summary

BDE has **two co-existing design systems** -- `ui/` (BEM classes via `design-system.css`, `--bde-*` CSS variables) and `neon/` (inline styles via `tokens.ts` + `neonVar()`, `--neon-*` CSS variables) -- with no formal boundary or migration path between them. The panel layout tree (`panelLayout.ts`) is a well-designed recursive data structure with clean pure-function mutations, but the app shell (`App.tsx`) bundles too many concerns into a single component. Neon primitives are moderately reusable but are heavily inline-styled, making them resistant to theming overrides and violating the project's own CSS-class styling convention. The most urgent issue is the **quadruple duplication of `VIEW_LABELS` / `VIEW_ICONS` / `VIEW_TITLES`** across four files, creating a sync-risk landmine that the CLAUDE.md gotchas section already warns about but does not structurally prevent.

---

## 2. Critical Issues (Must Fix)

### 2.1 VIEW_LABELS / VIEW_ICONS / VIEW_TITLES Duplicated 4x

**Files:**

- `src/renderer/src/stores/panelLayout.ts` (line 43) -- canonical `VIEW_LABELS`
- `src/renderer/src/components/layout/NeonSidebar.tsx` (lines 20-51) -- duplicates `VIEW_ICONS`, `VIEW_LABELS`, `VIEW_SHORTCUTS`
- `src/renderer/src/components/layout/OverflowMenu.tsx` (lines 19-39) -- duplicates `VIEW_ICONS`, `VIEW_LABELS`
- `src/renderer/src/App.tsx` (lines 37-46) -- `VIEW_TITLES` (identical values to `VIEW_LABELS`)

Adding or renaming a view requires updating **all four files** in lockstep. The CLAUDE.md gotchas already warn: _"Missing entries cause runtime crashes (undefined component render), not build errors."_ This is a structural defect, not a documentation problem.

**Fix:** Extract a single `src/renderer/src/lib/view-registry.ts` exporting `VIEW_LABELS`, `VIEW_ICONS`, `VIEW_SHORTCUTS`, and `VIEW_SHORTCUT_MAP`. All consumers import from there. The `View` type should remain in `panelLayout.ts` (or move to `shared/`), but the metadata maps must live in one place.

### 2.2 Two Competing Tooltip Implementations

**Files:**

- `src/renderer/src/components/ui/Tooltip.tsx` -- CSS pseudo-element (`data-tooltip` attribute, styled in `design-system.css` lines 452-502)
- `src/renderer/src/components/neon/NeonTooltip.tsx` -- React portal with position calculation, styled in `neon-shell.css` lines 218-252

Both are in active use. `NeonTooltip` is used by `SidebarItem.tsx`; `Tooltip` from `ui/` may be used elsewhere. They have different APIs (`content` prop vs `label` + `shortcut` props), different rendering strategies (CSS vs portal), and different visual styles. This is a maintenance hazard -- developers will pick whichever they encounter first.

**Fix:** Consolidate to one tooltip component. `NeonTooltip` is the more capable implementation (portaled, keyboard accessible, supports shortcuts). Migrate `Tooltip` callers to `NeonTooltip` and delete `ui/Tooltip.tsx`.

### 2.3 Two Competing Badge Implementations

**Files:**

- `src/renderer/src/components/ui/Badge.tsx` -- uses `bde-badge--{variant}` CSS classes with `--bde-*` variables
- `src/renderer/src/components/neon/NeonBadge.tsx` -- uses inline styles with `neonVar()` and `tokens.*`

Same problem as tooltips: two components, two visual languages, no guidance on which to use.

**Fix:** Keep both if they serve genuinely different contexts (Badge for neutral/status, NeonBadge for accent-glowing dashboard use), but document when to use each. Better: merge into one Badge component with a `glow` or `neon` prop.

---

## 3. Significant Issues (Should Fix)

### 3.1 DashboardView is a 553-Line Monolith with Massive Inline Styles

**File:** `src/renderer/src/views/DashboardView.tsx`

This file contains:

- The entire dashboard layout (lines 211-451) as one giant JSX tree
- `SuccessRing` SVG component (lines 455-522)
- Three utility functions (`formatDuration`, `truncate`, `timeAgo`) at lines 525-552
- ~40 inline `style={{}}` objects with hardcoded values like `rgba(255, 255, 255, 0.3)` (lines 346, 368, 376, 420-425, 438-443, 487, 516)

The CLAUDE.md explicitly states: _"Do NOT use inline `tokens.*` styles for neon views -- use CSS classes."_ This view violates that rule pervasively.

**Fix:** Extract `SuccessRing` into `components/dashboard/SuccessRing.tsx`. Move utility functions to `lib/format.ts` (where `timeAgo` already exists -- line 9 of `CommandPalette.tsx` imports from there). Create a `dashboard-neon.css` file for the grid layout and card containers, following the pattern of `sprint-pipeline-neon.css`.

### 3.2 Neon Primitives Use Inline Styles Instead of CSS Classes

Every neon component builds its visual appearance via inline `style={{}}` objects referencing `tokens.*` and `neonVar()`. For example:

- `NeonCard.tsx` (lines 24-39) -- 15 inline style properties
- `StatCounter.tsx` (lines 47-55) -- 8 inline style properties on root, plus nested style objects
- `GlassPanel.tsx` (lines 31-39) -- 8 inline style properties
- `CircuitPipeline.tsx` (lines 65-86) -- ~20 inline style properties per node
- `ActivityFeed.tsx` (lines 45-88) -- inline styles on every element

This approach:

1. Defeats CSS specificity overrides (neon views can't customize NeonCard's border-radius via scoped CSS)
2. Prevents pseudo-class styling (`:hover`, `:focus-visible` can't be applied to inline styles)
3. Makes theme switching harder (inline `tokens.neon.text` resolves to a CSS var string, but layout values like `tokens.radius.xl = '12px'` are hardcoded)

**Fix:** Create a `neon-components.css` file with `.neon-card`, `.neon-card__header`, `.stat-counter`, `.glass-panel`, etc. Move static visual properties to CSS classes; keep only dynamic values (like accent-dependent colors) as CSS custom properties set via `style={{ '--card-accent': neonVar(accent, 'color') }}`.

### 3.3 Dual Token System: `tokens.ts` vs CSS Custom Properties

**Files:**

- `src/renderer/src/design-system/tokens.ts` (95 lines)
- `src/renderer/src/assets/base.css` (`:root` block, lines 10-256)
- `src/renderer/src/assets/neon.css` (`:root` block, lines 7-73)

`tokens.ts` is essentially a thin JS wrapper around CSS variables: `tokens.color.bg` = `'var(--bde-bg)'`, `tokens.neon.cyan` = `'var(--neon-cyan)'`. The spacing (`tokens.space.3 = '12px'`) and radius (`tokens.radius.xl = '12px'`) values are hardcoded strings, NOT CSS variable references.

This creates an inconsistency: color tokens are theme-aware (they resolve to CSS vars), but spacing and radius tokens are static strings. If someone added a compact layout mode or a large-text accessibility mode, the spacing tokens in `tokens.ts` would not respond.

Meanwhile, `base.css` defines `--bde-space-3: 12px`, `--bde-radius-xl: 12px` -- the same values exist as CSS custom properties but `tokens.ts` doesn't reference them.

**Fix:** Make spacing/radius tokens reference CSS variables too: `space: { 3: 'var(--bde-space-3)' }`. This unifies the token boundary and makes the entire system responsive to CSS overrides.

### 3.4 App.tsx Bundles Too Many Responsibilities

**File:** `src/renderer/src/App.tsx` (312 lines)

`App.tsx` handles:

1. Onboarding gate (lines 268-269)
2. Keyboard shortcut registration (lines 175-266)
3. View title management (lines 155-159)
4. Custom event navigation (lines 161-173)
5. Layout restoration (lines 144-150)
6. Store initialization (`fetchLocalAgents`, `restorePendingReview`)
7. Rendering the shell (header, sidebar, panels, command palette, shortcuts overlay, toasts)
8. Contains `ShortcutsOverlay` component inline (lines 64-122)

**Fix:** Extract `ShortcutsOverlay` to `components/layout/ShortcutsOverlay.tsx`. Extract keyboard handling to a `useAppKeyboard()` hook. Extract store initialization to a `useAppInit()` hook. This would bring `App.tsx` down to ~60 lines of pure layout composition.

### 3.5 SidebarItem Context Menu Uses Fully Inline Styles

**File:** `src/renderer/src/components/layout/SidebarItem.tsx` (lines 88-140)

The context menu is built with 100% inline styles and `onMouseEnter`/`onMouseLeave` event handlers for hover effects. This:

- Cannot use CSS pseudo-classes (`:hover`)
- Has hardcoded `rgba()` values (lines 95-96, 124-127, 130-131, 134-135)
- Does not use any design system tokens or CSS classes

**Fix:** Create a `.sidebar-context-menu` class in `neon-shell.css` with proper `:hover` pseudo-class styling. Replace inline styles with class-based approach.

### 3.6 Hardcoded `rgba()` in Neon Views Violates CSS Theming Rule

The CLAUDE.md states: _"Never use hardcoded `rgba()` for overlays or `box-shadow`."_

Violations found:

- `DashboardView.tsx` lines 346, 368, 376, 420-425, 438, 443, 487, 516: hardcoded `rgba(255, 255, 255, 0.3)`, `rgba(255, 255, 255, 0.4)`, etc.
- `SidebarItem.tsx` lines 95, 124, 130, 134: hardcoded `rgba(255, 255, 255, 0.6)`, `rgba(10, 0, 21, 0.9)`
- `OverflowMenu.tsx` lines 120-122, 159: hardcoded `rgba(255, 255, 255, 0.4)`, `rgba(191, 90, 242, 0.2)`
- `neon-shell.css` lines 86, 99-100, 106, 128, 189, 297-298: hardcoded `rgba()` values

These will not adapt to light theme correctly. The neon system does have light-theme overrides in `neon.css`, but they only cover the `--neon-*` CSS variables, not inline hardcoded rgba values.

---

## 4. Minor Issues (Nice to Fix)

### 4.1 `ui/Card` and `neon/NeonCard` Overlap

`ui/Card.tsx` renders a `.bde-card` with `--bde-*` tokens. `neon/NeonCard.tsx` renders a `.neon-card` with glass morphism, accent borders, and glow effects. They serve different visual tiers but the naming overlap can confuse contributors about which to use.

### 4.2 `ui/Panel` is a Layout Wrapper, `panels/PanelLeaf` is the Panel System

The name collision between `ui/Panel.tsx` (a simple header+body wrapper using `.bde-panel` CSS) and `panels/PanelLeaf.tsx` (the actual panel layout system) is confusing. They are unrelated components.

### 4.3 `base.css` Has Two Overlapping Variable Namespaces

`base.css` defines both `--bde-*` variables (lines 34-118) and "Visual Identity v2" variables (lines 120-256) with different names for similar concepts: `--bde-bg` vs `--bg-base`, `--bde-text` vs `--text-primary`, `--bde-border` vs `--border`. Legacy aliases at lines 14-32 bridge old names to `--bde-*`, but the v2 names (`--bg-void`, `--gradient-aurora`, etc.) are a third namespace.

### 4.4 `design-system.css` Has Both Component Styles and Visual Identity Utilities

This file contains BEM component styles (`.bde-btn`, `.bde-card`, etc., lines 1-574) AND v2 visual identity utilities (`.glass`, `.elevation-*`, `.glow-*`, `.btn-primary`, `.btn-glass`, lines 575-805). The v2 classes overlap with BEM variants -- e.g., `Button.tsx` applies both `bde-btn--primary` and `btn-primary` (line 42-43), creating double styling.

### 4.5 `OverflowMenu.tsx` Mixes `GlassPanel` neon Component with Inline Styles

Line 115 uses `<GlassPanel accent="purple">` but then adds inline styles at lines 118-123 and 155-163 with hardcoded values. The GlassPanel's glass effect is applied, but the internal layout is all inline.

### 4.6 `ParticleField` Uses `willChange: 'transform'` on 18 Elements

**File:** `src/renderer/src/components/neon/ParticleField.tsx` (line 56)

Each of the 18 particles gets `willChange: 'transform'`, promoting all to compositor layers. This is 18 GPU layers for a decorative effect. Consider using a single canvas or reducing density.

### 4.7 PanelLeaf Imports AgentsView Eagerly While All Others Are Lazy

**File:** `src/renderer/src/components/panels/PanelLeaf.tsx` (line 6)

`AgentsView` is imported directly (`import { AgentsView } from '../../views/AgentsView'`) while all other views use `React.lazy()`. This means the Agents bundle is always loaded regardless of which view is active.

---

## 5. Design System Inventory

| Component                    | System         | Token Source              | Styling Method                                                                             |
| ---------------------------- | -------------- | ------------------------- | ------------------------------------------------------------------------------------------ |
| **ui/Button**                | ui/ (BEM)      | CSS vars (`--bde-*`)      | CSS classes (`.bde-btn--*`) + `.btn-primary` / `.btn-glass` overlay from design-system.css |
| **ui/Badge**                 | ui/ (BEM)      | CSS vars (`--bde-*`)      | CSS classes (`.bde-badge--*`)                                                              |
| **ui/Card**                  | ui/ (BEM)      | CSS vars (`--bde-*`)      | CSS classes (`.bde-card--*`)                                                               |
| **ui/Input**                 | ui/ (BEM)      | CSS vars (`--bde-*`)      | CSS classes (`.bde-input`)                                                                 |
| **ui/Textarea**              | ui/ (BEM)      | CSS vars (`--bde-*`)      | CSS classes (`.bde-textarea`)                                                              |
| **ui/Spinner**               | ui/ (BEM)      | CSS vars (`--bde-*`)      | CSS classes (`.bde-spinner--*`)                                                            |
| **ui/Kbd**                   | ui/ (BEM)      | CSS vars (`--bde-*`)      | CSS class (`.bde-kbd`)                                                                     |
| **ui/Divider**               | ui/ (BEM)      | CSS vars (`--bde-*`)      | CSS classes (`.bde-divider--*`)                                                            |
| **ui/EmptyState**            | ui/ (BEM)      | CSS vars (`--bde-*`)      | CSS classes (`.bde-empty`)                                                                 |
| **ui/ErrorBanner**           | ui/ (BEM)      | CSS vars (`--bde-*`)      | CSS class (`.bde-error-banner`)                                                            |
| **ui/ErrorBoundary**         | Hybrid         | `tokens.ts` (inline)      | Inline styles with `tokens.color.*`, `tokens.font.*`, `tokens.size.*`, `tokens.space.*`    |
| **ui/Tooltip**               | ui/ (BEM)      | CSS vars (`--bde-*`)      | CSS pseudo-element (`.bde-tooltip::after`)                                                 |
| **ui/Panel**                 | ui/ (BEM)      | CSS vars (`--bde-*`)      | CSS classes (`.bde-panel`)                                                                 |
| **ui/ConfirmModal**          | Hybrid         | CSS vars (`--bde-*`)      | CSS classes (`.confirm-modal`) + `.glass-modal` from v2 system                             |
| **ui/ElapsedTime**           | None           | N/A                       | Renderless (text only)                                                                     |
| **neon/NeonCard**            | neon/          | `tokens.ts` + `neonVar()` | Inline styles with CSS custom property passthrough                                         |
| **neon/NeonBadge**           | neon/          | `tokens.ts` + `neonVar()` | Inline styles                                                                              |
| **neon/GlassPanel**          | neon/          | `tokens.ts` + `neonVar()` | Inline styles                                                                              |
| **neon/StatCounter**         | neon/          | `tokens.ts` + `neonVar()` | Inline styles                                                                              |
| **neon/ActivityFeed**        | neon/          | `tokens.ts` + `neonVar()` | Inline styles                                                                              |
| **neon/NeonProgress**        | neon/          | `tokens.ts` + `neonVar()` | Inline styles                                                                              |
| **neon/PipelineFlow**        | neon/          | `tokens.ts` + `neonVar()` | Inline styles                                                                              |
| **neon/MiniChart**           | neon/          | `tokens.ts` + `neonVar()` | Inline styles + SVG                                                                        |
| **neon/CircuitPipeline**     | neon/          | `tokens.ts` + `neonVar()` | Inline styles                                                                              |
| **neon/StatusBar**           | neon/          | `tokens.ts` + `neonVar()` | Inline styles                                                                              |
| **neon/ScanlineOverlay**     | neon/ (CSS)    | CSS vars (`--neon-*`)     | Inline styles + CSS class for opacity                                                      |
| **neon/ParticleField**       | neon/          | `neonVar()`               | Inline styles                                                                              |
| **neon/NeonTooltip**         | neon/ (CSS)    | N/A                       | CSS classes in `neon-shell.css` (`.neon-tooltip`)                                          |
| **layout/UnifiedHeader**     | neon/ (CSS)    | N/A                       | CSS classes in `neon-shell.css` (`.unified-header`)                                        |
| **layout/NeonSidebar**       | neon/ (CSS)    | N/A                       | CSS classes in `neon-shell.css` (`.neon-sidebar`, `.sidebar-item`)                         |
| **layout/SidebarItem**       | Hybrid         | neon/ (CSS) + inline      | CSS classes (`.sidebar-item`) + inline context menu                                        |
| **layout/HeaderTab**         | neon/ (CSS)    | N/A                       | CSS classes in `neon-shell.css` (`.header-tab`)                                            |
| **layout/CommandPalette**    | Hybrid         | N/A                       | CSS classes (`.command-palette__*`) + `.glass-modal`                                       |
| **layout/ToastContainer**    | ui/ (CSS)      | N/A                       | CSS classes (`.toast-container`, `.toast--*`)                                              |
| **layout/NotificationBell**  | Hybrid         | N/A                       | CSS classes (`.notification-bell__*`) + `.glass-modal`                                     |
| **layout/OverflowMenu**      | Hybrid         | neon/ `GlassPanel`        | CSS classes (`.overflow-menu__*`) + inline styles                                          |
| **panels/PanelRenderer**     | External lib   | N/A                       | `react-resizable-panels` `Group`/`Panel`                                                   |
| **panels/PanelLeaf**         | Hybrid         | `tokens.ts` (inline)      | Inline styles + CSS class (`.panel-label-slim` from neon-shell)                            |
| **panels/PanelDropOverlay**  | ui/ (CSS vars) | `--bde-info-dim`          | Inline styles with one CSS var                                                             |
| **panels/PanelResizeHandle** | Hybrid         | `tokens.ts`               | `react-resizable-panels` `Separator` + inline transition token                             |
| **DashboardView**            | neon/          | `tokens.ts` + `neonVar()` | ~95% inline styles, no CSS file                                                            |
| **SettingsView**             | ui/ (CSS)      | N/A                       | CSS classes (`.settings-view`, `.settings-tab`)                                            |

### Summary Counts

- **Pure ui/ (BEM + CSS vars):** 13 components
- **Pure neon/ (inline + tokens.ts):** 11 components
- **Pure neon/ (CSS classes):** 4 components (shell layout)
- **Hybrid (mixing systems):** 8 components
- **No styling:** 1 component (ElapsedTime)

### Panel Layout Architecture Assessment

The `PanelNode` tree in `panelLayout.ts` is well-designed:

- Clean ADT: `PanelLeafNode | PanelSplitNode` discriminated union
- Pure mutation functions (`splitNode`, `closeTab`, `addTab`, `moveTab`) that return new trees without mutating input
- Proper tree collapse on last-tab close (split node replaced by surviving child)
- Layout persistence with validation and migration
- 5-zone drop targeting (`getDropZone` in `PanelDropOverlay.tsx`) using percentage-based hit testing

The recursive `PanelRenderer` correctly maps the tree to `react-resizable-panels` `Group`/`Panel`/`Separator` components. This is one of the best-architected modules in the codebase.
