# Spacing token adoption — IDE + diff components

## Problem

CSS files in the IDE and diff components use hardcoded pixel values for `gap`, `padding`, and `margin` instead of the `--bde-space-*` design tokens. This makes spacing inconsistent and harder to maintain across themes and density modes.

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

- `src/renderer/src/components/ide/QuickOpenPalette.css`
- `src/renderer/src/components/ide/EditorPane.css`
- `src/renderer/src/components/ide/EditorTabBar.css`
- `src/renderer/src/components/ide/FileSidebar.css`
- `src/renderer/src/components/ide/EditorBreadcrumb.css`
- `src/renderer/src/components/ide/FileTree.css`
- `src/renderer/src/components/ide/FileTreeNode.css`
- `src/renderer/src/components/ide/EditorToolbar.css`
- `src/renderer/src/components/ide/TerminalPanel.css`
- `src/renderer/src/components/diff/DiffViewer.css`
- `src/renderer/src/components/diff/DiffCommentWidget.css`
- `src/renderer/src/components/diff/PlainDiffContent.css`
- `src/renderer/src/components/diff/DiffCommentComposer.css`
- `src/renderer/src/components/diff/DiffFileList.css`

## How to Test

1. Grep for remaining hardcoded tokenizable values — should return zero:
   ```bash
   grep -nE '(gap|padding|margin)[^:]*:\s*[^;]*((?<![0-9])(4|8|12|16|20|24|32)px)' src/renderer/src/components/ide/*.css src/renderer/src/components/diff/*.css
   ```
2. `npm run typecheck && npm test && npm run lint` — all must pass

## Out of Scope

- Non-spacing properties (`width`, `height`, `font-size`, `border-radius`)
- Values without exact token match (`6px`, `10px`, `14px`)
- Token namespace changes (`--neon-*` → `--bde-*`) — separate plan
- Adding new tokens to the scale
