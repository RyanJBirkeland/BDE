# Card grammar — conversation cards

## Problem

After task 04 splits `ConsoleLine.tsx` into `cards/`, each card still renders the old `[prefix] content timestamp` log line shape — `[user]`, `[agent]`, `[think]`, `[error]`, `[stderr]`, `[rate]`. They look identical to a colored log file. This task replaces those simple/conversational card types with the new card grammar from the design spec Section 3.

## Solution

Update these cards to render with the new card chrome (12px padding, 12px vertical gap, accent border-left where appropriate, no `[prefix]` text tags). **Do NOT touch tool cards** (`ToolCallCard`, `ToolPairCard`, `ToolGroupCard`) — those are task 06.

**Per-card visual changes:**

1. **`StartedCard.tsx`** — small one-line dim card: `🤖 Agent started · model <model> · <time>`. Remove the `[agent]` prefix span.
2. **`UserMessageCard.tsx`** — right-aligned chat bubble (max-width 70%, accent surface background). Remove `[user]` prefix. Keep pending opacity 0.6.
3. **`TextCard.tsx`** — full-width card with markdown rendered via existing `renderAgentMarkdown()`. Remove `[agent]` prefix. No flex line shape.
4. **`ThinkingCard.tsx`** — show **first ~120 chars of `block.text` as a preview** by default (no click required). Click → `CollapsibleBlock` expands to full text. Add `💭 Reasoning · <token count>` header. Distinct purple border-left.
5. **`ErrorCard.tsx`** — full-width red border-left card. Remove `[error]` prefix. Always-visible message.
6. **`StderrCard.tsx`** — yellow border-left, smaller text. Remove `[stderr]` prefix.
7. **`RateLimitedCard.tsx`** — yellow/orange accent. Show retry countdown text.

**Card chrome CSS** (add to `cards/ConsoleCard.css`):

- `.console-card { padding: var(--bde-space-3); margin-bottom: var(--bde-space-3); border-radius: 6px; }`
- Hover: `box-shadow: 0 0 12px var(--bde-accent-glow); border: 1px solid var(--bde-accent-border);`
- `.console-card__header { display: flex; align-items: center; gap: var(--bde-space-2); font-size: 11px; }`
- Per-type accent classes: `.console-card--user`, `.console-card--text`, `.console-card--reasoning`, `.console-card--error`, `.console-card--stderr`, `.console-card--rate`
- Each gets a `border-left: 3px solid <token>;` matching its identity color

**Timestamps:** drop per-line timestamps from these cards. (Minute-grouped labels are out of scope for this task — implementer can add them as a follow-up if simple.)

**Markdown reuse:** `renderAgentMarkdown()` is unchanged — just called in a different visual container.

## Files to Change

- `src/renderer/src/components/agents/cards/ConsoleCard.css` (add card chrome + per-type classes)
- `src/renderer/src/components/agents/cards/StartedCard.tsx`
- `src/renderer/src/components/agents/cards/UserMessageCard.tsx`
- `src/renderer/src/components/agents/cards/TextCard.tsx`
- `src/renderer/src/components/agents/cards/ThinkingCard.tsx`
- `src/renderer/src/components/agents/cards/ErrorCard.tsx`
- `src/renderer/src/components/agents/cards/StderrCard.tsx`
- `src/renderer/src/components/agents/cards/RateLimitedCard.tsx`

## How to Test

1. **No `[agent]`/`[user]`/`[think]`/`[error]`/`[stderr]`/`[rate]` prefix text** in these card files:
   ```bash
   grep -nE '\[(agent|user|think|error|stderr|rate)\]' src/renderer/src/components/agents/cards/{Started,UserMessage,Text,Thinking,Error,Stderr,RateLimited}Card.tsx
   ```
   Expected: 0 matches.
2. **`ThinkingCard` shows preview without expansion:** verify the rendered DOM contains the first ~120 chars of `block.text` as visible content (not just the token count).
3. **`UserMessageCard` is right-aligned:** verify CSS class includes `.console-card--user` with `margin-left: auto` or equivalent.
4. **Tests pass:**
   ```bash
   npm run typecheck && npm test && npm run lint
   ```
   Update test assertions to look for new class names instead of old `console-prefix--*` selectors.

## Out of Scope

- Tool cards (ToolCall, ToolPair, ToolGroup) — task 06
- EditDiffCard — task 06
- Bash command card — task 06
- Read card — task 06
- Completion card visual changes (already a card, kept as-is)
- Playground card visual changes (kept as-is)
- Lucide tool icon replacements — task 06
- Sidebar / fleet (task 02)
- Header (task 03)
- Empty state (task 07)
- Minute-grouped timestamp labels (deferred)
