# CSS System Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the `--neon-*` / `--bde-*` dual-namespace CSS system into a single `--bde-*` namespace, keep only pro-dark and pro-light themes, and strip all neon visual effects (glows, glass blur, scanlines, particles) from the codebase.

**Architecture:** Two sequential phases. Phase 1 is mechanical token replacement verifiable by grep. Phase 2 removes dead neon React components and strips glow/glass CSS rules. Each phase ends with a full verification gate before the next begins.

**Tech Stack:** CSS custom properties, TypeScript, React, Vitest, ESLint

---

## PHASE 1 — Token Consolidation + Theme Pruning

---

### Task 1: Add new `--bde-*` tokens to `base.css`

**Files:**
- Modify: `src/renderer/src/assets/base.css`

The pro-dark and pro-light theme blocks need the new tokens before any references to them are written. Add them at the end of each theme block.

- [ ] **Step 1: Add tokens to `html.theme-pro-dark` block in `base.css`**

Find the closing `}` of the `html.theme-pro-dark` block and insert before it:

```css
  /* ── New unified tokens ── */
  --bde-accent-surface:   rgba(74, 136, 199, 0.10);
  --bde-accent-border:    rgba(74, 136, 199, 0.28);
  --bde-warning-surface:  rgba(204, 136, 51, 0.10);
  --bde-warning-border:   rgba(204, 136, 51, 0.30);
  --bde-danger-surface:   rgba(219, 92, 92, 0.10);
  --bde-danger-border:    rgba(219, 92, 92, 0.30);
  --bde-status-active:    #7c6af7;
  --bde-status-review:    var(--bde-accent);
  --bde-status-blocked:   var(--bde-warning);
  --bde-status-done:      #4caf82;
  --bde-status-queued:    var(--bde-accent);
```

- [ ] **Step 2: Add tokens to `html.theme-pro-light` block in `base.css`**

Find the closing `}` of the `html.theme-pro-light` block and insert before it:

```css
  /* ── New unified tokens ── */
  --bde-accent-surface:   rgba(38, 117, 191, 0.08);
  --bde-accent-border:    rgba(38, 117, 191, 0.25);
  --bde-warning-surface:  rgba(184, 115, 32, 0.08);
  --bde-warning-border:   rgba(184, 115, 32, 0.28);
  --bde-danger-surface:   rgba(201, 64, 64, 0.08);
  --bde-danger-border:    rgba(201, 64, 64, 0.28);
  --bde-status-active:    #6356e5;
  --bde-status-review:    var(--bde-accent);
  --bde-status-blocked:   var(--bde-warning);
  --bde-status-done:      #3a9b6f;
  --bde-status-queued:    var(--bde-accent);
```

- [ ] **Step 3: Verify tokens exist in both theme blocks**

```bash
grep -n 'bde-status-done\|bde-accent-surface\|bde-danger-border' src/renderer/src/assets/base.css
```

Expected: 4 matches (2 per token, once per theme block).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/assets/base.css
git commit -m "chore(css): add new --bde-* status and surface tokens to pro themes"
```

---

### Task 2: Remove old themes from `base.css`

**Files:**
- Modify: `src/renderer/src/assets/base.css`

Remove three legacy theme blocks. The `:root` block keeps only structural variables (spacing, radii, fonts, transitions) — strip its color definitions.

- [ ] **Step 1: Remove `html.theme-light` block**

Delete the entire `html.theme-light { ... }` block from `base.css`.

- [ ] **Step 2: Remove `html.theme-warm` block**

Delete the entire `html.theme-warm { ... }` block from `base.css`.

- [ ] **Step 3: Strip color definitions from `:root`**

In the `:root` block, delete all lines that define color variables (anything involving hex values, `rgba()`, or references to other color vars). Keep: `--bde-space-*`, `--bde-radius-*`, `--bde-size-*`, `--bde-font-*`, `--bde-shadow-*`, `--bde-transition-*`, `--bde-border-hover`, and gradient/glass structural vars if they're structural.

If in doubt about a variable, check whether `html.theme-pro-dark` redefines it — if yes, it's a color var and should be removed from `:root`.

- [ ] **Step 4: Verify no old theme classes remain**

```bash
grep -n 'theme-light\|theme-warm\b' src/renderer/src/assets/base.css
```

Expected: zero results.

- [ ] **Step 5: Run typecheck to verify nothing broken yet**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/assets/base.css
git commit -m "chore(css): remove theme-light, theme-warm, and root color vars"
```

---

### Task 3: Update theme store + Settings UI

**Files:**
- Modify: `src/renderer/src/stores/theme.ts`
- Modify: `src/renderer/src/views/SettingsView.tsx` (or wherever the Appearance tab theme selector lives — search for `'warm'` in the settings components)

- [ ] **Step 1: Find the warm theme UI**

```bash
grep -rn "'warm'\|\"warm\"" src/renderer/src/
```

Note all files that reference `'warm'` as a theme option.

- [ ] **Step 2: Update `theme.ts`**

In `src/renderer/src/stores/theme.ts`:

a) Remove `'warm'` from the theme type union.

b) Add localStorage migration: if stored value is `'warm'`, rewrite to `'dark'` before initialising.

c) Remove the legacy `'pro-dark'` → `'dark'` and `'pro-light'` → `'light'` migration entries (they've already run).

The migration block should look like (migrate `'warm'` only — the `'pro-dark'`/`'pro-light'` migration from a previous sprint has already run and should be removed):
```ts
const stored = localStorage.getItem('bde-theme')
if (stored === 'warm') {
  localStorage.setItem('bde-theme', 'dark')
}
```

Remove any existing `if (stored === 'pro-dark')` / `if (stored === 'pro-light')` migration lines — they are stale.

d) The class applied to `<html>` for `'dark'` should be `theme-pro-dark`; for `'light'` it should be `theme-pro-light`. Verify the store still does this (it should already — just confirm).

- [ ] **Step 3: Remove warm option from Settings Appearance UI**

Find the theme selector in the Settings Appearance tab. Remove the warm option from whatever array/list drives the options. Keep only dark, light, and system.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all pass (or same failures as before this task — don't introduce new ones).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/stores/theme.ts
git add -p  # stage only the warm-removal changes in settings files
git commit -m "chore(css): remove warm theme, add migration for legacy stored values"
```

---

### Task 4: Delete `neon.css` and update its import

**Files:**
- Delete: `src/renderer/src/assets/neon.css`
- Modify: `src/renderer/src/assets/main.css`
- Modify: `src/renderer/src/App.tsx`

`neon.css` defines `--neon-*` variables. After Tasks 1–3, the pro-theme blocks in `base.css` already define all the replacements. `neon.css` will become dead weight once token references are updated, so delete it now to get a clean grep baseline.

- [ ] **Step 1: Check what `neon.css` defines that isn't in base.css pro-dark yet**

```bash
grep '^\s*--neon-' src/renderer/src/assets/neon.css | head -40
```

Scan the output. Any `--neon-*` variable that has no `--bde-*` equivalent added in Task 1 needs to be handled (add a `--bde-*` equivalent to base.css, or confirm it's a deleted-with-no-replacement glow/glass/particle var).

- [ ] **Step 2: Delete `neon.css`**

```bash
rm src/renderer/src/assets/neon.css
```

- [ ] **Step 3: Remove import from `main.css`**

In `src/renderer/src/assets/main.css`, delete the line:
```css
@import './neon.css';
```

- [ ] **Step 4: Remove import from `App.tsx`**

In `src/renderer/src/App.tsx`, delete the line:
```ts
import './assets/neon.css'
```

- [ ] **Step 5: Verify no remaining import of neon.css**

```bash
grep -rn "neon\.css" src/
```

Expected: zero results.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/assets/main.css src/renderer/src/App.tsx
git rm src/renderer/src/assets/neon.css
git commit -m "chore(css): delete neon.css, remove imports"
```

---

### Task 5: Token replacement pass A — surface and text tokens

**Files:** All CSS files in `src/renderer/src/assets/`

Replace the atmosphere/surface `--neon-*` variables with their `--bde-*` equivalents across every CSS file. These are 1:1 replacements with no semantic change.

- [ ] **Step 1: Run replacement across all CSS files**

```bash
cd src/renderer/src/assets

# Surface tokens
LC_ALL=C sed -i '' 's/var(--neon-bg)/var(--bde-bg)/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-text-muted)/var(--bde-text-muted)/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-text-dim)/var(--bde-text-dim)/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-text)/var(--bde-text)/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-surface-deep)/var(--bde-surface-high)/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-surface-subtle)/var(--bde-surface)/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-surface-base)/var(--bde-bg)/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-surface-mid)/var(--bde-surface)/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-surface-dim)/var(--bde-border)/g' *.css

cd ../../..
```

- [ ] **Step 2: Verify no surface/text neon vars remain in CSS**

```bash
grep -rn 'var(--neon-bg)\|var(--neon-text\|var(--neon-surface' src/renderer/src/assets/
```

Expected: zero results.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/assets/
git commit -m "chore(css): replace --neon surface/text tokens with --bde equivalents"
```

---

### Task 6: Token replacement pass B — accent (cyan) tokens

**Files:** All CSS files, `src/renderer/src/components/planner/*.tsx`

Replace `--neon-cyan-*` with `--bde-accent-*`.

- [ ] **Step 1: Run replacement across all CSS files**

```bash
cd src/renderer/src/assets

LC_ALL=C sed -i '' 's/var(--neon-cyan-glow)/transparent/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-cyan-surface)/var(--bde-accent-surface)/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-cyan-border)/var(--bde-accent-border)/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-cyan)/var(--bde-accent)/g' *.css

cd ../../..
```

- [ ] **Step 2: Replace in planner component files (inline styles)**

```bash
grep -rn 'neon-cyan' src/renderer/src/components/planner/
```

For each match, update the inline style to use `var(--bde-accent)` / `var(--bde-accent-surface)` / `var(--bde-accent-border)` as appropriate. Also check `src/renderer/src/components/` more broadly:

```bash
grep -rn 'neon-cyan' src/renderer/src/
```

- [ ] **Step 3: Verify no cyan neon vars remain**

```bash
grep -rn 'neon-cyan' src/renderer/src/
```

Expected: zero results.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/assets/ src/renderer/src/components/
git commit -m "chore(css): replace --neon-cyan tokens with --bde-accent"
```

---

### Task 7: Token replacement pass C — status and semantic tokens

**Files:** All CSS files, any TSX with inline `--neon-*` style references

This pass handles the remaining accent colors. Note `--neon-pink` → `--bde-status-done` is a **color change** (pink → green) — intentional semantic correction.

- [ ] **Step 1: Run replacement across all CSS files**

```bash
cd src/renderer/src/assets

# Purple → status-active
LC_ALL=C sed -i '' 's/var(--neon-purple-glow)/transparent/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-purple-surface)/var(--bde-accent-surface)/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-purple-border)/var(--bde-accent-border)/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-purple)/var(--bde-status-active)/g' *.css

# Blue → status-review
LC_ALL=C sed -i '' 's/var(--neon-blue-glow)/transparent/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-blue-surface)/var(--bde-accent-surface)/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-blue-border)/var(--bde-accent-border)/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-blue)/var(--bde-status-review)/g' *.css

# Orange → warning
LC_ALL=C sed -i '' 's/var(--neon-orange-glow)/transparent/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-orange-surface)/var(--bde-warning-surface)/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-orange-border)/var(--bde-warning-border)/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-orange)/var(--bde-warning)/g' *.css

# Pink → status-done (green — intentional color change)
LC_ALL=C sed -i '' 's/var(--neon-pink-glow)/transparent/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-pink-surface)/var(--bde-accent-surface)/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-pink-border)/var(--bde-accent-border)/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-pink)/var(--bde-status-done)/g' *.css

# Red → danger
LC_ALL=C sed -i '' 's/var(--neon-red-glow)/transparent/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-red-surface)/var(--bde-danger-surface)/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-red-border)/var(--bde-danger-border)/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-red)/var(--bde-danger)/g' *.css

cd ../../..
```

- [ ] **Step 2: Check for any remaining `--neon-*` in CSS files**

```bash
grep -rn '\-\-neon-' src/renderer/src/assets/
```

For any hits that weren't covered above (e.g., `--neon-glass-*`, `--neon-scanline-*`, `--neon-particle-*`), replace with `transparent`, `none`, or `0` as appropriate:

```bash
cd src/renderer/src/assets
LC_ALL=C sed -i '' 's/var(--neon-glass-blur)/none/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-glass-edge)/transparent/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-glass-shadow)/none/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-scanline-opacity)/0/g' *.css
LC_ALL=C sed -i '' 's/var(--neon-particle-count)/0/g' *.css
cd ../../..
```

Re-run the grep until zero results.

- [ ] **Step 3: Check TSX/TS files for literal `--neon-*` strings**

The `sed` passes above only touch CSS files. TSX/TS files can contain inline `--neon-*` references in template literals or `style` props that the CSS sed passes will miss.

```bash
grep -rn '\-\-neon-' src/renderer/src/components/ src/renderer/src/views/ src/renderer/src/stores/
```

For each hit, apply the same token mapping as the CSS passes. Pay special attention to glass/effect vars — these don't have a CSS equivalent and become literal strings:

- `var(--neon-glass-blur)` / `var(--neon-glass-shadow)` / `var(--neon-glass-edge)` → `'none'` (or remove the style prop entirely)
- `var(--neon-glass-shadow)` in a `boxShadow` prop → remove the prop
- All `--neon-*-glow` in inline styles → `'transparent'`

Known file to check: `src/renderer/src/components/agents/AgentCard.tsx` uses glass token strings inline.

- [ ] **Step 4: Verify — zero `--neon-*` references remain anywhere**

```bash
grep -rn '\-\-neon-' src/
```

Expected: zero results. This is the Phase 1 CSS verification gate.

- [ ] **Step 5: Run typecheck + tests**

```bash
npm run typecheck && npm test
```

Expected: zero typecheck errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/assets/ src/renderer/src/components/ src/renderer/src/views/ src/renderer/src/stores/
git commit -m "chore(css): replace all remaining --neon-* tokens with --bde-* equivalents"
```

---

### Task 8: Update `tokens.ts` and `neonVar` + all call sites

**Files:**
- Modify: `src/renderer/src/design-system/tokens.ts`
- Modify: `src/renderer/src/components/neon/types.ts`
- Modify (8 files using `tokens.neon.*`): `src/renderer/src/components/planner/CreateEpicModal.tsx`, `EpicList.tsx`, `EpicDetail.tsx`, `src/renderer/src/components/neon/NeonCard.tsx`, `PipelineFlow.tsx`, `NeonProgress.tsx`, `GlassPanel.tsx`, `NeonProgress.test.tsx`

- [ ] **Step 1: Update `tokens.ts` — replace `neon` property**

In `src/renderer/src/design-system/tokens.ts`:

Remove the entire `neon: { ... }` block and replace it with a `status` block. Also add new entries to `color`:

```ts
color: {
  bg: 'var(--bde-bg)',
  surface: 'var(--bde-surface)',
  surfaceHigh: 'var(--bde-surface-high)',
  border: 'var(--bde-border)',
  borderHover: 'var(--bde-border-hover)',
  accent: 'var(--bde-accent)',
  accentDim: 'var(--bde-accent-dim)',
  accentSurface: 'var(--bde-accent-surface)',   // new
  accentBorder: 'var(--bde-accent-border)',     // new
  text: 'var(--bde-text)',
  textMuted: 'var(--bde-text-muted)',
  textDim: 'var(--bde-text-dim)',
  danger: 'var(--bde-danger)',
  dangerDim: 'var(--bde-danger-dim)',
  dangerSurface: 'var(--bde-danger-surface)',   // new
  dangerBorder: 'var(--bde-danger-border)',     // new
  warning: 'var(--bde-warning)',
  warningDim: 'var(--bde-warning-dim)',
  warningSurface: 'var(--bde-warning-surface)', // new
  warningBorder: 'var(--bde-warning-border)',   // new
  info: 'var(--bde-info)',
  infoDim: 'var(--bde-info-dim)',
  success: 'var(--bde-success)'
},
// ...
status: {
  active:    'var(--bde-status-active)',
  review:    'var(--bde-status-review)',
  blocked:   'var(--bde-warning)',
  done:      'var(--bde-status-done)',
  queued:    'var(--bde-accent)',
  failed:    'var(--bde-danger)',
  cancelled: 'var(--bde-text-dim)'
}
```

- [ ] **Step 2: Update `neonVar` in `types.ts`**

Replace the implementation in `src/renderer/src/components/neon/types.ts`:

```ts
// src/renderer/src/components/neon/types.ts

/** Legacy accent names — values are historical; they now map to --bde-* tokens */
export type NeonAccent = 'cyan' | 'pink' | 'blue' | 'purple' | 'orange' | 'red'

const colorMap: Record<NeonAccent, string> = {
  cyan:   'var(--bde-accent)',
  blue:   'var(--bde-status-review)',
  purple: 'var(--bde-status-active)',
  pink:   'var(--bde-status-done)',
  orange: 'var(--bde-warning)',
  red:    'var(--bde-danger)'
}

const surfaceMap: Record<NeonAccent, string> = {
  cyan:   'var(--bde-accent-surface)',
  blue:   'var(--bde-accent-surface)',
  purple: 'var(--bde-accent-surface)',
  pink:   'var(--bde-accent-surface)',
  orange: 'var(--bde-warning-surface)',
  red:    'var(--bde-danger-surface)'
}

const borderMap: Record<NeonAccent, string> = {
  cyan:   'var(--bde-accent-border)',
  blue:   'var(--bde-accent-border)',
  purple: 'var(--bde-accent-border)',
  pink:   'var(--bde-accent-border)',
  orange: 'var(--bde-warning-border)',
  red:    'var(--bde-danger-border)'
}

/** Maps a legacy NeonAccent name to its --bde-* CSS custom property */
export function neonVar(
  accent: NeonAccent,
  variant: 'color' | 'glow' | 'surface' | 'border'
): string {
  if (variant === 'glow') return 'transparent'
  if (variant === 'surface') return surfaceMap[accent]
  if (variant === 'border') return borderMap[accent]
  return colorMap[accent]
}

/** All accent names for iteration */
export const NEON_ACCENTS: NeonAccent[] = ['cyan', 'pink', 'blue', 'purple', 'orange', 'red']
```

- [ ] **Step 3: Update `tokens.neon.*` call sites**

Find all files still using `tokens.neon`:

```bash
grep -rn 'tokens\.neon\.' src/renderer/src/
```

For each file, update the reference using this mapping:
- `tokens.neon.cyan` → `tokens.color.accent`
- `tokens.neon.pink` → `tokens.status.done`
- `tokens.neon.blue` → `tokens.status.review`
- `tokens.neon.purple` → `tokens.status.active`
- `tokens.neon.orange` → `tokens.color.warning`
- `tokens.neon.red` → `tokens.color.danger`
- `tokens.neon.text` → `tokens.color.text`
- `tokens.neon.textMuted` → `tokens.color.textMuted`
- `tokens.neon.textDim` → `tokens.color.textDim`
- `tokens.neon.surfaceDim` → `tokens.color.border`
- `tokens.neon.surfaceSubtle` → `tokens.color.surface`
- `tokens.neon.surfaceDeep` → `tokens.color.surfaceHigh`
- `tokens.neon.bg` → `tokens.color.bg`
- `tokens.neon.glassBg` / `tokens.neon.glassEdge` / `tokens.neon.glassShadow` → `'transparent'` or remove the style prop

- [ ] **Step 4: Verify zero `tokens.neon` references remain**

```bash
grep -rn 'tokens\.neon' src/renderer/src/
```

Expected: zero results.

- [ ] **Step 5: Run typecheck + tests**

```bash
npm run typecheck && npm test
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/design-system/tokens.ts src/renderer/src/components/neon/types.ts src/renderer/src/components/ src/renderer/src/views/
git commit -m "chore(css): replace tokens.neon with tokens.status + tokens.color, update neonVar mappings"
```

---

### Task 9: Merge legacy CSS files + rename all `-neon.css` files

**Files:** Many — see table below

Some features have both a legacy CSS file and a `-neon.css` version. Merge first (legacy into neon), then rename all neon files dropping the `-neon` suffix.

**Files with both legacy and neon versions (merge legacy → neon first):**

| Legacy | Neon (target) |
|---|---|
| `src/renderer/src/assets/agents.css` (83 lines) | `src/renderer/src/assets/agents-neon.css` |
| `src/renderer/src/assets/settings.css` (215 lines) | `src/renderer/src/assets/settings-v2-neon.css` |
| `src/renderer/src/assets/ide.css` (395 lines) | `src/renderer/src/assets/ide-neon.css` |
| `src/renderer/src/assets/diff.css` (514 lines) | `src/renderer/src/assets/diff-neon.css` |

**All neon files to rename (after merges complete):**

| Old name | New name |
|---|---|
| `neon-primitives.css` | `primitives.css` |
| `neon-shell.css` | `shell.css` |
| `sprint-neon.css` | absorbed into `sprint.css` |
| `agents-neon.css` | `agents.css` |
| `task-workbench-neon.css` | `task-workbench.css` |
| `source-control-neon.css` | `source-control.css` |
| `code-review-neon.css` | `code-review.css` |
| `dashboard-neon.css` | `dashboard.css` |
| `settings-v2-neon.css` | `settings.css` |
| `planner-neon.css` | `planner.css` |
| `ide-neon.css` | `ide.css` |
| `agent-launchpad-neon.css` | `agent-launchpad.css` |
| `onboarding-neon.css` | `onboarding.css` |
| `diff-neon.css` | `diff.css` |
| `sankey-pipeline-neon.css` | `sankey-pipeline.css` |
| `sprint-pipeline-neon.css` | `sprint-pipeline.css` |

- [ ] **Step 1: Merge `agents.css` into `agents-neon.css`**

Legacy rules first so neon overrides win:

```bash
cat src/renderer/src/assets/agents.css src/renderer/src/assets/agents-neon.css > /tmp/agents-merged.css
mv /tmp/agents-merged.css src/renderer/src/assets/agents-neon.css
rm src/renderer/src/assets/agents.css
```

- [ ] **Step 2: Merge `settings.css` into `settings-v2-neon.css`**

```bash
cat src/renderer/src/assets/settings.css src/renderer/src/assets/settings-v2-neon.css > /tmp/settings-merged.css
mv /tmp/settings-merged.css src/renderer/src/assets/settings-v2-neon.css
rm src/renderer/src/assets/settings.css
```

- [ ] **Step 3: Merge `ide.css` into `ide-neon.css`**

```bash
cat src/renderer/src/assets/ide.css src/renderer/src/assets/ide-neon.css > /tmp/ide-merged.css
mv /tmp/ide-merged.css src/renderer/src/assets/ide-neon.css
rm src/renderer/src/assets/ide.css
```

- [ ] **Step 4: Merge `diff.css` into `diff-neon.css`**

```bash
cat src/renderer/src/assets/diff.css src/renderer/src/assets/diff-neon.css > /tmp/diff-merged.css
mv /tmp/diff-merged.css src/renderer/src/assets/diff-neon.css
rm src/renderer/src/assets/diff.css
```

- [ ] **Step 5: Absorb `sprint-neon.css` into `sprint.css`**

```bash
cat src/renderer/src/assets/sprint-neon.css >> src/renderer/src/assets/sprint.css
rm src/renderer/src/assets/sprint-neon.css
```

- [ ] **Step 6: Rename all remaining `-neon.css` files**

```bash
cd src/renderer/src/assets
mv neon-primitives.css primitives.css
mv neon-shell.css shell.css
mv agents-neon.css agents.css
mv task-workbench-neon.css task-workbench.css
mv source-control-neon.css source-control.css
mv code-review-neon.css code-review.css
mv dashboard-neon.css dashboard.css
mv settings-v2-neon.css settings.css
mv planner-neon.css planner.css
mv ide-neon.css ide.css
mv agent-launchpad-neon.css agent-launchpad.css
mv onboarding-neon.css onboarding.css
mv diff-neon.css diff.css
mv sankey-pipeline-neon.css sankey-pipeline.css
mv sprint-pipeline-neon.css sprint-pipeline.css
cd ../../../..
```

- [ ] **Step 7: Commit file renames and merges**

```bash
git add -A src/renderer/src/assets/
git commit -m "chore(css): merge legacy CSS files, rename -neon.css files to drop neon suffix"
```

---

### Task 10: Update all CSS import statements

**Files:**
- Modify: `src/renderer/src/assets/main.css`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/views/IDEView.tsx`
- Modify: `src/renderer/src/views/DashboardView.tsx`
- Modify: `src/renderer/src/views/AgentsView.tsx`
- Modify: `src/renderer/src/components/sprint/SprintPipeline.tsx`
- Modify: `src/renderer/src/components/task-workbench/TaskWorkbench.tsx`
- Modify: `src/renderer/src/components/agents/AgentLaunchpad.tsx`
- Modify: `src/renderer/src/components/neon/SankeyPipeline.tsx`
- Modify: `src/renderer/src/components/onboarding/OnboardingWizard.tsx`

- [ ] **Step 1: Find all remaining neon CSS import references**

```bash
grep -rn 'neon\.css\|neon-\|neon\.css' src/renderer/src/ --include='*.ts' --include='*.tsx' --include='*.css'
```

- [ ] **Step 2: Confirm component-level lazy imports before updating `main.css`**

Before removing any file from `main.css`, confirm the file has a component-level `import` statement elsewhere. Run:

```bash
grep -rn 'dashboard\.css\|agent-launchpad\.css\|task-workbench\.css\|agents\.css\|sprint-pipeline\.css\|ide\.css' \
  src/renderer/src/ --include='*.tsx' --include='*.ts'
```

Only omit a file from `main.css` if it appears in component-level imports above. If any file has no component import, add it to `main.css` instead of leaving it orphaned.

- [ ] **Step 3: Update `main.css`**

Replace the import block. The new imports (only files not lazy-loaded by components):

```css
@import './base.css';
@import './design-system.css';
@import './primitives.css';
@import './shell.css';
@import './sprint.css';
/* sprint-pipeline.css imported by SprintPipeline.tsx (lazy chunk) */
/* agents.css imported by AgentsView.tsx and App.tsx (lazy chunk) */
@import './cost.css';
@import './memory.css';
@import './settings.css';
@import './terminal.css';
/* ide.css imported by IDEView.tsx (lazy chunk) */
@import './code-review.css';
@import './diff.css';
@import './source-control.css';
/* onboarding.css imported by OnboardingWizard.tsx (lazy chunk) */
@import './planner.css';
/* agent-launchpad.css imported by AgentLaunchpad.tsx (lazy chunk) */
/* task-workbench.css imported by TaskWorkbench.tsx (lazy chunk) */
/* dashboard.css imported by DashboardView.tsx (lazy chunk) */
@import './command-palette.css';
@import './toasts.css';
```

- [ ] **Step 4: Update component-level CSS imports**

For each file identified in Step 1:

| Old import | New import |
|---|---|
| `import './assets/neon-shell.css'` | `import './assets/shell.css'` |
| `import './assets/agents-neon.css'` | `import './assets/agents.css'` |
| `import '../assets/ide-neon.css'` | `import '../assets/ide.css'` |
| `import '../assets/dashboard-neon.css'` | `import '../assets/dashboard.css'` |
| `import '../../assets/sprint-pipeline-neon.css'` | `import '../../assets/sprint-pipeline.css'` |
| `import '../../assets/task-workbench-neon.css'` | `import '../../assets/task-workbench.css'` |
| `import '../../assets/agent-launchpad-neon.css'` | `import '../../assets/agent-launchpad.css'` |
| `import '../../assets/sankey-pipeline-neon.css'` | `import '../../assets/sankey-pipeline.css'` |
| `import '../../assets/onboarding-neon.css'` | `import '../../assets/onboarding.css'` |

- [ ] **Step 5: Verify no broken imports remain**

```bash
grep -rn '\-neon\.css' src/renderer/src/
```

Expected: zero results.

- [ ] **Step 6: Run typecheck + tests**

```bash
npm run typecheck && npm test
```

Expected: zero errors, all tests pass.

- [ ] **Step 7: Run lint**

```bash
npm run lint
```

Expected: zero errors.

- [ ] **Step 8: Phase 1 verification gate — zero `--neon-*` references anywhere**

```bash
grep -rn '\-\-neon-' src/
```

Expected: zero results. If any remain, fix before continuing to Phase 2.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/assets/main.css src/renderer/src/App.tsx src/renderer/src/views/ src/renderer/src/components/
git commit -m "chore(css): update all CSS import paths to use renamed files — Phase 1 complete"
```

---

## PHASE 2 — Neon Component Removal + CSS Effect Strip

---

### Task 11: Delete `ParticleField` and `ScanlineOverlay`

**Files:**
- Delete: `src/renderer/src/components/neon/ParticleField.tsx`
- Delete: `src/renderer/src/components/neon/ScanlineOverlay.tsx`
- Modify: `src/renderer/src/components/neon/index.ts`
- Modify: `src/renderer/src/views/DashboardView.tsx` (imports `ParticleField`)

- [ ] **Step 1: Find all usages**

```bash
grep -rn 'ParticleField\|ScanlineOverlay' src/renderer/src/
```

- [ ] **Step 2: Remove `ParticleField` from `DashboardView.tsx`**

In `src/renderer/src/views/DashboardView.tsx`, remove the `ParticleField` import and any JSX usage of `<ParticleField ... />`.

- [ ] **Step 3: Check for any other usage sites**

For each file found in Step 1 (besides the files being deleted), remove the import and JSX usage.

- [ ] **Step 4: Remove exports from `index.ts`**

In `src/renderer/src/components/neon/index.ts`, remove:
```ts
export { ScanlineOverlay } from './ScanlineOverlay'
export { ParticleField } from './ParticleField'
```

- [ ] **Step 5: Delete the files**

```bash
rm src/renderer/src/components/neon/ParticleField.tsx
rm src/renderer/src/components/neon/ScanlineOverlay.tsx
```

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 7: Run tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git rm src/renderer/src/components/neon/ParticleField.tsx src/renderer/src/components/neon/ScanlineOverlay.tsx
git add src/renderer/src/components/neon/index.ts src/renderer/src/views/DashboardView.tsx
git commit -m "chore(css): delete ParticleField and ScanlineOverlay components"
```

---

### Task 12: Gut neon component internals

**Files:**
- Modify: `src/renderer/src/components/neon/NeonCard.tsx`
- Modify: `src/renderer/src/components/neon/GlassPanel.tsx`
- Modify: `src/renderer/src/components/neon/NeonBadge.tsx`
- Modify: `src/renderer/src/components/neon/NeonTooltip.tsx`
- Modify: `src/renderer/src/components/neon/NeonProgress.tsx`
- Modify: `src/renderer/src/components/neon/StatCounter.tsx`
- Modify: `src/renderer/src/components/neon/ActivityFeed.tsx`
- Modify: `src/renderer/src/components/neon/MiniChart.tsx`
- Modify: `src/renderer/src/components/neon/StatusBar.tsx`
- Modify: `src/renderer/src/components/neon/PipelineFlow.tsx`

Export names stay unchanged. Only remove inline glow `style` props and any explicit glass/blur styles applied from within the component.

- [ ] **Step 1: Audit each component for inline glow styles**

```bash
grep -n 'boxShadow\|textShadow\|backdropFilter\|blur\|glow\|glassShadow\|glassEdge' \
  src/renderer/src/components/neon/NeonCard.tsx \
  src/renderer/src/components/neon/GlassPanel.tsx \
  src/renderer/src/components/neon/NeonBadge.tsx \
  src/renderer/src/components/neon/NeonTooltip.tsx \
  src/renderer/src/components/neon/NeonProgress.tsx \
  src/renderer/src/components/neon/StatCounter.tsx \
  src/renderer/src/components/neon/ActivityFeed.tsx \
  src/renderer/src/components/neon/MiniChart.tsx \
  src/renderer/src/components/neon/StatusBar.tsx \
  src/renderer/src/components/neon/PipelineFlow.tsx
```

- [ ] **Step 2: For each component, remove glow/glass inline styles**

For each `style={{ boxShadow: '0 0 ...' }}` or `style={{ backdropFilter: ... }}`:
- Remove glow box-shadows entirely (delete the property)
- Remove `backdropFilter` and `WebkitBackdropFilter` properties
- Remove any `textShadow` glow properties
- Keep elevation/offset box-shadows that use `var(--bde-shadow-*)` or `rgba(0,0,0,...)`

- [ ] **Step 3: Check for inline glow box-shadows in TSX broadly**

```bash
grep -rn 'boxShadow.*0 0\|textShadow' src/renderer/src/components/ src/renderer/src/views/
```

Fix each hit that is a glow effect.

- [ ] **Step 4: Run typecheck + tests**

```bash
npm run typecheck && npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/neon/
git commit -m "chore(css): strip glow and glass inline styles from neon components"
```

---

### Task 13: Strip CSS glow effects from all stylesheets

**Files:** All CSS files in `src/renderer/src/assets/`

Remove every `box-shadow` rule that is a glow effect (pattern: `0 0 Npx`), all `text-shadow` glow rules.

- [ ] **Step 1: Find all glow box-shadows**

```bash
grep -n 'box-shadow.*0 0\|text-shadow' src/renderer/src/assets/*.css
```

Review the output. Glow shadows look like `0 0 12px` or `0 0 8px var(--neon-...)`. Elevation shadows look like `0 4px 16px` — keep those.

- [ ] **Step 2: Remove glow box-shadows file by file**

For each CSS file with hits, edit out the glow shadow values. For rules where `box-shadow` is the only declaration in a hover/focus block, remove the entire rule. For rules where it's one of several declarations, remove just the `box-shadow` line.

Pay special attention to `sprint-pipeline.css` (the largest file at 2,575 lines — do this one last and verify carefully).

- [ ] **Step 3: Remove all `text-shadow` glow rules**

```bash
grep -n 'text-shadow' src/renderer/src/assets/*.css
```

Remove each one. `text-shadow: none` is fine to keep (it's a reset); remove any that produce a visible glow.

- [ ] **Step 4: Verify**

```bash
# Zero glow box-shadows
grep -rn 'box-shadow.*0 0' src/renderer/src/assets/
# Zero text-shadow (excluding resets)
grep -rn 'text-shadow' src/renderer/src/assets/ | grep -v 'text-shadow: none'
```

Expected: zero results from both commands.

- [ ] **Step 5: Run typecheck + tests**

```bash
npm run typecheck && npm test
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/assets/
git commit -m "chore(css): strip all glow box-shadows and text-shadows from stylesheets"
```

---

### Task 14: Strip `backdrop-filter` + clean up `design-system.css` glass overrides

**Files:**
- Modify: all CSS files containing `backdrop-filter`
- Modify: `src/renderer/src/assets/design-system.css`

- [ ] **Step 1: Find all `backdrop-filter` uses**

```bash
grep -rn 'backdrop-filter\|WebkitBackdropFilter' src/renderer/src/assets/ src/renderer/src/components/
```

- [ ] **Step 2: Remove `backdrop-filter` from all CSS files**

For every hit, remove the `backdrop-filter` and `-webkit-backdrop-filter` declarations. If those were the only declarations in a rule block (e.g., a `.glass-*` modifier class), remove the entire rule block.

- [ ] **Step 3: Clean up `design-system.css` glass classes**

Now that only pro themes exist, the base `.glass-modal` class no longer needs to define `backdrop-filter` (the pro-theme overrides zeroed it out). Simplify:

- Remove the `backdrop-filter` property from `.glass-modal` base rule
- Remove or simplify the `html.theme-pro-dark .glass-modal` and `html.theme-pro-light .glass-modal` override blocks — since there are no other themes, the overrides are now redundant. Merge the pro-dark values directly into `.glass-modal` and handle light-theme differences with `html.theme-pro-light .glass-modal`.

Similarly clean up any `.glass-panel`, `.glass-surface` variants.

- [ ] **Step 4: Verify zero backdrop-filter remains**

```bash
grep -rn 'backdrop-filter' src/renderer/src/
```

Expected: zero results (or only `backdrop-filter: none` resets if intentionally kept).

- [ ] **Step 5: Final verification gate — run all checks**

```bash
# Zero --neon-* CSS vars
grep -rn '\-\-neon-' src/
# Zero glow box-shadows
grep -rn 'box-shadow.*0 0\|boxShadow.*0 0' src/renderer/src/
# Zero text-shadow glows
grep -rn 'text-shadow' src/renderer/src/assets/
# Zero backdrop-filter
grep -rn 'backdrop-filter' src/renderer/src/
# Zero deleted components
grep -rn 'ParticleField\|ScanlineOverlay' src/renderer/src/
```

All expected: zero results.

- [ ] **Step 6: Run full suite**

```bash
npm run typecheck && npm test && npm run lint
```

Expected: zero errors.

- [ ] **Step 7: Final commit**

```bash
git add src/renderer/src/assets/ src/renderer/src/components/
git commit -m "chore(css): strip backdrop-filter, clean glass overrides — Phase 2 complete"
```
