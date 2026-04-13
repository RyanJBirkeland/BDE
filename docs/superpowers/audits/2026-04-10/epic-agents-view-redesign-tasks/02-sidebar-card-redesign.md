# Sidebar card redesign + panel resize

## Problem

The `AgentList` sidebar today is 20% wide with tiny `AgentCard`s — it functions as a navigation widget instead of the multi-agent observability surface BDE needs. Cards are ~56px tall with a 12px task title, a single `Bot · sonnet · 6m · BDE` meta strip separated by `·` bullets, single-letter source icons (`Bot`/`Cpu`), and no visual hierarchy between running and terminal-state agents. The default sidebar width also collapses to a useless skinny strip on small screens (min 12%).

## Solution

Restructure `AgentCard.tsx` and `AgentCard.css` to a 3-row layout, replace the panel size defaults, and adopt lucide icons for the meta strip.

**Card structure (3 rows):**

1. **Title row:** status icon (existing `StatusIndicator`) + task title (13px, weight 600, wraps to 2 lines, max 80 chars truncated with ellipsis) + kill button (existing, when running) + small model badge in top-right
2. **Status row:**
   - Running: empty (live activity row deferred — see spec Open Question #1)
   - Done: `Completed in <duration>`
   - Failed/Cancelled: `Failed: <reason>` or `Cancelled`
3. **Meta strip:** `Clock` icon + duration • `DollarSign` icon + cost • repo as small text — all using lucide icons (replacing the bullet-separated text strip)

**Card dimensions:** target ~96-120px tall (was ~56px), 12px internal padding.
**Hover:** add accent-tinted box-shadow glow + 1px accent border (no background change).
**Selected:** keep existing `scale(1.02)` + glow.

**Panel resize in `AgentsView.tsx`:** change `<Panel defaultSize={20} minSize={12} maxSize={40}>` to `<Panel defaultSize={28} minSize={18} maxSize={44}>`.

Use existing tokens — no new color, spacing, or font tokens added. lucide-react is already imported across the codebase.

## Files to Change

- `src/renderer/src/components/agents/AgentCard.tsx`
- `src/renderer/src/components/agents/AgentCard.css`
- `src/renderer/src/views/AgentsView.tsx` (panel size attributes only — DO NOT touch the inline-styles refactored by task 01)

## How to Test

1. **Panel size confirmed:**
   ```bash
   grep -n 'defaultSize=' src/renderer/src/views/AgentsView.tsx
   ```
   Expected: `defaultSize={28} minSize={18} maxSize={44}`.
2. **Lucide icons in card:**
   ```bash
   grep -n "from 'lucide-react'" src/renderer/src/components/agents/AgentCard.tsx
   ```
   Expected: imports `Clock`, `DollarSign` (plus existing `Bot`, `CheckCircle`, etc.).
3. **No `·` bullet separators in JSX:**
   ```bash
   grep -c '·' src/renderer/src/components/agents/AgentCard.tsx
   ```
   Expected: 0.
4. **Tests pass after assertion updates:**
   ```bash
   npm run typecheck && npm test && npm run lint
   ```
   `AgentCard.test.tsx` will need new selectors/assertions for the 3-row structure. Update tests to match.
5. **Visual smoke test:** sidebar visibly wider, cards taller and more readable, hover state shows glow.

## Out of Scope

- Live activity row (`▶ Currently: editing src/api.ts`) — deferred per spec Open Question #1
- Tool icon row (last 5 tools) — deferred to avoid the same data-binding cost
- Any changes to AgentList sections, search, repo chips, keyboard nav
- Cockpit pane (right side)
- Console header growth (separate task 03)
- Empty state (separate task 07)
