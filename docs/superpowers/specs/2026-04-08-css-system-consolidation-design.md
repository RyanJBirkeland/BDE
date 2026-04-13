# CSS System Consolidation — Design Spec

**Date:** 2026-04-08  
**Status:** Ready for planning  
**Scope:** BDE renderer CSS system — token unification, theme pruning, neon aesthetic removal

---

## Problem

The CSS system has accumulated two parallel token namespaces (`--bde-*` and `--neon-*`), five theme
definitions (root default, theme-light, theme-warm, theme-pro-dark, theme-pro-light), and neon-specific
effects (glows, scanlines, particles, glass blur) that are either zeroed out in the pro themes or
semantically misaligned. This causes cognitive load when reading and writing CSS, inconsistent
component styling, and hard-to-debug token resolution chains.

**Goal:** Single `--bde-*` token namespace, two themes only (pro-dark and pro-light), no neon
effects anywhere in the codebase.

---

## Approach: Two Phases

Phase 1 is mechanical and verifiable by grep (zero `--neon-*` references remain).  
Phase 2 is structural and warrants separate review.

---

## Phase 1 — Token Consolidation + Theme Pruning

### 1.1 Token Mapping

All `--neon-*` variables are replaced with `--bde-*` equivalents. After Phase 1, zero `--neon-*`
references remain anywhere in the codebase.

**Atmosphere / surfaces (1:1 mapping):**

| Old (`--neon-*`)        | New (`--bde-*`)      |
| ----------------------- | -------------------- |
| `--neon-bg`             | `--bde-bg`           |
| `--neon-text`           | `--bde-text`         |
| `--neon-text-muted`     | `--bde-text-muted`   |
| `--neon-text-dim`       | `--bde-text-dim`     |
| `--neon-surface-dim`    | `--bde-border`       |
| `--neon-surface-subtle` | `--bde-surface`      |
| `--neon-surface-deep`   | `--bde-surface-high` |
| `--neon-surface-base`   | `--bde-bg`           |
| `--neon-surface-mid`    | `--bde-surface`      |

**Interactive accent (primary blue):**

| Old (`--neon-*`)      | New (`--bde-*`)                    |
| --------------------- | ---------------------------------- |
| `--neon-cyan`         | `--bde-accent`                     |
| `--neon-cyan-surface` | `--bde-accent-surface` ← new token |
| `--neon-cyan-border`  | `--bde-accent-border` ← new token  |
| `--neon-cyan-glow`    | deleted — no replacement           |

**Status colors (new tier — semantic names):**

| Old (`--neon-*`)              | New (`--bde-*`)                                                   | Value (dark) | Value (light) |
| ----------------------------- | ----------------------------------------------------------------- | ------------ | ------------- |
| `--neon-purple`               | `--bde-status-active`                                             | `#7c6af7`    | `#6356e5`     |
| `--neon-blue`                 | `--bde-status-review`                                             | `#4a88c7`    | `#2675bf`     |
| `--neon-orange`               | `--bde-status-blocked` / `--bde-warning`                          | `#cc8833`    | `#b87320`     |
| `--neon-pink`                 | `--bde-status-done`                                               | `#4caf82`    | `#3a9b6f`     |
| `--neon-red`                  | `--bde-danger`                                                    | `#db5c5c`    | `#c94040`     |
| `--neon-*-glow` (all)         | deleted                                                           | —            | —             |
| `--neon-*-surface` (non-cyan) | `--bde-warning-surface`, `--bde-danger-surface` etc. ← new tokens | faint tint   | faint tint    |
| `--neon-*-border` (non-cyan)  | `--bde-warning-border`, `--bde-danger-border` etc. ← new tokens   | tinted       | tinted        |

Note: `--neon-pink` was used for "done" status — semantically wrong (pink ≠ done). Phase 1
corrects this to green (`--bde-status-done`).

Note: `--neon-orange` overlaps with the existing `--bde-warning`. Consolidate to `--bde-warning`
and add `--bde-status-blocked` that points to the same value.

**Entirely deleted — no replacements:**

```
--neon-glass-blur
--neon-glass-edge
--neon-glass-shadow
--neon-scanline-opacity
--neon-scanline-speed
--neon-particle-count
--neon-particle-size
--gradient-aurora
--gradient-electric
--gradient-solar
--gradient-ember
--gradient-frost
--gradient-midnight
--gradient-shimmer
--glass-blur-sm/md/lg/xl
--glass-tint-dark/mid/light/ultra
--glass-saturate
```

### 1.2 New Tokens to Add to Base

Add to `html.theme-pro-dark` in `base.css`:

```css
/* Interactive accent surfaces (accent = #4a88c7) */
--bde-accent-surface: rgba(74, 136, 199, 0.1); /* #4a88c71a */
--bde-accent-border: rgba(74, 136, 199, 0.28); /* #4a88c748 */

/* Semantic surface tints */
--bde-warning-surface: rgba(204, 136, 51, 0.1); /* #cc88331a */
--bde-warning-border: rgba(204, 136, 51, 0.3); /* #cc88334d */
--bde-danger-surface: rgba(219, 92, 92, 0.1); /* #db5c5c1a */
--bde-danger-border: rgba(219, 92, 92, 0.3); /* #db5c5c4d */

/* Task status colors */
--bde-status-active: #7c6af7; /* blue-purple */
--bde-status-review: var(--bde-accent);
--bde-status-blocked: var(--bde-warning);
--bde-status-done: #4caf82; /* professional green */
--bde-status-queued: var(--bde-accent);
```

Add to `html.theme-pro-light` in `base.css`:

```css
/* Interactive accent surfaces (accent = #2675bf) */
--bde-accent-surface: rgba(38, 117, 191, 0.08); /* #2675bf14 */
--bde-accent-border: rgba(38, 117, 191, 0.25); /* #2675bf40 */

/* Semantic surface tints */
--bde-warning-surface: rgba(184, 115, 32, 0.08); /* #b8732014 */
--bde-warning-border: rgba(184, 115, 32, 0.28); /* #b8732047 */
--bde-danger-surface: rgba(201, 64, 64, 0.08); /* #c9404014 */
--bde-danger-border: rgba(201, 64, 64, 0.28); /* #c9404047 */

/* Task status colors */
--bde-status-active: #6356e5;
--bde-status-review: var(--bde-accent);
--bde-status-blocked: var(--bde-warning);
--bde-status-done: #3a9b6f;
--bde-status-queued: var(--bde-accent);
```

### 1.3 Theme Pruning

**Remove from `base.css`:**

- `:root` color variable definitions (old default dark theme)
- `html.theme-light` block (old light theme)
- `html.theme-warm` block (warm theme)

**Keep in `base.css`:**

- `:root` structural variables only (spacing, radii, fonts, transitions — no colors)
- `html.theme-pro-dark` — becomes the primary dark definition
- `html.theme-pro-light` — becomes the primary light definition

**Remove `neon.css` entirely.** Its content is either already captured in `base.css` pro-theme
blocks or deleted (glow/effect variables). Do not replace with another file — the pro-theme
color definitions live in `base.css` alongside structure.

**Update `src/renderer/src/stores/theme.ts`:**

- Remove `'warm'` option
- Valid values: `'dark'` (→ applies `theme-pro-dark`), `'light'` (→ applies `theme-pro-light`),
  `'system'` (→ resolves to one of the above via `prefers-color-scheme`)
- Add localStorage migration: if stored value is `'warm'` → rewrite to `'dark'`
- Remove the legacy `pro-dark` / `pro-light` migration (it ran at least once already)

**Update Settings → Appearance tab:** Remove warm theme option from the theme selector UI.

### 1.4 CSS File Consolidation

Several `*-neon.css` files exist alongside non-neon counterparts. Where both exist, merge
non-neon into neon (neon has the real styles), then rename dropping the `-neon` suffix.

**File renames:**

| Old name                   | New name                 | Notes                                                   |
| -------------------------- | ------------------------ | ------------------------------------------------------- |
| `neon.css`                 | deleted                  | Content absorbed into base.css or deleted               |
| `neon-primitives.css`      | `primitives.css`         |                                                         |
| `neon-shell.css`           | `shell.css`              |                                                         |
| `sprint-pipeline-neon.css` | `sprint-pipeline.css`    |                                                         |
| `agents-neon.css`          | `agents.css`             | Merge legacy `agents.css` (83 lines) into this first    |
| `task-workbench-neon.css`  | `task-workbench.css`     |                                                         |
| `source-control-neon.css`  | `source-control.css`     |                                                         |
| `code-review-neon.css`     | `code-review.css`        |                                                         |
| `dashboard-neon.css`       | `dashboard.css`          |                                                         |
| `settings-v2-neon.css`     | `settings.css`           | Merge legacy `settings.css` (215 lines) into this first |
| `planner-neon.css`         | `planner.css`            |                                                         |
| `ide-neon.css`             | `ide.css`                | Merge legacy `ide.css` (395 lines) into this first      |
| `agent-launchpad-neon.css` | `agent-launchpad.css`    |                                                         |
| `onboarding-neon.css`      | `onboarding.css`         |                                                         |
| `diff-neon.css`            | `diff.css`               | Merge legacy `diff.css` (514 lines) into this first     |
| `sprint-neon.css`          | merged into `sprint.css` | Sprint-neon is 69 lines — absorb                        |
| `sankey-pipeline-neon.css` | `sankey-pipeline.css`    |                                                         |

All import statements in `main.css` (and any lazy-load points) updated to match new names.

### 1.5 Token Reference Updates

Every `--neon-*` reference in every `.css`, `.tsx`, and `.ts` file is updated to its `--bde-*`
equivalent per the mapping table in §1.1. This includes:

- All CSS files (inline `var(--neon-*)`)
- `src/renderer/src/design-system/tokens.ts` — JS token object updated to match
- Any component files using tokens directly via `style={{ color: tokens.neon.cyan }}` etc.

After Phase 1: `grep -r '\-\-neon-' src/` returns zero results. This is the verification gate.

---

## Phase 2 — Neon Component Removal + CSS Effect Strip

### 2.1 React Components

Location: `src/renderer/src/components/neon/`

**Delete entirely:**

- `ParticleField.tsx` — remove all usages, delete file
- `ScanlineOverlay.tsx` — remove all usages, delete file

**Gut to structural shells — keep existing export names, only clean internals:**

- `NeonCard` — remove glow/glass styles, becomes a simple bordered container. Export name unchanged.
- `GlassPanel` — remove `backdrop-filter`, becomes a plain surfaced panel. Export name unchanged.
- `NeonBadge` — solid background only, no glow. Export name unchanged.
- `NeonTooltip` — remove glow shadow. Export name unchanged.
- `NeonProgress` — remove glow. Export name unchanged.
- `ActivityFeed`, `StatCounter`, `MiniChart`, `StatusBar`, `PipelineFlow` — strip any inline glow styles. Export names unchanged.

**No import sites are touched in Phase 2.** Export names stay as-is (`NeonCard`, `GlassPanel`,
etc.) — they are historical names that no longer imply a visual style. A follow-on cleanup PR can
rename the exports and update import sites, but that is explicitly out of scope here.

### 2.2 CSS Effects to Strip

From every CSS file, remove all instances of:

```css
/* Remove: glow box-shadows */
box-shadow: 0 0 Xpx var(--neon-*);
box-shadow: 0 0 Xpx var(--bde-*-glow);  /* if any survived Phase 1 */

/* Remove: text glow */
text-shadow: 0 0 Xpx ...;

/* Remove: glass blur */
backdrop-filter: blur(...);
-webkit-backdrop-filter: blur(...);

/* Remove: scanline pseudo-elements */
.scanline-overlay, ::before/::after using scanline patterns

/* Remove: particle containers */
.particle-field, .particle-*, canvas.particles
```

**Replace hover effects:** Where neon files had `box-shadow: 0 0 12px var(--neon-cyan)` on hover,
replace with a solid `border-color` or `background` change using `--bde-*` tokens. No glows.

### 2.3 `design-system.css` Glass Overrides

The `html.theme-pro-dark` and `html.theme-pro-light` blocks in `design-system.css` currently
override `.glass-modal` and `.elevation-*` classes to remove glass. After Phase 2 these overrides
become the only definitions — the base `.glass-modal` rule (with `backdrop-filter`) can be removed
entirely since only pro themes exist.

### 2.4 Verification

After Phase 2:

- `grep -r 'backdrop-filter' src/` — zero results (or only intentional non-blur uses)
- `grep -r 'text-shadow' src/` — zero results
- `grep -r 'ParticleField\|ScanlineOverlay' src/` — zero results
- `grep -r 'box-shadow.*0 0' src/` — zero results (glow-style shadows gone; elevation shadows like `0 4px 16px` are fine)
- All existing tests pass
- `npm run typecheck` — zero errors
- `npm run lint` — zero errors

### Phase Ownership of `tokens.ts`

`src/renderer/src/design-system/tokens.ts` (JS token object) is updated in **Phase 1** alongside
the CSS token rename — `tokens.neon.*` → `tokens.bde.*`. All component files using
`tokens.neon.cyan` etc. are updated in the same Phase 1 pass. Phase 2 does not touch `tokens.ts`.

---

## Out of Scope

- Changing component layouts or spacing
- Updating the visual design of individual components beyond effect removal
- Any change to the `tokens.ts` structure other than `neon.*` → `bde.*` renaming
- `sprint.css`, `diff.css`, `terminal.css`, `cost.css`, `memory.css`, `toasts.css`,
  `command-palette.css`, `tearoff-shell.css` — these use only `--bde-*` already, no changes needed
  beyond any import path updates

---

## Risk Notes

- `sprint-pipeline-neon.css` is 2,575 lines — largest file in the system. Token replacement
  there is the most error-prone step. Do it last within Phase 1 and verify carefully.
- `tokens.ts` is imported by many component files using `tokens.neon.*`. All those call sites
  need updating in **Phase 1** alongside the CSS token rename. A single find-replace pass on
  `tokens.neon.` → `tokens.bde.` handles this mechanically, but verify the object shape change
  doesn't break TypeScript consumers. Also grep TSX files for inline glow shadows
  (`boxShadow.*0 0`) — these won't be caught by the CSS verification grep.
- The `--neon-pink` → `--bde-status-done` (green) color change is intentional but visible —
  "done" task status dots and badges will change from pink to green. This is a correct semantic fix.
