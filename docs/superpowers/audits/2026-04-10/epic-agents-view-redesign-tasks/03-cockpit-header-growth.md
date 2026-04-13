# Cockpit header growth + typography

## Problem

`ConsoleHeader` is 32px tall and the task title — _the most important text on the screen_ — renders at 12px. The meta strip (duration · phase · cost · ctx) uses 10px text. Status dot is a flat 8px circle with no glow. The header reads as a thin strip, not a header. Action buttons feel cramped.

## Solution

Grow the header from 32px to 56px and apply typography updates from the redesign spec Section 4. Visual polish only — no structural change to the JSX, no new buttons, no new data sources.

**Changes in `ConsoleHeader.css`:**

- `.console-header { height: 32px → 56px }`
- `.console-header { padding: 0 var(--bde-space-3) → 0 var(--bde-space-4) }`
- `.console-header__task-name { font-size: 12px → 15px; font-weight: 600 → 700 }`
- `.console-header__meta { font-size: 10px → 11px }`
- `.console-header__status-dot { width: 8px → 10px; height: 8px → 10px }`
- `.console-header__status-dot--running` add subtle accent glow: `box-shadow: 0 0 8px var(--bde-accent)`
- `.console-header__action-btn { padding: var(--bde-space-1) → var(--bde-space-2) }`

**Changes in `ConsoleHeader.tsx`:**

- No structural restructuring required — the existing layout flows fine at 56px.
- Remove the inline `style={{}}` props on the task name span (lines 169-178) — replace with the existing `.console-header__task-name` class which already exists.
- Remove the inline `style={{ opacity: 0.8 }}` on the phase span (line 194) — add to `.console-header__phase` class instead.

Use existing `--bde-space-*` and color tokens. No new tokens.

## Files to Change

- `src/renderer/src/components/agents/ConsoleHeader.tsx`
- `src/renderer/src/components/agents/ConsoleHeader.css`

## How to Test

1. **Header height confirmed:**
   ```bash
   grep -n 'height:' src/renderer/src/components/agents/ConsoleHeader.css
   ```
   Expected: `height: 56px` on `.console-header`.
2. **Task name font size:**
   ```bash
   grep -A1 'console-header__task-name' src/renderer/src/components/agents/ConsoleHeader.css | grep font-size
   ```
   Expected: `font-size: 15px`.
3. **No inline styles on task name or phase span:**
   ```bash
   grep -n 'style=\{\{' src/renderer/src/components/agents/ConsoleHeader.tsx
   ```
   Expected: 0 matches (or document any unavoidable dynamic ones).
4. **Tests pass:**
   ```bash
   npm run typecheck && npm test && npm run lint
   ```
   `ConsoleHeader.test.tsx` may need to update selectors that depended on the previous DOM size.

## Out of Scope

- Anything in `AgentConsole.tsx` or the body (`ConsoleLine`/cards)
- New header buttons or actions
- New data displayed in the meta strip
- Task title editing or interaction
- The empty state (separate task 07)
- Sidebar / fleet (separate task 02)
- Confirm modal styling
