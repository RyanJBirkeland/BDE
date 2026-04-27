# DP-S1: Unify CSS Variable Systems

> **Status: SHIPPED (verified 2026-04-21). `tokens.css` holds the unified v2 token set; both systems coexist with aliases during the transition.**

**Epic:** Design Polish
**Priority:** P0 (prerequisite for all other stories)
**Estimate:** Medium

---

## Problem

FLEET has two parallel CSS variable systems running simultaneously:

1. **Old system** (`--fleet-*`): Defined in `base.css:10-82`. Used by `body`, all view CSS files, design-system component classes, and `tokens.ts`.
2. **New system** (v2): Defined in `base.css:84-214`. Uses `--bg-*`, `--border`, `--text-*`, `--accent-*`, `--gradient-*`, `--glass-*`. Used by glass classes in `design-system.css` and a handful of components.

The `body` selector (`base.css:234-236`) still references `--fleet-bg`, `--fleet-text`, `--fleet-font-ui`. The `tokens.ts` JS file duplicates old values as hardcoded strings, creating a third source of truth.

### Evidence

| System                            | Definition        | Usage Count (approx)                                          |
| --------------------------------- | ----------------- | ------------------------------------------------------------- |
| `--fleet-bg`, `--fleet-surface`, etc. | `base.css:12-26`  | 200+ references across 6 CSS files                            |
| `--bg-void`, `--bg-base`, etc.    | `base.css:87-103` | ~30 references in `design-system.css` glass/elevation classes |
| `tokens.ts` JS object             | `tokens.ts:1-70`  | 63 references in `TerminalView.tsx` alone                     |

### Impact

- Visual inconsistency: views using `--fleet-surface` (#141414) look different from glass panels using `--glass-tint-dark` (rgba(10,10,18,0.75))
- Maintenance burden: changing a color requires updating up to 3 places
- Light theme only overrides `--fleet-*` vars (`base.css:250-263`), leaving v2 tokens stuck on dark theme

---

## Solution

### Phase 1: Create migration aliases

In `base.css`, make every `--fleet-*` variable point to its v2 equivalent:

```css
/* DEPRECATED — use v2 tokens directly */
--fleet-bg: var(--bg-base);
--fleet-surface: var(--bg-surface);
--fleet-surface-high: var(--bg-card);
--fleet-border: var(--border);
--fleet-border-hover: var(--border-light);
--fleet-accent: var(--accent);
--fleet-accent-dim: var(--accent-muted);
--fleet-text: var(--text-primary);
--fleet-text-muted: var(--text-secondary);
--fleet-text-dim: var(--text-muted);
--fleet-danger: var(--color-error);
--fleet-danger-dim: rgba(255, 69, 58, 0.15);
--fleet-font-ui: var(--font-ui);
--fleet-font-code: var(--font-mono);
```

### Phase 2: Update body and global selectors

```css
body {
  color: var(--text-primary);
  background: var(--bg-base);
  font-family: var(--font-ui);
}
```

### Phase 3: Update light theme overrides

Add v2 equivalents for every `html.theme-light` override in `base.css:250-263`.

### Phase 4: Deprecate `tokens.ts`

Replace `tokens.ts` with a thin wrapper that reads CSS custom properties at runtime, or remove it entirely once DP-S4 migrates TerminalView to CSS classes.

---

## Files to Modify

| File                                        | Change                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/renderer/src/assets/base.css`          | Alias `--fleet-*` → v2, update body/global selectors, add light-theme v2 overrides |
| `src/renderer/src/assets/design-system.css` | No change needed (already uses v2 for glass/elevation)                           |
| `src/renderer/src/design-system/tokens.ts`  | Mark as deprecated, add `// DEPRECATED: use CSS custom properties`               |

## Acceptance Criteria

- [ ] All `--fleet-*` variables are aliased to v2 equivalents via `var()` references
- [ ] `body` selector uses v2 tokens directly
- [ ] Light theme overrides include v2 variable values
- [ ] `tokens.ts` has deprecation comment
- [ ] `npm run build` passes
- [ ] No visual regression — aliased vars produce identical rendered colors

## Risks

- Subtle color shifts where old hex values don't exactly match v2 equivalents (e.g., `--fleet-surface: #141414` vs `--bg-surface: #111118`). Must be tested visually.
- Light theme may need new v2 values that don't exist yet.
