# Team 0 — Design System Foundation Audit

## Executive Summary

BDE has a solid dual-layer design system (CSS variables in `base.css` + TypeScript tokens in `tokens.ts`) with a partially-landed "Visual Identity v2" that introduces feast-site-inspired glass, glow, and gradient tokens. However, the v1 and v2 systems coexist with significant overlap and inconsistency — the original `--bde-*` tokens still drive all 15 UI primitives while the newer v2 tokens (`--bg-*`, `--border`, `--text-*`, `--accent-*`) are only used by a handful of glass/elevation utility classes. The biggest gaps vs. the feast-site target are: border radius values (4-12px vs. feast-site's 14-32px), background layering depth (#0A0A0A vs. #050505), text color warmth (#E8E8E8 vs. #F5F5F7), missing ambient glow system, and no signature CTA gradient on the primary button in the CSS-class-based primitives.

## UX Designer Findings

### Color Token Gap Analysis

**Backgrounds — need to go deeper and bluer:**

| Token                | Current BDE     | feast-site Target      | Delta                                                                            |
| -------------------- | --------------- | ---------------------- | -------------------------------------------------------------------------------- |
| `--bde-bg`           | `#0A0A0A`       | `#050505`              | Need near-true-black. v2 `--bg-void: #050507` is close but unused by body.       |
| `--bde-surface`      | `#141414`       | `#111113`              | Shift to cooler tone with blue undertone. v2 `--bg-surface: #111118` is correct. |
| `--bde-surface-high` | `#1E1E1E`       | `#1A1A1D`              | Slightly darker, add cool undertone. v2 `--bg-card: #16161F` is close.           |
| Body `background`    | Uses `--bde-bg` | Should use `--bg-void` | Body CSS in base.css references old token.                                       |

**Text — need Apple-style off-white:**

| Token              | Current BDE | feast-site Target | Action                                                                                               |
| ------------------ | ----------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| `--bde-text`       | `#E8E8E8`   | `#F5F5F7`         | Bump brightness, slight warm shift. v2 `--text-primary: #F5F5F7` exists but is unused by primitives. |
| `--bde-text-muted` | `#888888`   | `#98989F`         | Slightly brighter, cooler. v2 `--text-secondary: #98989F` exists.                                    |
| `--bde-text-dim`   | `#555555`   | `#5C5C63`         | Slight blue shift. v2 `--text-muted: #5C5C63` exists.                                                |
| (missing)          | n/a         | `#3A3A42`         | Need ghost/placeholder text. v2 `--text-ghost: #3A3A42` exists.                                      |

**Borders — need cooler, subtler:**

| Token                | Current BDE | feast-site Target                    | Action                                                                                        |
| -------------------- | ----------- | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `--bde-border`       | `#333333`   | `rgba(255,255,255,0.04)` / `#1E1E2A` | feast-site uses ultra-low-opacity white borders. v2 `--border: #1E1E2A` is correct direction. |
| `--bde-border-hover` | `#444444`   | `#2A2A3A`                            | v2 `--border-light: #2A2A3A` exists.                                                          |
| (missing)            | n/a         | `rgba(255,255,255,0.04)`             | Need `--border-subtle` for inner-element borders (feast-site `border-white/[0.04]`).          |

**Accent — mostly aligned, expand glow range:**

| Token          | Current   | Target                | Note                                                                           |
| -------------- | --------- | --------------------- | ------------------------------------------------------------------------------ |
| `--bde-accent` | `#00D37F` | `#00D37F`             | Exact match.                                                                   |
| (missing)      | n/a       | `#00A863`             | Need darker accent for gradient endpoint. v2 `--accent-dim: #00A863` exists.   |
| (missing)      | n/a       | `rgba(0,211,127,0.3)` | Need CTA glow shadow token. v2 `--accent-glow: rgba(0,211,127,0.25)` is close. |

### Border Radius Overhaul

This is the single most visually impactful change. feast-site uses aggressively rounded corners that give the premium consumer feel. Current BDE values are typical dev-tool conservative.

| Token                    | Current  | feast-site Target | Usage                                |
| ------------------------ | -------- | ----------------- | ------------------------------------ |
| `--bde-radius-sm`        | `4px`    | `8px`             | Badges, small chips, inline elements |
| `--bde-radius-md`        | `6px`    | `12px`            | Buttons, inputs, textareas           |
| `--bde-radius-lg`        | `8px`    | `16px`            | Cards, panels, dropdowns             |
| `--bde-radius-xl`        | `12px`   | `20px`            | Modals, large containers             |
| (new) `--bde-radius-2xl` | n/a      | `24px`            | Hero cards, feature panels           |
| (new) `--bde-radius-3xl` | n/a      | `32px`            | Large containers, section wrappers   |
| `--bde-radius-full`      | `9999px` | `9999px`          | No change (pills)                    |

**Impact analysis:** 87 CSS variable references + 30+ hardcoded `border-radius` values in CSS files + ~50 inline `borderRadius` references in TSX files all need updating. The token-based approach means changing the 5 CSS variables propagates to all token users automatically — but hardcoded values in `.css` and inline styles will need manual migration.

**Hardcoded radius hotspots (non-token values in CSS):**

- `settings.css`: `10px` (1 occurrence)
- `cost.css`: `10px`, `4px` (3 occurrences)
- `sprint.css`: `12px`, `4px`, `3px`, `8px` (8 occurrences)
- `pr-station.css`: `9999px`, `4px` (2 occurrences)
- `diff.css`: `10px`, `3px`, `2px`, `9999px` (4 occurrences)
- `main.css`: `8px`, `4px`, `2px` (3 occurrences)
- `command-palette.css`: `10px` (1 occurrence)

### Shadow & Glow System

**Current state:** Three flat shadow tiers (`sm`/`md`/`lg`), all pure black `rgba(0,0,0,x)`. No accent-tinted glows, no layered shadows.

**feast-site target:** Layered shadows with accent glow on interactive elements.

**New shadow tokens needed:**

```css
/* Replace existing */
--bde-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2);
--bde-shadow-md: 0 4px 16px rgba(0, 0, 0, 0.4), 0 2px 4px rgba(0, 0, 0, 0.2);
--bde-shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.4), 0 4px 16px rgba(0, 0, 0, 0.2);

/* New accent-glow shadows */
--bde-shadow-glow-sm: 0 0 8px rgba(0, 211, 127, 0.15), 0 0 0 1px rgba(0, 211, 127, 0.2);
--bde-shadow-glow-md: 0 4px 16px rgba(0, 211, 127, 0.2), 0 0 8px rgba(0, 211, 127, 0.15);
--bde-shadow-glow-lg: 0 8px 32px rgba(0, 211, 127, 0.15), 0 4px 16px rgba(0, 0, 0, 0.4);

/* CTA button shadow */
--bde-shadow-cta: 0 4px 16px rgba(0, 211, 127, 0.3);
--bde-shadow-cta-hover: 0 4px 24px rgba(0, 211, 127, 0.4), 0 0 8px rgba(0, 211, 127, 0.3);

/* Elevation shadow (modals, popovers) */
--bde-shadow-elevation:
  0 24px 80px rgba(0, 0, 0, 0.6), 0 8px 24px rgba(0, 0, 0, 0.25),
  0 0 0 0.5px rgba(255, 255, 255, 0.08) inset;
```

**Note:** `design-system.css` already has `.glow-accent-sm` and `.glow-pulse` classes from the v2 work, but they are not wired into any UI primitives (Button, Card, Badge).

### Gradient Definitions

**Current state:** v2 already defines `--gradient-aurora`, `--gradient-electric`, `--gradient-solar`, `--gradient-ember` + surface gradients. These are well-defined but only used by `.btn-primary`, `.text-gradient-aurora`, `.gradient-border`, and `.logotype`.

**Missing feast-site signature gradient:**

```css
/* The exact feast-site CTA gradient */
--gradient-cta: linear-gradient(135deg, #00d37f, #00a863);
```

Currently `--gradient-aurora` (`#00D37F -> #00B4D8`) adds a teal endpoint, which diverges from feast-site's pure green-to-dark-green. Need a dedicated CTA gradient that matches feast-site exactly.

**Missing ambient glow gradient (feast-site's defining characteristic):**

```css
/* Section ambient glow — "lit from within" */
--gradient-ambient: radial-gradient(circle, rgba(0, 211, 127, 0.08) 0%, transparent 70%);
--gradient-ambient-sm: radial-gradient(circle, rgba(0, 211, 127, 0.05) 0%, transparent 50%);
```

The v2 `--gradient-horizon` is a close cousin but uses a linear gradient (160deg) rather than the radial glow that gives feast-site its signature look.

### Animation & Micro-interaction Gaps

**feast-site patterns present in BDE:**

- `active:scale(0.97)` on `.bde-btn` — present
- `filter: brightness(1.1)` on hover — present on `.bde-btn--primary`
- `transition-all` — present via `--bde-transition-base`

**feast-site patterns MISSING from BDE:**

1. **Border brightening on hover** — feast-site cards brighten their border from `white/[0.04]` to `white/[0.08]` on hover. BDE cards change to `--bde-border-hover` (#444) which is too aggressive.
2. **Hover glow on CTA buttons** — feast-site adds expanding glow shadow on hover. `.btn-primary:hover` has this but `.bde-btn--primary:hover` only does `filter: brightness(1.1)`.
3. **Stagger animations for lists** — feast-site staggers card entrance animations. BDE has `bde-slide-up-fade` but no stagger utility.
4. **Smooth scale transitions** — feast-site uses `transition: all 200ms` with `ease-out`. BDE uses `150ms ease` which is slightly snappier — both are valid, but the easing function should be `ease-out` for scale transforms.
5. **Ambient glow pulse** — `.glow-pulse` exists but is not applied to any running/active indicators.
6. **Enter/exit animations** — Only `ConfirmModal` uses framer-motion. Cards, drawers, badges have no entrance animation.

**New keyframes needed:**

```css
@keyframes bde-glow-breathe {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
}

@keyframes bde-stagger-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

## Product Manager Findings

### Design System Adoption Gaps

**Dual-system confusion:** The codebase has two parallel token systems that are both active:

- **v1 (`--bde-*`)**: Powers all 15 UI primitives, used in body styles, referenced by 87+ CSS occurrences. This is the "real" system.
- **v2 (`--bg-*`, `--border`, `--text-*`, `--accent-*`)**: Only used by glass/elevation/glow/gradient utility classes and logotype. Also creates naming collisions — `--border` and `--border-light` are v2 tokens but also legacy aliases in the same `:root` block.

**Impact:** Developers don't know which token to use. v2 values are superior (closer to feast-site) but v1 powers the actual components.

**Inline style epidemic:** 356 `style={` occurrences across 58 component files. Many reference `tokens.radius.*` and `tokens.color.*` from the TypeScript tokens object, which means they get the OLD v1 values, not the CSS variable values. If CSS variables are updated, these inline styles won't change.

Top offenders by inline style count:

- `EventCard.tsx` (33), `TicketEditor.tsx` (29), `WorkbenchForm.tsx` (16), `Onboarding.tsx` (17), `AgentDetail.tsx` (15), `AgentList.tsx` (14), `WorkbenchCopilot.tsx` (13), `ToolCallBlock.tsx` (12), `TaskMonitorPanel.tsx` (12)

**Hardcoded hex colors in components:** 3 instances of `#000` for button text, plus hardcoded rgba values in `InlineDiffDrawer.tsx`. These bypass both token systems.

### Missing Primitives

1. **Toggle/Switch** — Settings sections likely need this; no primitive exists.
2. **Select/Dropdown** — `BranchSelector.tsx` builds its own dropdown from scratch with inline styles.
3. **Tabs** — Panel tab bar is custom (`PanelTabBar.tsx`), Sprint view has custom tabs. No shared Tab primitive.
4. **Avatar/UserIcon** — PR station shows user avatars with ad-hoc styling.
5. **ProgressBar** — Health bar (`HealthBar.tsx`) is custom; cost charts are custom.
6. **Toast** — `toasts.css` exists but there is no `Toast.tsx` in `components/ui/`.
7. **Skeleton loader** — `.bde-skeleton` class exists in CSS but no `Skeleton.tsx` component wrapping it.
8. **Tag/Chip** — Repo filter chips in PR station are ad-hoc. Need a reusable chip primitive.
9. **Glass Card** — `.glass` and `.glass-modal` classes exist but there is no `GlassCard` component that composes Card + glass styling.
10. **Section Label** — feast-site's uppercase green section labels. `.bde-section-title` exists in CSS but has no component wrapper and uses `--bde-text-muted` instead of accent green.

### Consistency Issues

1. **Button identity crisis:** The `Button.tsx` component applies BOTH `.bde-btn--primary` AND `.btn-primary` classes for the primary variant, and BOTH `.bde-btn--ghost` AND `.btn-glass` for ghost. These class pairs have conflicting `border-radius`, `padding`, `font-size`, and `background` values. The v2 classes (`.btn-primary`, `.btn-glass`) win due to CSS specificity/order, making the v1 `.bde-btn--*` classes partially dead code.

2. **Border radius inconsistency across surfaces:**
   - `.bde-card` uses `--bde-radius-lg` (8px)
   - `.bde-input` uses `--bde-radius-md` (6px)
   - `.bde-textarea` uses `--bde-radius-md` (6px)
   - `.confirm-modal` uses `--bde-radius-xl` (12px)
   - `.elevation-3` hardcodes `16px`
   - `.btn-primary` hardcodes `10px`
   - `.btn-glass` hardcodes `8px`
   - `.gradient-border` hardcodes `10px`
   - Sprint card uses `12px` hardcoded

3. **Font family divergence:**
   - v1 tokens: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
   - v2 tokens: `'Inter', 'SF Pro Display', system-ui, sans-serif`
   - Body CSS: uses `--bde-font-ui` (v1 system fonts)
   - feast-site target: Inter
   - Inter IS imported via `@fontsource/inter` but the body doesn't reference it because `--bde-font-ui` uses the system font stack.

4. **Section title color:** `.bde-section-title` and `.bde-panel__title` both use `--bde-text-muted` (gray). feast-site uses accent green (`#00D37F`) for section labels. This is a key brand identity element that is completely absent.

5. **Overlay/backdrop inconsistency:**
   - `.confirm-modal__overlay`: `backdrop-filter: blur(4px)` (hardcoded)
   - `.elevation-3-backdrop`: `blur(8px) saturate(120%)` (hardcoded)
   - `.glass-modal`: `var(--glass-blur-xl)` (tokenized)
   - Sprint drawers: `var(--glass-blur-lg)` / `var(--glass-blur-md)` (tokenized)

## Sr. Frontend Dev Findings

### New Token Spec

**Phase 1: Update existing `--bde-*` CSS variables in `base.css` `:root`**

```css
/* Colors — align with feast-site */
--bde-bg: #050507; /* was #0A0A0A */
--bde-surface: #111118; /* was #141414 */
--bde-surface-high: #16161f; /* was #1E1E1E */
--bde-border: #1e1e2a; /* was #333333 */
--bde-border-hover: #2a2a3a; /* was #444444 */
--bde-text: #f5f5f7; /* was #E8E8E8 */
--bde-text-muted: #98989f; /* was #888888 */
--bde-text-dim: #5c5c63; /* was #555555 */

/* Radii — aggressive rounding */
--bde-radius-sm: 8px; /* was 4px */
--bde-radius-md: 12px; /* was 6px */
--bde-radius-lg: 16px; /* was 8px */
--bde-radius-xl: 20px; /* was 12px */

/* New radius tokens */
--bde-radius-2xl: 24px;
--bde-radius-3xl: 32px;

/* Shadows — layered with accent tint */
--bde-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2);
--bde-shadow-md: 0 4px 16px rgba(0, 0, 0, 0.4), 0 2px 4px rgba(0, 0, 0, 0.2);
--bde-shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.4), 0 4px 16px rgba(0, 0, 0, 0.2);

/* New tokens */
--bde-shadow-glow: 0 4px 16px rgba(0, 211, 127, 0.3);
--bde-shadow-glow-hover: 0 4px 24px rgba(0, 211, 127, 0.4), 0 0 8px rgba(0, 211, 127, 0.3);
--bde-shadow-elevation: 0 24px 80px rgba(0, 0, 0, 0.6), 0 8px 24px rgba(0, 0, 0, 0.25);
--bde-border-subtle: rgba(255, 255, 255, 0.04);
--bde-text-ghost: #3a3a42;
--bde-gradient-cta: linear-gradient(135deg, #00d37f, #00a863);
--bde-gradient-ambient: radial-gradient(circle, rgba(0, 211, 127, 0.08) 0%, transparent 70%);
```

**Phase 1b: Update `tokens.ts` to match:**

```typescript
// tokens.ts — update these values
color: {
  bg: '#050507',
  surface: '#111118',
  surfaceHigh: '#16161F',
  border: '#1E1E2A',
  borderHover: '#2A2A3A',
  text: '#F5F5F7',
  textMuted: '#98989F',
  textDim: '#5C5C63',
  // ... rest unchanged
},
radius: {
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',
  '2xl': '24px',
  '3xl': '32px',
  full: '9999px',
},
```

**Phase 1c: Update `--bde-font-ui` to use Inter:**

```css
--bde-font-ui: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

And in `tokens.ts`:

```typescript
font: {
  ui: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  // ...
}
```

**Phase 2: Deprecate and merge v2 tokens**

Remove duplicate v2 `--bg-*`, `--border`, `--text-*`, `--accent-*` tokens from `:root` once `--bde-*` values are updated. Keep gradient, glass, and typography v2 tokens (they don't conflict). Update all references.

### New Utility Classes

Add to `design-system.css`:

```css
/* ── Ambient Glow ─────────────────────────────────── */
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
  background: radial-gradient(circle, rgba(0, 211, 127, 0.08) 0%, transparent 70%);
  pointer-events: none;
  z-index: 0;
}

/* ── Glass Surface (simplified) ───────────────────── */
.glass-surface {
  background: rgba(10, 10, 18, 0.75);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.04);
}

/* ── CTA Glow Button ─────────────────────────────── */
.btn-cta {
  background: linear-gradient(135deg, #00d37f, #00a863);
  color: #000;
  border: none;
  border-radius: var(--bde-radius-md);
  box-shadow: 0 4px 16px rgba(0, 211, 127, 0.3);
  transition: all 200ms ease-out;
}
.btn-cta:hover {
  box-shadow:
    0 4px 24px rgba(0, 211, 127, 0.4),
    0 0 8px rgba(0, 211, 127, 0.3);
  filter: brightness(1.1);
}
.btn-cta:active {
  transform: scale(0.97);
  filter: brightness(0.95);
}

/* ── Accent Section Label ─────────────────────────── */
.section-label-accent {
  font-size: var(--bde-size-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--bde-accent);
}

/* ── Hover Border Brighten ────────────────────────── */
.hover-border-brighten {
  border: 1px solid rgba(255, 255, 255, 0.04);
  transition: border-color 200ms ease-out;
}
.hover-border-brighten:hover {
  border-color: rgba(255, 255, 255, 0.08);
}

/* ── Stagger Animation ────────────────────────────── */
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

/* ── Card Hover Lift ──────────────────────────────── */
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
```

### Migration Path

**Phase 1 — Token value swap (low risk, high impact)**

- Update the 8 color values, 4 radius values, 3 shadow values, and font-ui in `base.css` `:root`.
- Update matching values in `tokens.ts`.
- Add new tokens (`--bde-radius-2xl`, `--bde-radius-3xl`, `--bde-shadow-glow`, etc.).
- **Test surface:** All components that use CSS variables auto-update. Run full test suite + visual inspection.
- **Risk:** Inline styles using `tokens.ts` values also update via the import. Hardcoded values in CSS files do NOT update.
- **Estimated scope:** ~15 lines changed in `base.css`, ~15 lines in `tokens.ts`.

**Phase 2 — Hardcoded value cleanup (medium risk, medium effort)**

- Grep all CSS files for hardcoded `border-radius` values and replace with `var(--bde-radius-*)`.
- Grep all TSX files for hardcoded `#000` button text and `rgba()` values; replace with token references.
- **Estimated scope:** ~30 CSS fixes, ~5 TSX fixes.

**Phase 3 — v2 token consolidation (medium risk, important for DX)**

- Remove v2 duplicate tokens (`--bg-*`, `--border`, `--text-*`, `--accent-*`) from `:root`.
- Update ~20 references in `design-system.css` utility classes to use `--bde-*` equivalents.
- Update v2 gradient and glass tokens to use `--bde-*` references internally.
- Remove legacy aliases (top of `base.css` `:root` block).
- **Estimated scope:** ~60 lines removed from `base.css`, ~30 reference updates.

**Phase 4 — Button class unification**

- Remove `.btn-primary` and `.btn-glass` from `design-system.css`.
- Merge their styles into `.bde-btn--primary` and `.bde-btn--ghost` respectively.
- Remove dual-class application from `Button.tsx` (lines 42-43).
- **Estimated scope:** ~40 lines CSS, 2 lines TSX.

**Phase 5 — Inline style extraction (high effort, phased over time)**

- Prioritize the 10 highest-count files (356 total inline styles across 58 files).
- Extract to CSS classes or CSS module files.
- This is ongoing work, not a single PR.

### Performance Considerations

1. **`backdrop-filter` cost:** Currently used in 20 places (confirm modal, sprint drawers, glass-modal, elevation-3-backdrop). Each `backdrop-filter: blur()` triggers a GPU compositing layer. On large surfaces this is expensive. Recommendations:
   - Keep `backdrop-filter` usage to overlays and modals (small surfaces).
   - For glass panel backgrounds, consider `background: rgba()` without blur on elements that cover large areas.
   - The existing blur values are reasonable: `blur(4px)` to `blur(40px)`. Avoid stacking multiple blurred layers simultaneously.

2. **Layered box-shadow cost:** The proposed shadow system uses 2-layer shadows. These are cheap in modern Chromium (Electron). No concern.

3. **Animation performance:**
   - Current `transform: scale()` and `opacity` animations are GPU-accelerated. Good.
   - `.bde-shimmer` uses `background-position` animation — triggers paint on every frame. Consider limiting to small skeleton elements only.
   - Proposed stagger animation uses `transform + opacity` — GPU-friendly.
   - `.glow-pulse` uses `box-shadow` animation — triggers paint. Use sparingly (1-2 active elements max).

4. **CSS variable cascade:** 254 CSS variables in `:root` is fine for Chromium. No performance concern.

5. **`prefers-reduced-motion`:** Already handled globally in `design-system.css` line 792. All animations and transitions are properly disabled. This is excellent and should be maintained as new animations are added.

## Priority Matrix

| Change                                           | Impact                                 | Effort                        | Priority |
| ------------------------------------------------ | -------------------------------------- | ----------------------------- | -------- |
| Update `--bde-radius-*` values (4 tokens)        | **HIGH** — transforms entire UI feel   | **LOW** — 4 lines in base.css | **P0**   |
| Update `--bde-bg/surface/text` colors (8 tokens) | **HIGH** — feast-site depth and warmth | **LOW** — 8 lines in base.css | **P0**   |
| Update `--bde-font-ui` to Inter-first            | **MEDIUM** — brand alignment           | **LOW** — 1 line              | **P0**   |
| Update `tokens.ts` to match CSS vars             | **HIGH** — fixes inline styles         | **LOW** — 15 lines            | **P0**   |
| Add `--bde-shadow-glow*` tokens                  | **MEDIUM** — CTA prominence            | **LOW** — 5 lines             | **P1**   |
| Add `--bde-gradient-cta` token                   | **MEDIUM** — feast-site CTA match      | **LOW** — 1 line              | **P1**   |
| Add ambient glow utility class                   | **MEDIUM** — "lit from within" feel    | **LOW** — 10 lines CSS        | **P1**   |
| Unify Button dual-class problem                  | **HIGH** — fixes specificity bugs      | **MEDIUM** — 40 lines         | **P1**   |
| Add `--bde-radius-2xl/3xl` tokens                | **LOW** — future use                   | **LOW** — 2 lines             | **P1**   |
| Add stagger animation utility                    | **MEDIUM** — list polish               | **LOW** — 12 lines CSS        | **P2**   |
| Hardcoded border-radius cleanup                  | **MEDIUM** — consistency               | **MEDIUM** — 30 file edits    | **P2**   |
| v2 token consolidation/removal                   | **HIGH** — DX clarity                  | **MEDIUM** — 90 line delta    | **P2**   |
| Inline style extraction (58 files)               | **HIGH** — maintainability             | **HIGH** — 356 occurrences    | **P3**   |
| Add missing primitives (Toggle, Select, etc.)    | **MEDIUM** — feature enablement        | **HIGH** — new components     | **P3**   |
| Add `hover-border-brighten` utility              | **LOW** — subtle polish                | **LOW** — 6 lines CSS         | **P2**   |
| Add `card-hover-lift` utility                    | **LOW** — interaction polish           | **LOW** — 6 lines CSS         | **P2**   |
