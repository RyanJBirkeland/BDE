# Spacing token adoption — design-system + views + assets

## Problem

CSS files in the design-system primitives, view-level styles, and global asset stylesheets use hardcoded pixel values for `gap`, `padding`, and `margin` instead of the `--bde-space-*` design tokens.

## Solution

Replace every hardcoded spacing pixel value that has an exact token match. The token scale in `src/renderer/src/assets/tokens.css`:

| Raw    | Token                |
| ------ | -------------------- |
| `4px`  | `var(--bde-space-1)` |
| `8px`  | `var(--bde-space-2)` |
| `12px` | `var(--bde-space-3)` |
| `16px` | `var(--bde-space-4)` |
| `20px` | `var(--bde-space-5)` |
| `24px` | `var(--bde-space-6)` |
| `32px` | `var(--bde-space-8)` |

**Rules:**

- Only replace `gap`, `padding`, and `margin` properties (including `-top`/`-right`/`-bottom`/`-left` variants)
- Tokenize each value independently in shorthands: `padding: 8px 10px` → `padding: var(--bde-space-2) 10px`
- **Leave as-is:** `0`/`1px`/`2px`/`3px`, values without token match (`6px`, `10px`, `14px`), negative values, `calc()` internals, non-spacing properties (`width`, `height`, `font-size`, `border-radius`, `border-width`)

## Files to Change

- `src/renderer/src/assets/design-system/neon-badge.css`
- `src/renderer/src/assets/design-system/button.css`
- `src/renderer/src/assets/design-system/utilities.css`
- `src/renderer/src/assets/design-system/badge.css`
- `src/renderer/src/assets/design-system/neon-card.css`
- `src/renderer/src/assets/design-system/card.css`
- `src/renderer/src/assets/design-system/input.css`
- `src/renderer/src/assets/design-system/mini-chart.css`
- `src/renderer/src/assets/design-system/panel.css`
- `src/renderer/src/assets/cost.css`
- `src/renderer/src/assets/memory.css`
- `src/renderer/src/assets/terminal.css`
- `src/renderer/src/assets/onboarding.css`
- `src/renderer/src/assets/command-palette.css`
- `src/renderer/src/assets/toasts.css`
- `src/renderer/src/views/DashboardView.css`
- `src/renderer/src/views/PlannerView.css`
- `src/renderer/src/views/GitTreeView.css`
- `src/renderer/src/views/IDEView.css`
- `src/renderer/src/views/AgentsView.css`
- `src/renderer/src/views/SettingsView.css`
- `src/renderer/src/App.css`

## How to Test

1. Grep for remaining hardcoded tokenizable values — should return zero:
   ```bash
   grep -rnE '(gap|padding|margin)[^:]*:\s*[^;]*((?<![0-9])(4|8|12|16|20|24|32)px)' src/renderer/src/assets/design-system/*.css src/renderer/src/assets/cost.css src/renderer/src/assets/memory.css src/renderer/src/assets/terminal.css src/renderer/src/assets/onboarding.css src/renderer/src/assets/command-palette.css src/renderer/src/assets/toasts.css src/renderer/src/views/*.css src/renderer/src/App.css
   ```
2. `npm run typecheck && npm test && npm run lint` — all must pass

## Out of Scope

- Non-spacing properties (`width`, `height`, `font-size`, `border-radius`)
- Values without exact token match (`6px`, `10px`, `14px`)
- Token namespace changes (`--neon-*` → `--bde-*`) — separate plan
- Adding new tokens to the scale
- `tokens.css` itself — do not modify the token definitions
