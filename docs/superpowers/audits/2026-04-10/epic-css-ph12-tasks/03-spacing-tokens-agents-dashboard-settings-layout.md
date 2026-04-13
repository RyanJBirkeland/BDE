# Spacing token adoption — agents + dashboard + settings + layout components

## Problem

CSS files in the agents, dashboard, settings, layout, git-tree, panels, and help components use hardcoded pixel values for `gap`, `padding`, and `margin` instead of the `--bde-space-*` design tokens.

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

- `src/renderer/src/components/agents/LaunchpadGrid.css`
- `src/renderer/src/components/agents/PlaygroundModal.css`
- `src/renderer/src/components/agents/AgentConsole.css`
- `src/renderer/src/components/agents/ConsoleSearchBar.css`
- `src/renderer/src/components/agents/ConsoleHeader.css`
- `src/renderer/src/components/agents/CommandBar.css`
- `src/renderer/src/components/agents/AgentList.css`
- `src/renderer/src/components/agents/CollapsibleBlock.css`
- `src/renderer/src/components/agents/ConsoleLine.css`
- `src/renderer/src/components/dashboard/CenterColumn.css`
- `src/renderer/src/components/dashboard/ActivitySection.css`
- `src/renderer/src/components/dashboard/StatusRail.css`
- `src/renderer/src/components/settings/MemorySection.css`
- `src/renderer/src/components/settings/RepositoriesSection.css`
- `src/renderer/src/components/settings/CostSection.css`
- `src/renderer/src/components/settings/SettingsCard.css`
- `src/renderer/src/components/settings/ConnectionsSection.css`
- `src/renderer/src/components/settings/AboutSection.css`
- `src/renderer/src/components/settings/AppearanceSection.css`
- `src/renderer/src/components/settings/SettingsSidebar.css`
- `src/renderer/src/components/settings/SettingsPageHeader.css`
- `src/renderer/src/components/layout/UnifiedHeader.css`
- `src/renderer/src/components/layout/NeonSidebar.css`
- `src/renderer/src/components/layout/NotificationBell.css`
- `src/renderer/src/components/layout/TearoffShell.css`
- `src/renderer/src/components/layout/CommandPalette.css`
- `src/renderer/src/components/layout/ToastContainer.css`
- `src/renderer/src/components/git-tree/InlineDiffDrawer.css`
- `src/renderer/src/components/git-tree/FileTreeSection.css`
- `src/renderer/src/components/git-tree/GitFileRow.css`
- `src/renderer/src/components/git-tree/BranchSelector.css`
- `src/renderer/src/components/panels/PanelLeaf.css`
- `src/renderer/src/components/help/FeatureGuideModal.css`

## How to Test

1. Grep for remaining hardcoded tokenizable values in the target directories — should return zero:
   ```bash
   grep -rnE '(gap|padding|margin)[^:]*:\s*[^;]*((?<![0-9])(4|8|12|16|20|24|32)px)' src/renderer/src/components/agents/*.css src/renderer/src/components/dashboard/*.css src/renderer/src/components/settings/*.css src/renderer/src/components/layout/*.css src/renderer/src/components/git-tree/*.css src/renderer/src/components/panels/*.css src/renderer/src/components/help/*.css
   ```
2. `npm run typecheck && npm test && npm run lint` — all must pass

## Out of Scope

- Non-spacing properties (`width`, `height`, `font-size`, `border-radius`)
- Values without exact token match (`6px`, `10px`, `14px`)
- Token namespace changes (`--neon-*` → `--bde-*`) — separate plan
- Adding new tokens to the scale
