# Light Theme Completion — Design Spec

**Date:** 2026-03-23
**Status:** Approved
**Approach:** CSS-variable-only theming (Approach A + computed style escape hatch for xterm)

## Problem

The design system has solid light theme infrastructure (CSS variable overrides in `html.theme-light`, Zustand theme store, appearance settings UI), but ~59 hardcoded color values across TSX and CSS files bypass the variable system and stay dark-themed regardless of the active theme. Additionally, 4 CSS variables are missing light overrides, and xterm terminals don't react to theme changes.

## Design

### 1. Add missing CSS variable overrides in `html.theme-light`

4 color variables defined in `:root` lack light theme overrides in `base.css`:

| Variable | Dark value | Light override |
|----------|-----------|----------------|
| `--bde-warning` | `#F59E0B` | `#D97706` |
| `--bde-warning-dim` | `rgba(245, 158, 11, 0.15)` | `rgba(217, 119, 6, 0.15)` |
| `--bde-info-dim` | `rgba(59, 130, 246, 0.15)` | `rgba(37, 99, 235, 0.15)` |
| `--bde-success` | `#00D37F` | `#00A863` |

### 2. Add new semantic CSS variables

Some hardcoded colors represent concepts that have no CSS variable. Add to both `:root` and `html.theme-light`:

| Variable | Purpose | Dark | Light |
|----------|---------|------|-------|
| `--bde-merged` | Merged PR / purple semantic | `#A855F7` | `#7C3AED` |
| `--bde-merged-dim` | Purple background tint | `rgba(168, 85, 247, 0.15)` | `rgba(124, 58, 237, 0.15)` |
| `--bde-diff-add` | Diff addition background | `rgba(6, 78, 59, 0.3)` | `rgba(6, 78, 59, 0.15)` |
| `--bde-diff-del` | Diff deletion background | `rgba(127, 29, 29, 0.3)` | `rgba(220, 38, 38, 0.12)` |
| `--bde-btn-primary-text` | Text on accent buttons | `#000000` | `#000000` |
| `--bde-glass-bg` | Glass button background | `rgba(255, 255, 255, 0.04)` | `rgba(0, 0, 0, 0.04)` |
| `--bde-glass-bg-hover` | Glass button hover | `rgba(255, 255, 255, 0.08)` | `rgba(0, 0, 0, 0.08)` |
| `--bde-glass-bg-active` | Glass button active | `rgba(255, 255, 255, 0.06)` | `rgba(0, 0, 0, 0.06)` |

### 3. Replace hardcoded colors with CSS variable references

#### TSX files (17 instances, 5 files)

| File | Change |
|------|--------|
| `TerminalTabBar.tsx` | Replace `getStatusDotColor()` hex values with CSS variables via inline `var()` |
| `ThinkingBlock.tsx` | Replace `THINKING_ACCENT` and `THINKING_BG` with `var(--bde-merged)` / `var(--bde-merged-dim)` |
| `TaskTemplatesSection.tsx` | Replace inline blue styling with `var(--bde-info)` / `var(--bde-info-dim)` |
| `PanelDropOverlay.tsx` | Replace `HIGHLIGHT_COLOR` with `var(--bde-info-dim)` |
| `TerminalPane.tsx` | Handled separately via xterm theme reactivity (section 4) |

#### CSS files (42 instances, 6 files)

| File | Instances | Examples |
|------|-----------|---------|
| `design-system.css` | 6 | `.bde-btn--primary color`, `.btn-glass` backgrounds, modal overlay |
| `cost.css` | 15 | Badge colors, gradient borders, table row accents, hover states |
| `diff.css` | 5 | Diff add/del backgrounds, hunk header, selection trigger text |
| `sprint.css` | 11 | Overlays, button borders, spec drawer, design mode backgrounds |
| `pr-station.css` | 7 | Repo badges, merged badge, dropdown trigger, review dialog |
| `main.css` | 1 | Shortcuts overlay close hover |

Each hardcoded value maps to an existing or newly-created `--bde-*` variable.

### 4. Xterm theme reactivity

**New utility:** `src/renderer/src/lib/terminal-theme.ts`

```typescript
export function getTerminalTheme(): ITheme {
  const style = getComputedStyle(document.documentElement)
  const get = (v: string) => style.getPropertyValue(v).trim()
  return {
    background: get('--bde-bg'),
    foreground: get('--bde-text'),
    cursor: get('--bde-accent'),
    // ... map all xterm theme slots to CSS variables
  }
}
```

**Theme subscription:** In `TerminalPane.tsx`, subscribe to the theme store. On theme change, update `terminal.options.theme` with fresh computed values. Existing terminals react immediately.

### 5. What stays hardcoded (intentionally)

- **AppearanceSection.tsx** `ACCENT_PRESETS` — palette choices, not themed UI
- **RepositoriesSection.tsx** `REPO_COLOR_PALETTE` — user-assigned repo colors
- **constants.ts** `REPO_OPTIONS` — default repo colors

These are data/configuration values, not themed surfaces.

## Files Modified

| File | Change type |
|------|------------|
| `src/renderer/src/assets/base.css` | Add missing overrides + new variables |
| `src/renderer/src/assets/design-system.css` | Replace 6 hardcoded colors |
| `src/renderer/src/assets/cost.css` | Replace 15 hardcoded colors |
| `src/renderer/src/assets/diff.css` | Replace 5 hardcoded colors |
| `src/renderer/src/assets/sprint.css` | Replace 11 hardcoded colors |
| `src/renderer/src/assets/pr-station.css` | Replace 7 hardcoded colors |
| `src/renderer/src/assets/main.css` | Replace 1 hardcoded color |
| `src/renderer/src/components/terminal/TerminalTabBar.tsx` | Use CSS variables for status dots |
| `src/renderer/src/components/terminal/TerminalPane.tsx` | Use terminal-theme utility + subscribe to theme |
| `src/renderer/src/components/agents/ThinkingBlock.tsx` | Use CSS variables |
| `src/renderer/src/components/settings/TaskTemplatesSection.tsx` | Use CSS variables |
| `src/renderer/src/components/panels/PanelDropOverlay.tsx` | Use CSS variables |
| `src/renderer/src/lib/terminal-theme.ts` | **New** — xterm theme from computed CSS variables |

## Testing

- `npm run typecheck` must pass
- `npm test` must pass
- Manual: toggle theme in Settings > Appearance, verify all views respond correctly
