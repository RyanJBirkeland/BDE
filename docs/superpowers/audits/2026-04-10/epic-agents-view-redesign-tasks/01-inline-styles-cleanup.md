# Inline-styles cleanup — AgentsView + AgentList

## Problem

`AgentsView.tsx` lines 264-405 are a sewer of inline `style={{}}` objects for the sidebar header, info icon, scratchpad tooltip, dismissable banner, and dismiss button. The CSS file `src/renderer/src/views/AgentsView.css` already declares matching class names (`agents-view__sidebar-header`, `agents-view__title`, `agents-view__spawn-btn`) but they are **dead code** — TSX uses inline styles instead. `AgentList.tsx` has the same problem at lines 195, 202, 232 (gradient backgrounds, border-bottom overrides). This is purely technical debt — no visual change should occur.

## Solution

Delete every inline `style={{}}` prop in `AgentsView.tsx` and `AgentList.tsx` and move the styles to CSS classes.

For `AgentsView.tsx`:

- Sidebar header (lines 264-272) → use existing `.agents-view__sidebar-header` class
- "Fleet" gradient title (lines 274-284) → use existing `.agents-view__title` class
- Info icon + tooltip (lines 285-332) → new classes `.agents-view__info-icon`, `.agents-view__tooltip`
- "+ New Agent" button (lines 334-355) → use existing `.agents-view__spawn-btn` class
- Scratchpad banner (lines 358-406) → new classes `.agents-view__scratchpad-banner`, `.agents-view__scratchpad-banner-text`, `.agents-view__scratchpad-banner-dismiss`

For `AgentList.tsx`:

- Inline `linear-gradient` background (line 195) → new class `.agent-list--gradient` or extend existing `.agent-list`
- Inline `borderBottom` (lines 202, 232) → new classes or extend `.agent-list__search-container`, `.agent-list__repo-chips`

**No visual change** — the new classes must produce the exact same rendered output. Use the browser inspector or screenshots to verify.

## Files to Change

- `src/renderer/src/views/AgentsView.tsx`
- `src/renderer/src/views/AgentsView.css`
- `src/renderer/src/components/agents/AgentList.tsx`
- `src/renderer/src/components/agents/AgentList.css`

## How to Test

1. **Zero inline styles in target files** (except where dynamically computed values force it):
   ```bash
   grep -nE 'style=\{\{' src/renderer/src/views/AgentsView.tsx src/renderer/src/components/agents/AgentList.tsx | wc -l
   ```
   Expected: 0 (or document any genuinely unavoidable instances).
2. **Dead classes resurrected:**
   ```bash
   grep -n 'agents-view__sidebar-header\|agents-view__title\|agents-view__spawn-btn' src/renderer/src/views/AgentsView.tsx
   ```
   Expected: at least 3 matches (one per class, used in JSX `className`).
3. **No regression in tests:**
   ```bash
   npm run typecheck && npm test && npm run lint
   ```
   All must pass.
4. **No visual regression:** the Agents view sidebar header, info tooltip, and scratchpad banner must look pixel-identical to before the change. Spot-check by hovering the info icon and verifying the tooltip pops with the same width, padding, color, and content.

## Out of Scope

- Any visual changes (typography, spacing, color, layout, panel size)
- Changes to `AgentCard.tsx`, `AgentCard.css`, or any other file
- Restructuring sidebar sections, search, repo chips
- Touching the cockpit pane (right side)
- Spawn modal flow or `LaunchpadGrid`
