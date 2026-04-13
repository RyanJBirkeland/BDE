# Agents View Redesign — Design Spec

**Date:** 2026-04-10
**Status:** Draft
**Scope:** Visual + layout redesign of the Agents view (style only — no functionality changes, no new features, no IPC/store changes)
**Supersedes (visual layer only):** `2026-03-25-neon-agents-view-redesign-design.md`, `2026-03-26-agent-console-polish-design.md`, `2026-03-23-agents-view-polish-design.md`

---

## TL;DR

The current Agents view implements a "terminal-aesthetic log viewer" — every event is `[prefix] content timestamp`, tool icons are single letters in colored boxes, and the sidebar is a 20%-wide navigation widget. It works, but it isn't meaningfully better than terminal Claude Code, which contradicts BDE's stated value proposition (_"a steering system for Claude Code at scale"_ — README, line 5). This spec replaces the line-based log metaphor with a **card grammar** and elevates the **fleet sidebar** from a navigation widget to the primary observability surface. No functionality is added or removed.

---

## Context

### What this view is for

Per the README:

> _"5 active Claude Code sessions running in parallel. Each shows live tool calls, edits, and bash commands as they happen."_ (Agents view caption, README:169)

> _"You should be able to look at one screen and know exactly what's happening across all your concurrent work — then make decisions (review, retry, reprioritize) without holding any of it in your head."_ (README:45)

The Agents view's job is **multi-agent observability**. It's where users go to see what their fleet of pipeline + ad-hoc Claude Code sessions are doing right now, and to drill into any one of them when needed. The view is _not_ the place where users issue specs (Task Workbench), monitor the queue (Sprint Pipeline), or review finished work (Code Review Station). It is the place where they _watch agents work_.

### History

Three prior specs touched this view:

1. **`2026-03-23-agents-view-polish-design.md`** — first pass, "chat-first IDE-dense" layout with tabbed Chat/Tools/Files panes. Partially implemented.
2. **`2026-03-25-neon-agents-view-redesign-design.md`** — full "neon command center" vision with three stacked zones (live activity strip + fleet+console + timeline waterfall). Section 1 (stacked zones) was abandoned. Section 2 (terminal-aesthetic console with `[prefix]` lines) was implemented and is what ships today.
3. **`2026-03-26-agent-console-polish-design.md`** — surface-level polish (markdown rendering, single-letter tool icons, completion card). Implemented.

The current view is the union of (3) and the console part of (2). The fleet sidebar from (1) survived structurally but never received its visual upgrade.

### Why redesign now

The user has lived with the terminal-aesthetic console for 2+ weeks and reported it as "buggy and annoying" — _"it functionally works but it's not better than terminal Claude Code, which is what I'm talking to you through. I want it to be 10x the experience of Claude Code."_ The terminal-aesthetic experiment validated that the data flow works and the events are right, but the _visual language_ is a ceiling. By definition, a colored log viewer cannot be "10x better" than terminal Claude Code — it's the same shape rendered in HTML.

---

## Diagnosis

### Findings from code review

| #   | Finding                                                                                                                                                                                                                                                                                                                                                  | Location                                                              | Severity           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------ |
| 1   | Tool "icons" are single letters (`$`, `R`, `E`, `W`, `?`, `F`, `A`) in 18px boxes — `lucide-react` is imported across the codebase but unused here                                                                                                                                                                                                       | `ConsoleLine.tsx:41-51`, `ConsoleLine.css:115-157`                    | High               |
| 2   | All event types render with the same `[prefix] content timestamp` flex shape — no visual hierarchy between user message, tool call, reasoning, error                                                                                                                                                                                                     | `ConsoleLine.tsx:74-373`                                              | High               |
| 3   | Tool group rendering = text (`"5 tool calls (3 read, 2 edit)"`) instead of an icon row                                                                                                                                                                                                                                                                   | `ConsoleLine.tsx:303-348`                                             | Med                |
| 4   | Tool input/output expansion is `<pre>{JSON.stringify(input)}</pre>` — for an `edit` tool, that's a wrapped JSON blob, not a diff                                                                                                                                                                                                                         | `ConsoleLine.tsx:202-214`                                             | High               |
| 5   | The completion card (`ConsoleLine.tsx:254-301`) is the right visual language _and only renders once_, at the end of an agent run — the rest of the body reverts to log lines                                                                                                                                                                             | `ConsoleLine.tsx:254-301`, `ConsoleLine.css:160-225`                  | High               |
| 6   | Body font 12px, timestamps 10px, header meta 10px, tool icon 10px font — everything fits but nothing breathes                                                                                                                                                                                                                                            | `ConsoleLine.css:8`, `ConsoleHeader.css:51`                           | Med                |
| 7   | Timestamps render on every line — adds visual noise where most users scan once                                                                                                                                                                                                                                                                           | `ConsoleLine.tsx:80, 94, 107, 122, 148, 191, 227, 239, 250, 332, 369` | Low                |
| 8   | `AgentsView.tsx` lines 264-405 are an inline-styles sewer (sidebar header, info icon, tooltip, scratchpad banner, dismiss button). The CSS file `AgentsView.css` already declares matching class names (`agents-view__sidebar-header`, `agents-view__title`, `agents-view__spawn-btn`) but they are **dead code** — TSX uses inline `style={{}}` instead | `AgentsView.tsx:264-405`, `AgentsView.css:1-55`                       | High (code health) |
| 9   | `.console-line:hover { background: var(--bde-border) }` — generic hover, no elevation, no glow, no border change. Doesn't feel "neon" at all                                                                                                                                                                                                             | `ConsoleLine.css:13-15`                                               | Med                |
| 10  | `AgentList.tsx` has inline `linear-gradient` and `borderBottom` style overrides at lines 195, 202, 232 — same pattern as #8                                                                                                                                                                                                                              | `AgentList.tsx:194-198, 200-203, 232-236`                             | Med                |
| 11  | The Scratchpad info-icon tooltip and the dismissable banner display **identical copy** in two places, both inline-styled                                                                                                                                                                                                                                 | `AgentsView.tsx:305-331, 358-406`                                     | Low                |
| 12  | Markdown content (bold, code, headings) renders inside the same horizontal flex shape as a one-line file read — multi-paragraph thinking gets cramped into a 12px row                                                                                                                                                                                    | `ConsoleLine.tsx:84-97`, `ConsoleLine.css:92-114`                     | Med                |
| 13  | Reasoning (`thinking`) collapses to "Thinking… 234 tokens" — the value of seeing the agent's reasoning is hidden behind a click                                                                                                                                                                                                                          | `ConsoleLine.tsx:111-131`                                             | Low                |
| 14  | Header is 32px and the _task title_ — the most important thing on the screen — renders at 12px                                                                                                                                                                                                                                                           | `ConsoleHeader.css:2-12, 41-45`                                       | High               |

### The meta-finding

The completion card (`ConsoleLine.tsx:254-301`) and `NeonCard` (used in `AgentCard.tsx`) prove the team already knows what good looks like in this codebase. The infrastructure is there. The problem is that **the card language stops at the edges of the stream** — the body itself reverts to a log file. So the redesign is not "invent new design language" — it's _"extend the existing card language into the body and the sidebar."_

---

## Vision

The Agents view should make a user running 6 parallel Claude Code sessions feel like they walked into a control room. Glance left → see all 6 agents and what they're doing. Click one → drill into a structured, scannable conversation that respects the cognitive-load thesis from the README. No reading walls of log text. No squinting at 10px timestamps. No clicking into 5 collapsibles to find the one error.

Three principles:

1. **The fleet sidebar is the headline.** Today it's a navigation widget. After this redesign it's the primary information surface — bigger, richer, ambient.
2. **The cockpit speaks card grammar.** Every event is a card with a clear visual identity. Cards group naturally. Detail expands on demand. The completion-card style becomes the visual language of the whole view, not a one-off ending.
3. **Density goes down, signal goes up.** Bigger fonts, real lucide icons, breathing room, hover/focus that actually feels neon. The view should feel like a _room_, not a wall.

---

## Section 1 — Layout & Flow

### Today

```
┌──────────┬──────────────────────────────────────┐
│  FLEET   │  ConsoleHeader (32px)                │
│ (20%)    ├──────────────────────────────────────┤
│ ▸ Run    │                                      │
│ ▸ Recent │  Console Body                        │
│ ▸ Hist.  │  (virtualized log lines)             │
│          │                                      │
│ tiny     │                                      │
│ cards    │                                      │
│          ├──────────────────────────────────────┤
│          │  Command Bar                         │
└──────────┴──────────────────────────────────────┘
```

### Proposed

```
┌────────────────────┬────────────────────────────────────────┐
│  FLEET             │  COCKPIT HEADER (~56px, was 32px)      │
│  (~28%, was 20%)   │  ●  Task title (15px, prominent)       │
│                    │  cyan glow · model badge · meta strip  │
│  ┌──────────────┐  ├────────────────────────────────────────┤
│  │ ● running    │  │                                        │
│  │ task title   │  │  COCKPIT BODY                          │
│  │ ▶ editing    │  │  (card-based event stream)             │
│  │   src/api.ts │  │                                        │
│  │ R E E $ R    │  │  ┌──────────────────────────────────┐ │
│  │ $0.04 6m23s  │  │  │ 💭 Reasoning                    │ │
│  └──────────────┘  │  │ planning the refactor…          │ │
│                    │  └──────────────────────────────────┘ │
│  ┌──────────────┐  │  ┌──────────────────────────────────┐ │
│  │ ✓ done       │  │  │ ⚙ Step • 4 actions              │ │
│  │ task title   │  │  │ R R E ✏ — diff preview…         │ │
│  │ $1.20 12m    │  │  └──────────────────────────────────┘ │
│  └──────────────┘  │  ┌──────────────────────────────────┐ │
│                    │  │ 👤 You                          │ │
│  ┌──────────────┐  │  │ "scope to src/main only"        │ │
│  │ ⚠ error      │  │  └──────────────────────────────────┘ │
│  │ task title   │  │                                        │
│  │ exit 1 · ret │  │                                        │
│  └──────────────┘  ├────────────────────────────────────────┤
│                    │  Command Bar (subtle visual polish)    │
└────────────────────┴────────────────────────────────────────┘
       ~28%                          ~72%
```

### Layout changes

| Element               | Today                                           | Proposed                                                          | Why                                                               |
| --------------------- | ----------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| Default sidebar width | 20% (12-40 range)                               | 28% (18-44 range)                                                 | Sidebar is the headline, not a navigation widget                  |
| Sidebar min/max       | min 12% / max 40%                               | min 18% / max 44%                                                 | Prevents collapse to a useless skinny strip                       |
| Sidebar header        | 36px, ~140 lines of inline `style={{}}` in TSX  | ~44px, all CSS classes, dead `AgentsView.css` classes resurrected | Code health + room to breathe                                     |
| Cockpit header        | 32px, 12px task title                           | ~56px, 15px task title, 11px meta strip                           | The most important thing on the screen is currently invisible     |
| Cockpit body          | virtualized `ConsoleLine` rows                  | virtualized cards (`ConsoleCard`) with vertical rhythm            | The whole point of the redesign                                   |
| Command bar           | bottom of cockpit                               | structurally unchanged — visual polish only                       | Working interaction; preserve                                     |
| Spawn launchpad       | full-pane takeover when `showLaunchpad` is true | structurally unchanged — full-pane takeover; visual polish only   | Spawn flow preserved per user direction                           |
| Empty state           | tiny `EmptyState` component, dead center        | "Fleet at a Glance" panel — see Section 6                         | Walking in with no selection should still give fleet-level signal |

### Things explicitly NOT changing in this section

- Two-pane resizable layout (`react-resizable-panels` Group + Panel + Separator)
- Section grouping (Running / Recent / History) inside the sidebar
- Search input, repo chip filter, keyboard navigation (arrow keys), history collapse, load-more button
- Spawn flow: `+` button → `AgentLaunchpad` modal → `LaunchpadGrid`
- Scratchpad info tooltip + dismissable banner (rebuilt in CSS classes, same content + behavior)
- `ConsoleSearchBar` (Cmd+F overlay)
- `agent:clear-console` event flow
- The `CommandBar`'s existing interactions (steering, slash commands, attachments, autocomplete)

---

## Section 2 — Fleet Card Anatomy

### The card states

The sidebar contains three sections (Running / Recent / History) and within each, agent cards. Today each card is ~56px tall with a 12px task title, a single-row meta strip (`Bot · sonnet · 6m · BDE`), and a kill button. Proposed: ~96-120px tall with three rows of structured information.

#### Running card

```
┌────────────────────────────────────┐
│ ● task title goes here, can wrap to│
│   two lines if it gets long        │
│                                    │
│ ▶ Currently: editing src/api.ts    │  ← live activity (stretch — see notes)
│                                    │
│ 🖥 R 📝 E ✏ R                      │  ← last 5 tool icons (lucide, not letters)
│                                    │
│ ⏱ 6m23s   💰 $0.04   bde           │  ← meta strip with icons
└────────────────────────────────────┘
```

- Status dot: pulsing cyan (existing `agent-card__status-spinner` animation, kept)
- Selected: existing scale + glow treatment (`AgentCard.tsx:115-118`)
- Hover: subtle elevation + accent border, not just background change

#### Done / Recent card

```
┌────────────────────────────────────┐
│ ✓ task title (success)             │
│                                    │
│ Completed in 12m · 4 commits       │
│                                    │
│ ⏱ 12m04s   💰 $1.20   bde          │
└────────────────────────────────────┘
```

- Check icon in muted purple (existing `STATUS_ACCENTS.done = 'purple'`)
- "Completed in X" line replaces the live activity row when the agent has finished

#### Failed / Error card

```
┌────────────────────────────────────┐
│ ⚠ task title                       │
│                                    │
│ Failed: exit code 1 · retry 2/3    │
│                                    │
│ ⏱ 1m20s    💰 $0.08                │
└────────────────────────────────────┘
```

- X / Ban icon in red or orange
- Error context line replaces the activity/completion row

### Required: live activity row

The "▶ Currently: editing src/api.ts" line is the new visual element that makes the running card _feel alive_. It reads the most recent meaningful event from `agentEvents` store for that agent's id and renders a one-line summary:

- If most recent is a tool call → "running tests" / "editing `src/api.ts`" / "reading 4 files" / "thinking…"
- If most recent is text → first 60 chars of text
- If most recent is reasoning → "thinking…" with the token count
- If running but no events yet → "starting…"

Implementation note: this _uses_ existing data — no new IPC, no new store, no new tables. The data is in the `agentEvents` store today; it's just not bound to the sidebar card. Categorized as a style change because it surfaces existing data in a new place.

If wiring the live activity row turns out to be more invasive than expected during plan-writing (e.g. requires lifting state from cockpit to sidebar in a way that hurts virtualization), it can be deferred to a follow-up. Without it the cards still ship the typography + lucide-icon row + breathing room — that alone is a major upgrade. **The redesign is not blocked on this row.**

### Tool icon row

`AgentCard` should show the last 5 tool icons used by the agent (in chronological order, oldest left, newest right). Each icon is a 16px lucide component in the same color as the cockpit body uses (see Section 4). When the agent is running, the row updates as new tool calls arrive — same data binding as the live activity row.

For terminal-status cards (done/failed/cancelled), the tool icon row is omitted to keep the card compact.

### Meta strip with icons

Replace the bullet-separated text strip (`Bot · sonnet · 6m · BDE`) with an icon strip:

- ⏱ duration (lucide `Clock`)
- 💰 cost (lucide `DollarSign`)
- repo as a small chip or tag (existing `bde` text styling)

Model name moves to a small badge in the card's top-right corner (mirrors `ConsoleHeader`'s `NeonBadge`).

---

## Section 3 — Cockpit Card Grammar

The cockpit body becomes a vertical stream of cards instead of a vertical stream of log lines. Each event type maps to a card pattern. Cards group naturally (multiple back-to-back tool calls become one "step" card). Detail expands on demand.

### Visual rhythm

- Cards are full-width minus 16px gutters on each side
- Vertical gap between cards: 12px (was 4px between log lines)
- Internal card padding: 12-16px (was 4-8px)
- Cards can have full-bleed accent borders on the left edge for type differentiation

### Card types

#### 1. Started card (small, one per session)

```
┌──────────────────────────────────────────────────────┐
│ 🤖 Agent started · model claude-opus-4-6 · 14:22:01  │
└──────────────────────────────────────────────────────┘
```

- Small, 1-line, dim
- Always at the top of the stream

#### 2. User message card (right-aligned chat bubble)

```
                            ┌─────────────────────────┐
                            │ 👤 You                  │
                            │ scope to src/main only  │
                            └─────────────────────────┘
```

- Right-aligned, max-width ~70%
- Accent surface background (existing `chat-bubble--user` style)
- "Pending" state when optimistic — opacity 0.6 (existing `console-line--pending`)

#### 3. Agent text card (full-width, prose-rendered)

```
┌──────────────────────────────────────────────────────┐
│ 💬 Agent · 14:23:12                                  │
│                                                      │
│ I've reviewed the file. Here are the issues I found: │
│                                                      │
│ 1. The validation regex doesn't handle edge cases    │
│ 2. The error message swallows context                │
│                                                      │
│ Let me start with the regex.                         │
└──────────────────────────────────────────────────────┘
```

- Full width of the cockpit body minus gutters
- Markdown rendered properly: headings break the flow, code blocks get their own background, lists indent
- No `[agent]` prefix — the card identity is the visual chrome, not a text tag
- Existing `renderAgentMarkdown()` from `lib/render-agent-markdown.tsx` is reused

#### 4. Reasoning ("thinking") card

```
┌──────────────────────────────────────────────────────┐
│ 💭 Reasoning · 234 tokens                       [▾]  │
│                                                      │
│ Looking at the current implementation, I notice…    │
│ (preview of first ~120 chars, rest expands on click) │
└──────────────────────────────────────────────────────┘
```

- Distinct visual identity (faint purple border-left, italic preview)
- _Preview is visible by default_ — today the entire reasoning is hidden behind a click. Showing the first ~120 chars gives ambient signal without forcing the user to expand.
- Click → expands to full reasoning text (existing `CollapsibleBlock` mechanism preserved)

#### 5. Tool action card (single tool call)

```
┌──────────────────────────────────────────────────────┐
│ 📝 Edit · src/api.ts                       ✓   [▾]  │
│ Replaced 12 lines around line 84                     │
└──────────────────────────────────────────────────────┘
```

- Lucide icon by tool type (see Section 4 mapping)
- Tool name + summary on the header row
- Success/failure badge (existing `console-badge--success`/`--danger`, polished)
- Expand → shows tool input and output. **For Edit/Write, render as inline diff** (see "Special card: Edit diff" below). For Bash, show command + output preview. For Read, show file path + line range. For everything else, fall back to the existing JSON pretty-print.

#### 6. Tool group card (multiple tool calls grouped by `pair-events.ts`)

```
┌──────────────────────────────────────────────────────┐
│ ⚙ Step · 4 actions                              [▾]  │
│ 📖 📖 📝 ⏱  read 2 files, edit 1, ran tests          │
└──────────────────────────────────────────────────────┘
```

- Replaces the existing `tool_group` text rendering
- Header row: "Step · N actions"
- Sub-row: actual lucide icons for each tool, colored by type, in execution order
- Plus a one-line summary derived from the current `breakdown` logic
- Expand → shows each tool action as a nested action card (existing `CollapsibleBlock` content slot)

#### 7. Special card: Edit diff (Edit / Write tool result)

When a tool action card is for an `edit` or `write` tool and the input contains `old_string`/`new_string` or `content`, the _expanded view_ renders an inline diff instead of JSON:

```
┌──────────────────────────────────────────────────────┐
│ 📝 Edit · src/api.ts                       ✓   [▾]  │
│ Replaced 12 lines around line 84                     │
│ ┌───────────────────────────────────────────────┐    │
│ │ - const result = await fetch(url)             │    │
│ │ - if (!result.ok) throw new Error('failed')   │    │
│ │ + const result = await safeFetch(url, {       │    │
│ │ +   retries: 3,                                │    │
│ │ +   timeout: 5000                              │    │
│ │ + })                                           │    │
│ └───────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

- For `write` (whole file create), render the new content as a code block with line numbers (no diff, just the content)
- For `edit`, render an inline diff. Implementation note: the existing `PlainDiffContent` from `components/diff/` is **not** directly reusable — it's wired into Code Review's comment/selection system (file refs, hunk addresses, comment widgets). The clean reuse path is `parseDiff(raw: string): DiffFile[]` from `src/renderer/src/lib/diff-parser.ts`, fed a synthetic git-format diff string built from `old_string`/`new_string`. The resulting `DiffFile[]` then feeds a _new, minimal_ `EditDiffCard` renderer (~80 LOC) that draws each `DiffLine` (`add` / `del` / `ctx`) as a single styled row. No new dependencies; new component lives at `components/agents/cards/EditDiffCard.tsx`.

#### 8. Bash card (Bash tool result)

```
┌──────────────────────────────────────────────────────┐
│ 🖥 Bash                                    ✓   [▾]  │
│ npm test                                              │
│ ┌───────────────────────────────────────────────┐    │
│ │ $ npm test                                    │    │
│ │ ✓ 231 tests passing                            │    │
│ │ Coverage: 84%                                  │    │
│ └───────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

- Header: tool icon + "Bash" + success/failure badge
- Body: command on its own line (monospace, accent color)
- Expand → output in a code block (existing `console-line__json` styling, polished)

#### 9. Read card (Read tool result)

```
┌──────────────────────────────────────────────────────┐
│ 📖 Read · src/api.ts (lines 1-200)             ✓    │
└──────────────────────────────────────────────────────┘
```

- One-line card, no expand needed
- Path + optional line range from input
- Just acknowledges the read happened — most users don't want to see the file contents inline

#### 10. Error card

```
┌──────────────────────────────────────────────────────┐
│ ⚠ Error · 14:31:02                                  │
│                                                      │
│ Failed to write file: ENOENT: no such file or       │
│ directory, open '/tmp/missing/path.ts'               │
└──────────────────────────────────────────────────────┘
```

- Red border-left (existing `console-line--error` accent, kept)
- Full message visible — never collapsed
- Distinct from `tool_pair` failures, which use the `--danger` badge inside their card

#### 11. Stderr card

```
┌──────────────────────────────────────────────────────┐
│ ⚡ stderr                                             │
│ npm WARN deprecated foo@1.0.0                        │
└──────────────────────────────────────────────────────┘
```

- Yellow border-left
- Smaller text (these are usually noise)

#### 12. Rate-limited card

```
┌──────────────────────────────────────────────────────┐
│ ⏳ Rate limited · retry in 45s · attempt 2           │
└──────────────────────────────────────────────────────┘
```

- Yellow/orange accent
- Renders a live countdown if possible (existing data is `retryDelayMs`)

#### 13. Completion card (KEEP existing)

The existing `console-completion-card` (`ConsoleLine.tsx:254-301`, `ConsoleLine.css:160-225`) is the model for the entire card grammar — keep it as-is structurally. Apply the new typography tokens and any spacing adjustments from Section 4.

#### 14. Playground card (KEEP existing)

The existing playground click-to-open card (`ConsoleLine.tsx:351-372`) stays. May get a slightly larger preview area as visual treatment — but no functional changes.

### Timestamps: from per-line to grouped

Today every line shows a timestamp on the right. Proposed:

- Each card's header row optionally shows a timestamp on hover (CSS `:hover` reveal)
- Cards within the same minute share an _implicit_ group — no headers, just the card spacing
- When the _minute_ changes between two adjacent cards, a thin "14:23" timestamp label is rendered in the gutter

This kills 80% of the visible-timestamp noise without losing chronological context.

---

## Section 4 — Visual Tokens

### Typography

| Element                     | Today          | Proposed          | Notes                              |
| --------------------------- | -------------- | ----------------- | ---------------------------------- |
| Body / card content         | 12px           | 13px              | Still code-friendly, more readable |
| Card header text            | n/a            | 12px              | New element                        |
| Task title (cockpit header) | 12px           | 15px              | The most important text on screen  |
| Task title (sidebar card)   | inherits       | 13px / weight 600 | Wraps to 2 lines                   |
| Section headers (sidebar)   | 10px uppercase | 11px uppercase    | Slight breathing room              |
| Tool labels / badges        | 10px           | 11px              | Icon + label legibility            |
| Timestamps                  | 10px           | 10px (kept)       | Hover-only / minute-grouped        |
| Meta strip (cockpit header) | 10px           | 11px              | Duration · model · cost · ctx      |

All typography continues to use existing tokens — no new font sizes added to `tokens.ts`. Where the old hardcoded `12px` was used, swap to the appropriate `--bde-size-*` token (extending the token set if the right value isn't already there).

### Spacing

| Element                | Today                                     | Proposed                        |
| ---------------------- | ----------------------------------------- | ------------------------------- |
| Card internal padding  | `--bde-space-1` / `--bde-space-2` (4-8px) | `--bde-space-3` (12px)          |
| Card vertical gap      | implicit (line-height)                    | `--bde-space-3` (12px)          |
| Card horizontal gutter | none                                      | `--bde-space-3` (12px) per side |
| Sidebar item padding   | `--bde-space-2`                           | `--bde-space-3`                 |
| Cockpit header padding | `0 var(--bde-space-3)`                    | `0 var(--bde-space-4)`          |

All spacing continues to use the existing `--bde-space-*` token scale.

### Color & accent usage

No new color tokens. Continue using the existing palette in `neon.css` / `agents-neon.css` / `tokens.ts`:

- `--bde-accent` / `--bde-accent-border` / `--bde-accent-surface` — primary cyan
- `--bde-status-active` — purple (used today for `[think]` prefix and reasoning) — promote to be the _reasoning card_ identity
- `--bde-status-review` — used today for `[tool]` prefix — promote to be the _tool action card_ identity
- `--bde-warning` / `--bde-warning-surface` — yellow (stderr, rate limited)
- `--bde-danger` / `--bde-danger-surface` — red (error)
- `--bde-status-done` — green (user message accent, completion success)

### Tool icons (lucide-react replacements)

The current letter-in-a-box pattern (`ConsoleLine.tsx:41-51`) is replaced with lucide icons. `lucide-react` is already imported all over the codebase — no new dependency.

| Tool name        | Lucide icon | Token color                      |
| ---------------- | ----------- | -------------------------------- |
| `bash`           | `Terminal`  | `--bde-warning`                  |
| `read`           | `FileText`  | `--bde-status-review` (cyan-ish) |
| `edit`           | `Edit3`     | `--bde-accent`                   |
| `write`          | `FilePlus`  | `--bde-accent`                   |
| `grep`           | `Search`    | `--bde-status-active` (purple)   |
| `glob`           | `Folder`    | `--bde-warning`                  |
| `agent` / `task` | `Bot`       | `--bde-status-done`              |
| `list`           | `List`      | `--bde-text-muted`               |
| (default)        | `Wrench`    | `--bde-text-muted`               |

Icon sizes:

- Inline in card header: 16px
- In tool group icon row: 14px
- In sidebar fleet card tool row: 14px

### Hover & focus states

Today: `.console-line:hover { background: var(--bde-border) }` — generic, not "neon".

Proposed:

- Cards on hover: `box-shadow: 0 0 12px var(--bde-accent-glow)` + 1px accent border, no background change
- Sidebar cards on hover: same as above plus subtle `transform: translateY(-1px)` (existing `bde-transition-fast`)
- Sidebar cards selected: existing `scale(1.02)` + `box-shadow: 0 0 16px <accent>` (already in `AgentCard.tsx:115-118`, kept)
- Buttons on hover: existing patterns kept

---

## Section 5 — Component Refactor Scope

### Files to change

#### `src/renderer/src/views/AgentsView.tsx` (455 → ~280 LOC est)

- **Delete inline styles** at lines 264-405 (sidebar header, info icon, tooltip, scratchpad banner, dismiss button)
- Use existing CSS classes from `src/renderer/src/views/AgentsView.css` (the dead `agents-view__sidebar-header`, `agents-view__title`, `agents-view__spawn-btn` classes — see file change below)
- Update `<Panel defaultSize={20} minSize={12} maxSize={40}>` → `<Panel defaultSize={28} minSize={18} maxSize={44}>`
- Replace empty-state `<EmptyState title="No agent selected" ... />` with new `<FleetGlance />` component (Section 6)
- All other logic unchanged: command palette registration, agent selection, spawn modal trigger, steering, command handlers

#### `src/renderer/src/views/AgentsView.css` (90 LOC, additive)

Note the path: this file lives in `views/`, not `components/agents/`. It's the only CSS file in this redesign that does — every other touched CSS file is co-located with its component under `components/agents/`.

- Existing classes `agents-view__sidebar-header`, `agents-view__title`, `agents-view__spawn-btn` are currently dead — wire them up by removing their inline-style equivalents from `AgentsView.tsx`
- Add new classes for the scratchpad info-icon tooltip (`.agents-view__tooltip`, `.agents-view__tooltip-strong`)
- Add new classes for the dismissable scratchpad banner (`.agents-view__scratchpad-banner`, `.agents-view__scratchpad-banner-dismiss`)
- Existing layout rules (`.agents-view`, `.agents-sidebar`, panel min-width override) are kept

#### `src/renderer/src/components/agents/AgentList.tsx` (427 LOC, mostly unchanged)

- Remove inline `style={{ background: linear-gradient(...) }}` at line 195 — move to CSS
- Remove inline `borderBottom` at lines 202, 232 — move to CSS
- All other logic unchanged: search, repo chips, grouping, keyboard nav

#### `src/renderer/src/components/agents/AgentCard.tsx` (176 → ~220 LOC est)

- Restructure JSX from 2-row meta strip to 3-row card layout (title row · activity row · meta strip)
- Remove inline `style={{}}` props for accents — move to CSS
- Add tool icon row component (small inline subcomponent or shared util)
- Add live activity row reading from `agentEvents` store (stretch — see Section 2 notes)
- Replace `Bot`/`Cpu` source icon prefix with model badge in top-right
- Use lucide icons for meta strip (`Clock`, `DollarSign`)

#### `src/renderer/src/components/agents/AgentCard.css` (existing, restructure)

- New layout: `display: grid; grid-template-rows: auto auto auto auto;` or flex column
- Add `--card-padding`, hover/selected styles
- Remove dependency on inline styles

#### `src/renderer/src/components/agents/ConsoleHeader.tsx` (267 LOC, minor)

- Increase header height: 32px → 56px
- Restructure layout into 2 visual rows (or larger single row): title row + meta strip
- Larger task title (15px, weight 600)
- Status dot grows slightly (8px → 10px) and gets accent glow
- Action buttons get more padding (existing `console-header__action-btn` updated)

#### `src/renderer/src/components/agents/ConsoleHeader.css` (86 LOC)

- Height update
- Typography updates per Section 4
- Status dot glow animation tightening

#### `src/renderer/src/components/agents/AgentConsole.tsx` (312 LOC, minor)

- Update virtualizer `estimateSize`: 60 → 100 (cards are taller than lines)
- Rename `console-body` and friends to reflect card metaphor (or keep names if they're load-bearing — judgment call during plan-writing)
- Render `ConsoleCard` instead of `ConsoleLine` (Section 3)
- All other logic preserved: search, jump-to-latest, virtualization, pending message handling, playground modal trigger

#### `src/renderer/src/components/agents/ConsoleLine.tsx` (374 LOC) → split into multiple files

This is the biggest change. The single 374-line file becomes a directory of card components:

```
src/renderer/src/components/agents/cards/
  index.ts                  ← re-exports + ConsoleCard router
  ConsoleCard.tsx           ← entry point: routes block.type → specific card
  StartedCard.tsx
  UserMessageCard.tsx
  AgentTextCard.tsx
  ReasoningCard.tsx
  ToolActionCard.tsx
  ToolGroupCard.tsx
  EditDiffCard.tsx          ← used inside ToolActionCard expanded view
  BashCard.tsx              ← used inside ToolActionCard expanded view
  ReadCard.tsx
  ErrorCard.tsx
  StderrCard.tsx
  RateLimitedCard.tsx
  CompletionCard.tsx        ← extracted from ConsoleLine.tsx:254-301
  PlaygroundCard.tsx        ← extracted from ConsoleLine.tsx:351-372
```

Each card file is small (~30-80 LOC). The router (`ConsoleCard.tsx`) is similar to today's switch statement but lighter (just dispatching).

The shared utilities currently in `ConsoleLine.tsx` (`formatTime`, `formatTokenCount`, `getToolMeta`, `TOOL_MAP`) move to:

```
src/renderer/src/components/agents/cards/util.ts
```

`getToolMeta` is rewritten to return `{ Icon: LucideIcon, color: string }` instead of `{ letter, iconClass }`.

`ConsoleLine.tsx` itself can be deleted after the migration.

#### `src/renderer/src/components/agents/ConsoleLine.css` (330 LOC) → restructure

- Rename to `ConsoleCard.css` or split per-card-type into `cards/*.css`
- Drop the `console-line` / `console-prefix` / `console-prefix--*` styles (no longer used)
- Keep `console-completion-card*`, `console-tool-icon*`, `console-md-*`, `console-line__expanded-content`, `console-line__json` (still referenced by completion + diff/JSON expansion)
- Add new card-grammar styles: card chrome, header rows, accent left-borders, vertical rhythm

#### `src/renderer/src/components/agents/CollapsibleBlock.tsx` (42 LOC, kept)

- Used by reasoning, tool action, tool group expansion — same mechanism, no changes
- Visual treatment polished via CSS only

#### `src/renderer/src/components/agents/AgentConsole.css` (existing, minor)

- Body padding/margin adjustments to make room for card gutters
- Polish jump-to-latest button styling per Section 4

#### NEW: `src/renderer/src/components/agents/FleetGlance.tsx` (~120 LOC)

- Empty-state replacement (Section 6)
- Reads `agents` array, computes totals (`running`, `done`, `failed`, today's cost, today's duration)
- Reads recent events / latest activity per running agent
- Renders styled glance panel

#### NEW: `src/renderer/src/components/agents/FleetGlance.css`

- Panel chrome, status counter row, activity feed row

#### Tests

- All `AgentCard.test.tsx` tests need updates for new structure (assertion targets change)
- All `ConsoleLine.test.tsx` tests need to be split per card type or migrated to a new `ConsoleCard.test.tsx`
- New `FleetGlance.test.tsx`
- Existing snapshot tests will need to be regenerated
- Existing virtualization / scroll behavior tests in `AgentConsole.test.tsx` are unchanged in intent — only the rendered DOM changes

#### Files NOT changed

- `src/main/handlers/agent-handlers.ts` and the rest of `src/main/agent-manager/`
- `src/renderer/src/stores/agentHistory.ts`, `agentEvents.ts`, `localAgents.ts`, `commandPalette.ts`, `panelLayout.ts`
- `src/renderer/src/lib/pair-events.ts` — event grouping logic preserved
- `src/renderer/src/lib/render-agent-markdown.tsx` — reused inside `AgentTextCard`
- `src/renderer/src/lib/tool-summaries.ts` — reused inside `ToolActionCard`
- `src/renderer/src/lib/format.ts` — reused everywhere
- `src/renderer/src/components/agents/CommandBar.tsx` and `.css` — visual polish only, no structural changes
- `src/renderer/src/components/agents/CommandAutocomplete.tsx` — no changes
- `src/renderer/src/components/agents/AgentLaunchpad.tsx` — visual polish only
- `src/renderer/src/components/agents/LaunchpadGrid.tsx` — visual polish only
- `src/renderer/src/components/agents/PlaygroundModal.tsx` — no changes
- `src/renderer/src/components/agents/ConsoleSearchBar.tsx` — no changes
- `src/preload/index.ts` and `src/shared/ipc-channels.ts` — no IPC changes

---

## Section 6 — Empty State: Fleet at a Glance

When `showLaunchpad === false && !selectedAgent` (currently `<EmptyState title="No agent selected" />`), render a "Fleet at a Glance" panel using **only existing data**.

### Mockup

```
┌──────────────────────────────────────────────────────────┐
│  FLEET STATUS                                            │
│                                                          │
│   ◉ 3 running    ✓ 12 done    ⚠ 1 failed                │
│                                                          │
│   $4.21 today    27m total runtime                       │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  WHAT'S HAPPENING NOW                                    │
│                                                          │
│   ● fix sprint queries                                   │
│     ▶ editing src/main/data/sprint-queries.ts            │
│     6m 23s · $0.04                                       │
│                                                          │
│   ● add pr poller tests                                  │
│     ▶ running npm test                                   │
│     12m 04s · $0.18                                      │
│                                                          │
│   ● refactor handlers                                    │
│     ▶ thinking…                                          │
│     1m 51s · $0.02                                       │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  RECENT COMPLETIONS                                      │
│                                                          │
│   ✓ migrate v42 (12m, $1.20) — 6m ago                   │
│   ✓ adhoc: explore stores (8m, $0.34) — 14m ago         │
│   ⚠ refactor planner (5m, $0.08) — 22m ago — failed     │
│                                                          │
└──────────────────────────────────────────────────────────┘
   "→ Pick an agent on the left to drill in"
```

### Sections of the glance

1. **Fleet status row** — counts of running / done / failed (today) + cost today + total runtime today. All derivable from the `agents` array.
2. **What's happening now** — for each running agent, render a mini summary using the same live activity logic from the sidebar card. Click → selects that agent in the sidebar (existing `onSelect` flow).
3. **Recent completions** — last 3-5 done/failed agents with duration + cost + relative time. Same data the sidebar already shows.
4. Footer hint — small dim text instructing the user to pick an agent.

### Why this matters

Today, walking into the Agents view with nothing selected gives you a passive "select an agent" message. The Fleet at a Glance turns the empty state into an _information surface_ — you immediately see whether your fleet is healthy, what's running right now, what just happened. This is the cognitive-load externalization the README talks about.

It uses **only existing data** — `agents` from `agentHistory` store, events from `agentEvents` store, durations from existing fields. No new IPC, no new tables.

### Acceptance bar

The panel must:

- Render in <50ms with 50+ agents in store (no expensive re-computation)
- Update when agents change (subscribe to `agentHistory` store)
- Update when events arrive for running agents (subscribe to `agentEvents` store)
- Look like it belongs in the same view as the proposed sidebar cards (shared visual language)

---

## What's NOT Changing (functionality preserved)

To make the no-features-added contract explicit:

| Functionality                                                                            | Status    |
| ---------------------------------------------------------------------------------------- | --------- |
| Spawn ad-hoc / assistant agents via `+` button → `AgentLaunchpad` modal                  | Preserved |
| Spawn flow opens `LaunchpadGrid` with playground templates                               | Preserved |
| Spawn modal can be triggered via command palette (`bde:open-spawn-modal` event)          | Preserved |
| Sidebar search input filters agents by task / repo / model                               | Preserved |
| Sidebar repo chip filter (when ≥2 repos)                                                 | Preserved |
| Sidebar sections: Running / Recent (24h) / History (collapsible)                         | Preserved |
| Arrow Up/Down keyboard navigation in sidebar                                             | Preserved |
| Load More button when `hasMore`                                                          | Preserved |
| Click sidebar agent card → loads in cockpit                                              | Preserved |
| Selected agent visual treatment (scale + glow)                                           | Preserved |
| Cmd+F → opens `ConsoleSearchBar` over the cockpit body                                   | Preserved |
| Search next/prev navigation through matching events                                      | Preserved |
| `Jump to latest` floating button when scrolled up                                        | Preserved |
| Auto-scroll to tail when at bottom                                                       | Preserved |
| Virtualized scrolling via `@tanstack/react-virtual`                                      | Preserved |
| `CommandBar` with steering, slash commands, attachments, autocomplete                    | Preserved |
| Slash commands: `/stop`, `/retry`, `/focus`, `/checkpoint`, `/test`, `/scope`, `/status` | Preserved |
| Image and text attachment support in CommandBar                                          | Preserved |
| `agent:clear-console` event handler                                                      | Preserved |
| Command palette commands: "Spawn Agent", "Clear Console"                                 | Preserved |
| Killing agents via `+` kill button on AgentCard or via ConsoleHeader stop button         | Preserved |
| Stop confirmation modal with uncommitted-changes warning                                 | Preserved |
| Promote-to-Code-Review button (adhoc done agents with worktree)                          | Preserved |
| Open terminal in agent directory                                                         | Preserved |
| Copy log to clipboard                                                                    | Preserved |
| Pending optimistic message rendering (opacity 0.6)                                       | Preserved |
| Event eviction banner ("Older events were trimmed")                                      | Preserved |
| Playground modal opens on PlaygroundCard click                                           | Preserved |
| Live duration ticker for running agents                                                  | Preserved |
| Live ctx token counter polling                                                           | Preserved |
| Phase label (`derivePhaseLabel`) for running agents in header                            | Preserved |
| Scratchpad info tooltip + first-time banner (rebuilt in CSS, same content)               | Preserved |
| Repo lowercase normalization (existing `repo` field semantics)                           | Preserved |

---

## Open Questions

1. **Live activity row data binding (Section 2):** to render "▶ Currently: editing src/api.ts" in the sidebar card, we need the latest event for each running agent. Today the cockpit subscribes to `agentEvents[selectedId]`. The sidebar would need to subscribe to events for _all running agents_, which could affect virtualization or trigger renders on every event. **To resolve during plan-writing:** profile the cost; if expensive, fall back to a lighter "running" / "thinking" / "tool" state derived from the latest event type only. As noted in Section 2, the redesign is not blocked on this row.

2. ~~**Edit diff rendering (Section 3, card #7):** we're proposing to reuse `PlainDiffContent` from `components/diff/`. Need to verify it accepts arbitrary `oldText`/`newText` strings (vs. only git-format diffs).~~ **Resolved during spec finalization:** `PlainDiffContent` is heavyweight (wired into Code Review comment/selection infrastructure) and not directly reusable. The clean path is `parseDiff(raw: string): DiffFile[]` from `lib/diff-parser.ts` — feed it a synthetic git-format diff built from `old_string`/`new_string`, then render the resulting `DiffFile[]` with a new minimal `EditDiffCard` (~80 LOC). See Section 3 card #7 for details.

3. **Token additions:** Section 4 says "no new tokens" but we may need a `--bde-size-base` if 13px isn't already in `tokens.ts`. **To resolve during plan-writing:** check current `tokens.ts`; add if missing.

4. **Card naming:** the file rename `ConsoleLine.tsx` → `ConsoleCard.tsx` may collide with the existing `cards/` directory naming convention. **To resolve during plan-writing:** confirm naming convention with a glance at sibling components.

5. **Virtualizer estimateSize:** raising from 60 to 100 is a guess. **To resolve during plan-writing:** measure typical card heights in dev and tune. Cards have variable heights — `measureElement` is already in use, so this is just a startup guess.

6. **Mid-run repo change:** if a sidebar card's repo changes mid-run (it shouldn't, but the data model allows it), the tool icon row may flicker. **To resolve:** stable keys per tool call.

---

## Out of Scope

Explicitly _not_ in this redesign:

- New IPC channels, new agent SDK options, new database tables or columns
- Changes to event grouping logic in `pair-events.ts`
- Changes to agent spawn flow, agent lifecycle, retry logic, watchdog timers
- Multi-agent overview "grid" mode (no `selectedAgent`) beyond the empty-state Fleet at a Glance panel
- Tear-off windows or multi-window mode (the `Panel` system supports this — preserved, not extended)
- Timeline / Gantt waterfall (the abandoned section 1 of the 2026-03-25 spec stays abandoned)
- "Live activity strip" at the top (also from the abandoned 2026-03-25 spec; the Fleet at a Glance panel is the spiritual successor and only renders in the empty state)
- New keyboard shortcuts or command palette commands
- Settings to opt out of the new design (the new design replaces the old one wholesale)
- Light theme polish (existing theme tokens carry through; light-theme review is its own scope)
- E2E test additions beyond updating selectors that change due to DOM restructuring

---

## Acceptance Criteria

A reasonable reviewer should be able to confirm all of these by running the app:

### Visual / layout

- [ ] Sidebar default width is 28% (was 20%)
- [ ] Sidebar can resize between 18% and 44%
- [ ] Sidebar header uses CSS classes, no inline styles (verify with grep)
- [ ] Cockpit header is ~56px tall (was 32px)
- [ ] Cockpit header task title is 15px and visually prominent
- [ ] Each event in the cockpit body renders as a card with 12px gutters and 12px vertical gap
- [ ] Tool icons in cards are lucide components, not single letters in colored boxes
- [ ] Edit tool expansion shows an inline diff (additions / deletions colored)
- [ ] Bash tool expansion shows command + output, not raw JSON
- [ ] Reasoning cards show a preview of the first ~120 chars (no click required)
- [ ] User messages render as right-aligned chat bubbles
- [ ] Agent text renders full-width with proper markdown (headings, code, bold)
- [ ] Hover state on sidebar cards has accent glow + slight elevation
- [ ] Hover state on body cards has accent glow + 1px accent border
- [ ] Empty state (no agent selected) shows the Fleet at a Glance panel with status counts, what's happening now, recent completions
- [ ] Per-line timestamps are gone — minute-grouped labels in gutters instead

### Code quality

- [ ] `AgentsView.tsx` has zero `style={{}}` props after the refactor (only CSS classes)
- [ ] `AgentList.tsx` has zero inline gradient/border style overrides
- [ ] `ConsoleLine.tsx` is deleted; the cards live under `components/agents/cards/`
- [ ] `ConsoleLine.css` styles that are still used are renamed and moved into `cards/*.css`; dead styles deleted
- [ ] No new npm dependencies
- [ ] No new IPC channels in `shared/ipc-channels.ts`
- [ ] No store shape changes in `agentHistory.ts` / `agentEvents.ts`

### Functionality preserved

- [ ] All items in "What's NOT Changing" pass a manual smoke test
- [ ] All existing tests for agents components still pass after assertion updates
- [ ] No regression in keyboard shortcuts (`Cmd+F`, arrow keys, `Cmd+1` … `Cmd+9`)
- [ ] No regression in spawn modal flow
- [ ] No regression in scroll behavior (auto-tail, jump-to-latest)
- [ ] No regression in virtualization performance with 500+ events

---

## Notes for the implementation plan

When this spec moves to plan-writing:

- **Stage in phases.** Phase 1 = code-quality cleanup (delete inline styles, no visual changes yet). Phase 2 = sidebar card redesign. Phase 3 = cockpit card grammar split (file restructure). Phase 4 = card-grammar implementation (the actual visual work). Phase 5 = Fleet at a Glance empty state. This way each phase ships green, even if a later phase slips.
- **Phase 1 alone has high value.** Killing the inline-styles sewer in `AgentsView.tsx` and `AgentList.tsx` is a code-health win that has nothing to do with the visual redesign — that should ship first regardless.
- **Phase 3 (file restructure) is the biggest test churn.** Plan time for snapshot regeneration and assertion updates.
- **The live activity row in fleet cards (Section 2) is the most ambiguous data-binding question.** Spike it early in plan-writing to confirm the cost.
- **Diff rendering reuse (Section 3, card #7) is the second most ambiguous.** Spike it early to confirm `PlainDiffContent` is reusable.
