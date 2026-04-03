# Light Theme Completion — Design Spec

**Date:** 2026-03-23
**Status:** Approved
**Approach:** CSS-variable-only theming (Approach A + computed style escape hatch for xterm)

## Problem

The design system has solid light theme infrastructure (CSS variable overrides in `html.theme-light`, Zustand theme store, appearance settings UI), but hardcoded color values across TSX and CSS files bypass the variable system and stay dark-themed regardless of the active theme. Additionally, 2 CSS variables are missing light overrides, xterm terminals don't react to theme changes, and several CSS files haven't been audited.

## Design

### 1. Add missing CSS variable overrides in `html.theme-light`

2 color variables defined in `:root` lack light theme overrides in `base.css`:

| Variable            | Dark value                 | Light override            |
| ------------------- | -------------------------- | ------------------------- |
| `--bde-warning-dim` | `rgba(245, 158, 11, 0.15)` | `rgba(217, 119, 6, 0.15)` |
| `--bde-info-dim`    | `rgba(59, 130, 246, 0.15)` | `rgba(37, 99, 235, 0.15)` |

Note: `--bde-warning`, `--bde-success`, `--bde-diff-add`, `--bde-diff-del`, and `--bde-subagent` already have light overrides.

### 2. Add new semantic CSS variables

Some hardcoded colors represent concepts that have no CSS variable. Add to both `:root` and `html.theme-light`:

| Variable                 | Purpose                                                         | Dark                        | Light                      |
| ------------------------ | --------------------------------------------------------------- | --------------------------- | -------------------------- |
| `--bde-purple`           | Purple semantic (merged PRs, thinking blocks, agent indicators) | `#A855F7`                   | `#7C3AED`                  |
| `--bde-purple-dim`       | Purple background tint                                          | `rgba(168, 85, 247, 0.15)`  | `rgba(124, 58, 237, 0.15)` |
| `--bde-diff-add-bg`      | Diff addition line background                                   | `rgba(6, 78, 59, 0.3)`      | `rgba(6, 78, 59, 0.15)`    |
| `--bde-diff-del-bg`      | Diff deletion line background                                   | `rgba(127, 29, 29, 0.3)`    | `rgba(220, 38, 38, 0.12)`  |
| `--bde-btn-primary-text` | Text on accent-colored buttons                                  | `#000000`                   | `#000000`                  |
| `--bde-glass-bg`         | Glass button background                                         | `rgba(255, 255, 255, 0.04)` | `rgba(0, 0, 0, 0.04)`      |
| `--bde-glass-bg-hover`   | Glass button hover                                              | `rgba(255, 255, 255, 0.08)` | `rgba(0, 0, 0, 0.08)`      |
| `--bde-glass-bg-active`  | Glass button active                                             | `rgba(255, 255, 255, 0.06)` | `rgba(0, 0, 0, 0.06)`      |

Note: `--bde-diff-add` and `--bde-diff-del` already exist as text colors. The new `*-bg` variants are for line backgrounds and do not conflict.

Note: `--bde-purple` is a general-purpose purple token. `--bde-subagent` (`#a78bfa`) remains as a distinct, lighter purple for subagent-specific UI. `--bde-purple` is used for merged badges, thinking blocks, and other non-subagent purple surfaces.

### 3. Replace hardcoded colors with CSS variable references

**Scope:** All hardcoded color values in component styles and view CSS that represent themed surfaces. Shadows, structural `rgba(0,0,0,...)` overlays where the black is intentional in both themes, and user-selected palette colors are out of scope.

#### TSX files (high priority)

| File                       | Change                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `TerminalTabBar.tsx`       | Replace `getStatusDotColor()` hex values with CSS variables via inline `var()`                 |
| `ThinkingBlock.tsx`        | Replace `THINKING_ACCENT` and `THINKING_BG` with `var(--bde-purple)` / `var(--bde-purple-dim)` |
| `TaskTemplatesSection.tsx` | Replace inline blue styling with `var(--bde-info)` / `var(--bde-info-dim)`                     |
| `PanelDropOverlay.tsx`     | Replace `HIGHLIGHT_COLOR` with `var(--bde-info-dim)`                                           |
| `TerminalPane.tsx`         | Handled separately via xterm theme reactivity (section 4)                                      |

#### CSS files

| File                | Key changes                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `design-system.css` | `.bde-btn--primary` text, `.btn-glass` backgrounds, `.btn-primary` text, modal overlay               |
| `cost.css`          | Badge colors, gradient accents, table row borders, hover states                                      |
| `diff.css`          | Diff add/del line backgrounds → `--bde-diff-add-bg`/`--bde-diff-del-bg`, hunk header, selection text |
| `sprint.css`        | Overlays, button borders, spec drawer, design mode backgrounds                                       |
| `pr-station.css`    | Repo badges, merged badge → `--bde-purple`/`--bde-purple-dim`, dropdown trigger, review dialog       |
| `main.css`          | Shortcuts overlay close hover                                                                        |

#### Additional CSS files to audit and fix

These files also need review for hardcoded colors:

- `settings.css`
- `agents.css` / `agents-view.css`
- `terminal.css`
- `memory.css`
- `command-palette.css`
- `toasts.css`

### 4. Xterm theme reactivity

**New utility:** `src/renderer/src/lib/terminal-theme.ts`

```typescript
export function getTerminalTheme(): ITheme {
  const style = getComputedStyle(document.documentElement)
  const get = (v: string) => style.getPropertyValue(v).trim()
  return {
    background: get('--bde-bg'),
    foreground: get('--bde-text'),
    cursor: get('--bde-accent')
    // ... map all xterm theme slots to CSS variables
  }
}
```

**Important:** `getComputedStyle` requires a mounted DOM — this utility must only be called from React components/effects, not at module scope.

**Theme subscription:** In `TerminalPane.tsx`, subscribe to the theme store. On theme change, update `terminal.options.theme` with fresh computed values. Existing terminals react immediately.

### 5. What stays hardcoded (intentionally)

- **AppearanceSection.tsx** `ACCENT_PRESETS` — palette choices, not themed UI
- **RepositoriesSection.tsx** `REPO_COLOR_PALETTE` — user-assigned repo colors
- **constants.ts** `REPO_OPTIONS` — default repo colors
- **Structural overlays** — `rgba(0, 0, 0, 0.4-0.6)` backdrops that are intentionally dark in both themes

## Files Modified

| File                                                            | Change type                                       |
| --------------------------------------------------------------- | ------------------------------------------------- |
| `src/renderer/src/assets/base.css`                              | Add missing overrides + new variables             |
| `src/renderer/src/assets/design-system.css`                     | Replace hardcoded colors                          |
| `src/renderer/src/assets/cost.css`                              | Replace hardcoded colors                          |
| `src/renderer/src/assets/diff.css`                              | Replace hardcoded colors                          |
| `src/renderer/src/assets/sprint.css`                            | Replace hardcoded colors                          |
| `src/renderer/src/assets/pr-station.css`                        | Replace hardcoded colors                          |
| `src/renderer/src/assets/main.css`                              | Replace hardcoded color                           |
| `src/renderer/src/assets/settings.css`                          | Audit + fix if needed                             |
| `src/renderer/src/assets/agents.css`                            | Audit + fix if needed                             |
| `src/renderer/src/assets/agents-view.css`                       | Audit + fix if needed                             |
| `src/renderer/src/assets/terminal.css`                          | Audit + fix if needed                             |
| `src/renderer/src/assets/memory.css`                            | Audit + fix if needed                             |
| `src/renderer/src/assets/command-palette.css`                   | Audit + fix if needed                             |
| `src/renderer/src/assets/toasts.css`                            | Audit + fix if needed                             |
| `src/renderer/src/components/terminal/TerminalTabBar.tsx`       | Use CSS variables for status dots                 |
| `src/renderer/src/components/terminal/TerminalPane.tsx`         | Use terminal-theme utility + subscribe to theme   |
| `src/renderer/src/components/agents/ThinkingBlock.tsx`          | Use CSS variables                                 |
| `src/renderer/src/components/settings/TaskTemplatesSection.tsx` | Use CSS variables                                 |
| `src/renderer/src/components/panels/PanelDropOverlay.tsx`       | Use CSS variables                                 |
| `src/renderer/src/lib/terminal-theme.ts`                        | **New** — xterm theme from computed CSS variables |

## Testing

- `npm run typecheck` must pass
- `npm test` must pass
- Manual: toggle theme in Settings > Appearance, verify all views respond correctly
