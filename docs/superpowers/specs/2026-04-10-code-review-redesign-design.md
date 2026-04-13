# Code Review View — Design Overhaul

**Date:** 2026-04-10
**Owner:** Ryan
**Status:** Draft — awaiting review
**Scope:** Visual / layout / CSS only. No business logic changes.

---

## 1. Context

The current Code Review view (`src/renderer/src/views/CodeReviewView.tsx`) is a two-panel layout:

```
┌─────────────┬────────────────────────────────┐
│ ReviewQueue │  ReviewDetail                  │
│  (260px)    │   (tabs: Changes / Commits /   │
│             │    Tests / Conversation)       │
│             │                                │
│             ├────────────────────────────────┤
│             │  ReviewActions                 │
│             │   (Ship It / Merge / PR / …)   │
└─────────────┴────────────────────────────────┘
```

Everything the reviewer needs is crammed into the right column. The file list for diffs lives two levels deep (inside `ChangesTab`), the action bar competes with the diff for vertical space, and the "Conversation" tab is a passive replay of agent output — you can read what the agent did but you can't ask follow-up questions.

A new design was authored in a Figma Make workspace (`DESIGN_DOCUMENTATION.md`, `CSS_PATTERNS.md`, `QUICK_REFERENCE.md`) that restructures this view around three first-class panels:

```
┌────────────┬──────────────────────────┬──────────────┐
│  FileTree  │      DiffViewer          │ AIAssistant  │
│   256px    │        flex-1            │    384px     │
└────────────┴──────────────────────────┴──────────────┘
```

This spec captures the layout, spacing, and visual system for that overhaul. Implementation of AI chat behaviour, diff rendering logic, and review actions is **out of scope** — this document covers shell geometry, CSS tokens, motion, and the migration path for the existing components.

## 2. Goals & Non-Goals

**Goals**

- G1. Promote **diff inspection** to the dominant visual weight of the view. The diff is the thing reviewers actually look at; every other element should defer to it.
- G2. Give the **file tree** its own stable column so switching files never reshuffles the layout.
- G3. Give **AI-assisted review** a dedicated, persistent column that can hold a multi-turn conversation about the current diff.
- G4. Keep the view **single-viewport** — no page scrolling; all scrolling happens inside the panels.
- G5. Adopt the new layout without introducing a second design language. Everything maps to BDE's existing `--bde-*` tokens so both `pro-dark` and `pro-light` themes work on day one.
- G6. Preserve every existing review action (Ship It / Merge Locally / Create PR / Revise / Discard / Rebase) and all existing keyboard shortcuts (`j`/`k` for next/prev).

**Non-goals**

- N1. Changing what data the view fetches, how the diff is parsed, or how Ship It works.
- N2. Introducing a new design token system, Tailwind, or a new CSS framework. BDE ships with vanilla CSS + custom properties and that stays.
- N3. Re-theming the rest of the app. This is a Code Review view change only.
- N4. Rewriting tests. Component tests for `ReviewQueue`, `ChangesTab`, `ReviewActions`, etc. will be rewired as components move, but test _intent_ is preserved.

## 3. Architectural Shift

### 3.1 From two panels to three

| Current panel                    | Role               | New location                                                                  |
| -------------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `ReviewQueue` (260px left)       | Pick a task        | Moves into the **TopBar** as a task switcher dropdown                         |
| `ReviewDetail` → tabs            | Inspect changes    | Splits across **FileTree** + **DiffViewer**                                   |
| `ReviewActions` (bottom-right)   | Act on the task    | Moves into the **TopBar** on the right                                        |
| `BatchActions` (floating footer) | Bulk-apply actions | Re-renders as a **TopBar mode** when >1 task is selected in the task dropdown |

The reason for the move: in a three-panel layout, the left column is premium real estate and should be scoped to _"things about this diff"_, not _"pick a different task"_. Every IDE (VS Code, JetBrains, Cursor) puts file context on the left and session switching on the top. BDE should match.

### 3.2 Tab collapse

The four tabs (`Changes`, `Commits`, `Tests`, `Conversation`) collapse as follows:

- **Changes** → becomes the default mode of `DiffViewer`. No tab needed — it's what you see.
- **Commits** → becomes a **mode toggle** inside `DiffViewer` (a segmented control at the top of the panel: `Diff` | `Commits` | `Tests`). Selecting `Commits` replaces the diff with the commit list. **FileTree behaviour in v1:** the left FileTree stays showing the branch's cumulative file list unchanged — it does _not_ swap to the selected commit's files. Swapping is deferred (it requires a second `getDiff()` call scoped to a commit range and adds state that isn't needed for v1). A commit selection highlights the commit in the center panel only.
- **Tests** → same segmented control. Renders the `TestsTab` component in the center panel. FileTree stays visible showing the branch's cumulative file list (not only the test files) — same rationale: zero extra logic.
- **Conversation** → **deleted as a tab**. The agent's historical chat log is folded into the `AIAssistant` panel as pre-seeded context: when the user opens the AI assistant for a task, the first thing it sees is the full agent conversation, and there's a toggle inside the assistant panel (`Show agent history`) that renders those messages read-only above the user's own thread.

This means the reviewer can ask the AI "why did the agent touch this file?" and the AI has the original reasoning in its context. The old `ConversationTab` was read-only and never got used for anything; the new assistant makes it productive.

## 4. Layout & Dimensions

### 4.1 Shell geometry

```
┌──────────────────────────────────────────────────────────────────┐
│                       TopBar  (44px)                             │
├────────────┬──────────────────────────────┬──────────────────────┤
│            │                              │                      │
│  FileTree  │          DiffViewer          │    AIAssistant       │
│   256px    │            flex-1            │        384px         │
│            │                              │                      │
│            │                              │                      │
└────────────┴──────────────────────────────┴──────────────────────┘
```

- **Container**: `.cr-view` — `display: flex; flex-direction: column; height: 100%; overflow: hidden;`
- **TopBar**: `44px` fixed height, `flex-shrink: 0`. Holds task switcher, freshness badge, action buttons.
- **Panel row**: `.cr-panels` — `flex: 1 1 auto; display: flex; min-height: 0;` so internal panels can scroll independently.
- **FileTree column**: `256px` fixed width, `flex-shrink: 0`, right border `1px solid var(--bde-border)`.
- **DiffViewer column**: `flex: 1 1 0; min-width: 0;` — takes all remaining space, can be resized only by the window.
- **AIAssistant column**: `384px` fixed width, `flex-shrink: 0`, left border `1px solid var(--bde-border)`.

All three columns are `display: flex; flex-direction: column; overflow: hidden;` so their internal content (tree, diff, messages) owns its own scroll container.

### 4.2 Spacing rules (compact density, matches `pro-dark`/`pro-light`)

BDE's compact scale already uses:

```
--bde-space-1: 3px     (hairline rhythm, micro-padding)
--bde-space-2: 6px     (row gap, icon margin)
--bde-space-3: 8px     (default inline padding)
--bde-space-4: 12px    (panel inner padding, button padding)
--bde-space-5: 14px    (panel header padding)
--bde-space-6: 18px    (section spacing)
--bde-space-8: 28px    (large gap — between major groups)
```

These are the only spacing values used anywhere in the new view. No `16px`, no `20px`, no ad-hoc values. The compact scale is tighter than the Figma Make mocks (which assume Tailwind's 4px rhythm) — we intentionally collapse onto BDE's existing rhythm so the code review view doesn't visually diverge from Task Pipeline, IDE, and Source Control.

### 4.3 Width responsiveness

The total minimum usable width with all three panels expanded is `256 + 480 + 384 = 1120px` (480px is the hard floor for the diff body). Below that, panels collapse in two steps:

1. **Breakpoint A (≤1120px)**: AIAssistant panel collapses to a 40px rail with an `Open assistant` chevron button. Clicking expands it as a right-docked overlay on top of the diff (not a side-panel push).
2. **Breakpoint B (≤860px)**: FileTree collapses the same way — 40px rail on the left.

Below `620px` the view is considered unusable. `.cr-view` takes `min-width: 620px`; the panel system already prevents smaller viewports from reaching this view, so no further breakpoint is needed.

The collapse/expand transitions are pure CSS width + opacity; no JavaScript needed.

## 5. Component Breakdown

Each sub-section describes the new visual unit. Implementation details (which store, which IPC call) are deferred to the implementation plan.

### 5.1 `CodeReviewView` shell

- `.cr-view` is unchanged as the outer element but its children change.
- New structure:
  ```
  .cr-view
    .cr-topbar
    .cr-panels
      FileTreePanel
      DiffViewerPanel
      AIAssistantPanel
  ```
- The existing `<BatchActions>` floating footer is removed. Batch mode is expressed inside the `cr-topbar` instead (see §5.2).

### 5.2 TopBar — `.cr-topbar`

- Height `44px`, flex row, `padding: 0 var(--bde-space-4)`, `gap: var(--bde-space-3)`.
- Background `var(--bde-surface)`, bottom border `1px solid var(--bde-border)`.
- Three zones (`flex: 0 0 auto | 1 1 auto | 0 0 auto`):
  1. **Left** — task switcher button. Shows current task title (truncated, `max-width: 320px`) and a caret. Clicking opens a popover with the full review queue (what `ReviewQueue` currently renders). The popover is a floating `NeonPopover`-style panel — `position: fixed`, `max-height: 60vh`, scrollable. `j`/`k` still navigate through it; selection fires `selectTask()`.
  2. **Center** — freshness badge (`Fresh` / `Stale (N behind)` / `Conflict` / `…`) using existing `cr-actions__freshness` styles, reparented here. Plus the `Rebase` button, outlined ghost style.
  3. **Right** — primary action cluster: `Ship It`, `Merge Locally` (with strategy dropdown), `Create PR`, and a kebab menu for `Revise` / `Discard`. All four are reused directly from `ReviewActions.tsx`; only their container changes.
- **Batch mode**: when the user shift-clicks or uses `Select All Review Tasks` from the command palette, the TopBar swaps its content for a batch action row — `N tasks selected` label + the four batch operations. Background flips to `var(--bde-accent-surface)` for strong affordance. Pressing `Escape` or clicking `Clear` reverts.

### 5.3 FileTree panel — `.cr-filetree`

- Width `256px`, flex column, `padding: var(--bde-space-3) 0`.
- **Header** (`.cr-filetree__header`, `28px` tall, `padding: 0 var(--bde-space-4)`):
  - Left: label `Files` using `--bde-text-muted`, `font-size: var(--bde-size-xs)`, `text-transform: uppercase`, `letter-spacing: var(--tracking-wide)`.
  - Right: count pill `N files` using the existing `NeonBadge` component.
- **Body** (`.cr-filetree__list`):
  - Each row is `28px` tall, `padding: 0 var(--bde-space-4)`, `display: flex; align-items: center; gap: var(--bde-space-2);`.
  - Row structure:
    ```
    [status icon] [filename] ......... [+N −N]
    ```
  - Status icon: reuses existing `statusIcon()` from `ChangesTab.tsx` (`Plus` / `Minus` / `Edit2` from `lucide-react`), sized `12px`, colored `var(--bde-diff-add)` / `var(--bde-diff-del)` / `var(--bde-diff-mod)`.
  - Filename: truncated from the left with `direction: rtl; text-align: left; unicode-bidi: plaintext;` trick so `src/renderer/src/views/really/deep/File.tsx` reads as `…/really/deep/File.tsx`. Font `var(--bde-size-sm)`, color `var(--bde-text)`.
  - Stats: `var(--bde-size-xs)`, `var(--bde-text-dim)`, tabular numerals (`font-variant-numeric: tabular-nums`).
  - Hover: `background: var(--bde-hover);`
  - Selected: `background: var(--bde-selected); border-left: 2px solid var(--bde-accent); padding-left: calc(var(--bde-space-4) - 2px);` (border sits on the inside so total width doesn't shift).
- **Empty state** (`No changes found in this branch.`): reuses `<EmptyState>` with `variant="muted"`.
- **Tree mode (deferred)**: v1 renders a flat list (same as today). A future iteration can group by directory — the header gets a `[Flat | Tree]` toggle. The panel CSS is already structured to accept indentation via nested `.cr-filetree__item--nested` rules; we stub those classes but don't wire a tree builder.

### 5.4 DiffViewer panel — `.cr-diffviewer`

- Flex `1 1 0; min-width: 0;`
- **Header** (`.cr-diffviewer__header`, `36px`, `padding: 0 var(--bde-space-4)`):
  - Left: breadcrumb of the selected file path. `var(--bde-size-sm)`, `var(--bde-text-muted)`, with a copy-path icon button on hover.
  - Right: mode segmented control — `Diff | Commits | Tests`. Pills have `padding: 2px var(--bde-space-3)`, `border-radius: var(--bde-radius-md)`, active pill uses `background: var(--bde-accent-surface); color: var(--bde-accent);`.
- **Body** (`.cr-diffviewer__body`):
  - `flex: 1 1 auto; overflow: auto;`
  - Renders the existing `<DiffViewer>` component unchanged. We are _not_ rewriting diff rendering — that component already handles hunks, additions, deletions, line numbers, and syntax highlighting.
  - Padding inside the scroll area is `0` because `DiffViewer` owns its own line geometry. The only thing the panel adds is the scroll container.
- **Commits mode**: the body becomes a commit list (reuse `CommitsTab` as-is). FileTree stays showing the branch's cumulative file list (see §3.2).
- **Tests mode**: body renders `TestsTab` unchanged. FileTree stays visible (see §3.2).
- **Snapshot banner**: the existing `.cr-changes__snapshot-banner` moves to the top of `.cr-diffviewer__body` with no visual changes.

### 5.5 AIAssistant panel — `.cr-assistant`

> **Layout-vs-behaviour split:** this section describes the **visual contract** of the assistant panel only — the DOM structure, CSS, and states the UI must be able to render. The backend wiring (SDK streaming, prompt composition, thread persistence) is **out of scope for this spec** and is authored in the implementation plan. Where the text below says "when a stream is in flight" or "the thread", that is describing the _visual state_ the CSS must support, not mandating how it is produced.

- Width `384px`, flex column.
- **Header** (`.cr-assistant__header`, `36px`):
  - Left: label `AI Assistant`, `var(--bde-size-sm)`, weight `600`, color `var(--bde-text)`. A small `<Sparkles size={12}>` icon in `var(--bde-purple)` sits before the label.
  - Right: kebab menu with `Show agent history` toggle, `Clear thread`, and `New thread`. For v1 of this redesign, the menu items are **rendered as visual scaffolding** — the kebab opens a popover with these three entries, and `Show agent history` toggles a CSS class that shows/hides any pre-seeded history bubbles. `Clear thread` and `New thread` dispatch no-op placeholder handlers that the implementation plan will replace. The layout work is considered complete when the menu renders, toggles, and does not visually regress.
- **Messages** (`.cr-assistant__messages`):
  - `flex: 1 1 auto; overflow-y: auto; padding: var(--bde-space-4); display: flex; flex-direction: column; gap: var(--bde-space-3);`
  - **User bubble**: aligned right. `max-width: 80%`, `background: var(--bde-accent); color: var(--bde-btn-primary-text); border-radius: var(--bde-radius-lg) var(--bde-radius-lg) var(--bde-radius-sm) var(--bde-radius-lg); padding: var(--bde-space-3) var(--bde-space-4);` Font `var(--bde-size-sm)`.
  - **Assistant bubble**: aligned left. Same sizing but `background: var(--bde-surface-high); color: var(--bde-text); border: 1px solid var(--bde-border); border-radius: var(--bde-radius-lg) var(--bde-radius-lg) var(--bde-radius-lg) var(--bde-radius-sm);`
  - **Agent-history bubble** (when `Show agent history` is on): assistant bubble style but with `border-left: 2px solid var(--bde-purple);` and an `Agent · <timestamp>` label on top in `var(--bde-text-dim)`.
  - **Streaming cursor**: the last assistant bubble receives a `.cr-assistant__bubble--streaming` class whenever the UI is rendering an in-flight message. That class drives a `::after` blinking cursor via `@keyframes cr-cursor-blink { 50% { opacity: 0; } }`, 1s linear infinite. Respects `prefers-reduced-motion` → no animation. **Who sets the class is out of scope for this spec** — v1 just requires the selector to exist and render correctly when toggled.
- **Input dock** (`.cr-assistant__input`):
  - Bottom-pinned. Height `auto` with `min-height: 44px`, `max-height: 160px`. `padding: var(--bde-space-3) var(--bde-space-4); border-top: 1px solid var(--bde-border); background: var(--bde-surface);`
  - A `<textarea>` with `resize: none; background: transparent; border: none; outline: none; font: inherit; color: var(--bde-text);` that auto-grows up to max-height then scrolls.
  - Submit button right-aligned: primary style, `lucide-react` `Send` icon, `14px`. Disabled while a stream is in flight; swapped for `Loader2` with `.spin` class.
  - Helper row above the textarea: three "quick action" chips — `Summarize diff`, `Risks?`, `Explain selected file` — inserting prefilled prompts on click.
  - **Empty state**: when no task is selected, the panel shows a centered placeholder: `Select a task to start chatting about its changes.`

### 5.6 Collapsed rails (≤1120px and ≤860px)

- `.cr-assistant--collapsed` / `.cr-filetree--collapsed` — `width: 40px;` with a single vertically-centered chevron button. `transition: width 180ms var(--bde-transition-base);`
- When expanded on a narrow viewport, the panel becomes a right/left overlay (`position: absolute; top: 44px; bottom: 0; width: 384px; box-shadow: var(--bde-shadow-lg);`) and closes when the user clicks outside. No JS needed for the transition — `aria-expanded` drives CSS.

## 6. Design Tokens & Theming

All colors, spacing, typography, and radii map to existing `--bde-*` tokens defined in `src/renderer/src/assets/tokens.css`. **No new tokens are introduced.** The mapping table the designer should reference:

| Figma Make intent           | BDE token                       | Notes                                                                                                                                                                                                       |
| --------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bg-background`             | `var(--bde-bg)`                 | View container                                                                                                                                                                                              |
| `bg-card` / `bg-panel`      | `var(--bde-surface)`            | TopBar, FileTree, AIAssistant panels                                                                                                                                                                        |
| `bg-card-elevated`          | `var(--bde-surface-high)`       | Assistant bubbles, hover-elevated rows                                                                                                                                                                      |
| `border`                    | `var(--bde-border)`             | 1px panel dividers                                                                                                                                                                                          |
| `border-hover`              | `var(--bde-border-hover)`       | Button hover outline                                                                                                                                                                                        |
| `text-foreground`           | `var(--bde-text)`               | Primary text                                                                                                                                                                                                |
| `text-muted`                | `var(--bde-text-muted)`         | Secondary labels, breadcrumbs                                                                                                                                                                               |
| `text-dim`                  | `var(--bde-text-dim)`           | Tertiary (counts, timestamps)                                                                                                                                                                               |
| `emerald-500` (additions)   | `var(--bde-diff-add)`           | File icon, stats `+N`                                                                                                                                                                                       |
| `rose-500` (deletions)      | `var(--bde-diff-del)`           | File icon, stats `−N`                                                                                                                                                                                       |
| `amber-500` (modified)      | `var(--bde-diff-mod)`           | File icon                                                                                                                                                                                                   |
| `purple-500` (AI)           | `var(--bde-purple)`             | Sparkles icon, agent-history border                                                                                                                                                                         |
| `blue-500` (accent)         | `var(--bde-accent)`             | Selected row, active tab, primary button                                                                                                                                                                    |
| `accent-surface`            | `var(--bde-accent-surface)`     | Active segmented pill, batch-mode TopBar, selected-row tint. Note: this is the newer "unified" token — always prefer it over the older `--bde-accent-dim`, which is reserved for one-off legacy call sites. |
| `rounded-sm / md / lg / xl` | `var(--bde-radius-sm/md/lg/xl)` | Compact scale: 3/4/6/8px                                                                                                                                                                                    |

Because BDE already ships `pro-dark` and `pro-light` with identical tokens, the redesigned view is **theme-agnostic for free**. No `@media (prefers-color-scheme)` rules, no per-theme overrides. The only place we'll need theme awareness is the diff highlighting — and that already lives inside the existing `DiffViewer` component, not here.

## 7. Motion

All motion uses existing `framer-motion` variants from `src/renderer/src/lib/motion.ts`. Specifically:

- **View mount**: `VARIANTS.fadeIn` + `SPRINGS.snappy` (already applied on `.cr-view`).
- **Panel list stagger**: FileTree and Assistant messages use `VARIANTS.staggerContainer` + `VARIANTS.staggerChild` with `SPRINGS.snappy`. Already the pattern in `ReviewQueue`.
- **Batch mode TopBar swap**: `AnimatePresence` with `mode="wait"`, `VARIANTS.fadeIn`, 120ms.
- **Collapse/expand rails**: pure CSS `transition: width 180ms var(--bde-transition-base);` — no framer.
- **Streaming cursor**: 1s CSS keyframe, opt-out via `@media (prefers-reduced-motion: reduce)`.

Every motion respects `useReducedMotion()` and falls back to `REDUCED_TRANSITION` (0ms). This is already standard across BDE.

## 8. Component Migration Map

| Current file                                  | New role                              | Action                                                                                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `views/CodeReviewView.tsx`                    | Shell                                 | **Edit** — replace `.view-layout` with new `.cr-topbar` + `.cr-panels` tree.                                                                                                                                                   |
| `views/CodeReviewView.css`                    | Shell styles                          | **Edit** — add `.cr-panels`, `.cr-topbar`, `.cr-filetree`, `.cr-diffviewer`, `.cr-assistant`.                                                                                                                                  |
| `components/code-review/ReviewQueue.tsx`      | Task picker                           | **Move** — render inside a popover triggered by the TopBar task switcher button. No logic changes; only its container changes.                                                                                                 |
| `components/code-review/ReviewQueue.css`      | Task picker styles                    | **Edit** — drop the fixed-width aside wrapper; add popover positioning.                                                                                                                                                        |
| `components/code-review/ReviewDetail.tsx`     | Tabs                                  | **Delete** — tabs are collapsed into the DiffViewer mode switcher. `ChangesTab`, `CommitsTab`, `TestsTab` are mounted directly by the new `DiffViewerPanel`. `ConversationTab` is deleted (its data flows into the assistant). |
| `components/code-review/ChangesTab.tsx`       | Old: file list + diff. New: diff only | **Split** — extract the `.cr-changes__files` block into a new `FileTreePanel` component; `ChangesTab` becomes the `DiffViewerPanel` body for `mode === 'diff'`.                                                                |
| `components/code-review/ChangesTab.css`       | Scoped styles                         | **Rename / split** — `.cr-filetree*` classes into a new CSS file, `.cr-diffviewer*` replace `.cr-changes__diff*`.                                                                                                              |
| `components/code-review/CommitsTab.tsx`       | Commits view                          | **Keep** — rendered inside DiffViewerPanel when `mode === 'commits'`. No changes to its internals.                                                                                                                             |
| `components/code-review/TestsTab.tsx`         | Tests view                            | **Keep** — same pattern as Commits.                                                                                                                                                                                            |
| `components/code-review/ConversationTab.tsx`  | Agent history                         | **Delete** — its rendering is reimplemented inside `AIAssistantPanel` as pre-seeded read-only messages.                                                                                                                        |
| `components/code-review/ReviewActions.tsx`    | Action buttons                        | **Move** — rendered inside the TopBar right zone. No behavioural changes; only its parent container changes.                                                                                                                   |
| `components/code-review/ReviewActions.css`    | Action bar styles                     | **Edit** — drop the full-width bar layout, keep the button styles.                                                                                                                                                             |
| `components/code-review/BatchActions.tsx`     | Batch controls                        | **Refactor** — becomes a TopBar _mode_ rather than a floating footer. Logic unchanged.                                                                                                                                         |
| `components/code-review/AIAssistantPanel.tsx` | AI chat                               | **New** — new file.                                                                                                                                                                                                            |
| `components/code-review/FileTreePanel.tsx`    | File tree                             | **New** — extracted from `ChangesTab`.                                                                                                                                                                                         |
| `components/code-review/DiffViewerPanel.tsx`  | Diff container                        | **New** — wraps `ChangesTab` / `CommitsTab` / `TestsTab` with a mode segmented control.                                                                                                                                        |
| `components/code-review/TopBar.tsx`           | Top bar                               | **New** — task switcher + freshness + action buttons.                                                                                                                                                                          |

The existing Zustand store `stores/codeReview.ts` gains one new concept — a per-task assistant thread — but that's implementation detail and is spelled out in the subsequent implementation plan. From the CSS/layout perspective, the store surface is unchanged.

## 9. Accessibility

- TopBar task switcher popover: `role="dialog"`, `aria-modal="true"`, focus trap, `Escape` to close. Same `useRovingTabIndex` hook the current ReviewQueue uses.
- DiffViewer segmented control: `role="tablist"` with `role="tab"` buttons and `aria-selected` — preserves current `ReviewDetail` tab semantics.
- AIAssistant: messages container is `role="log" aria-live="polite" aria-atomic="false"`. The input is a labeled `<label>` + `<textarea>` pair; submit is a `<button type="submit">` so `Enter` submits (`Shift+Enter` inserts newline — matches the existing prompt composer in Task Workbench).
- Collapsed rails: chevron buttons carry `aria-expanded` and `aria-controls` pointing at the panel id.
- Keyboard shortcuts preserved: `j` / `k` still navigate the review queue even when it's inside the popover, because the command palette registration is unchanged.

## 10. Out of Scope / Deferred

- **Tree-mode FileTree.** v1 ships a flat file list (same as today). Directory grouping is deferred.
- **Resizable panels.** Fixed widths (256 / flex / 384). Splitters can come later; they add complexity and weren't in the Figma Make design.
- **AI streaming plumbing.** This spec describes the visual contract for `AIAssistantPanel`; the IPC channel, prompt composition, and SDK wiring are an implementation concern and are specified in the implementation plan, not here.
- **Multi-file diff view.** Current behaviour (one file at a time) is preserved. A side-by-side "all files" mode is deferred.
- **Theme switcher for the view.** Neon vs. pro-dark vs. pro-light is controlled at the app level — not per-view.
- **Mobile / narrow layouts below 620px.** Explicitly unsupported.

## 11. Known Risks

1. **Assistant panel default state** _(decided: silent)_: when the user first opens a task, the assistant does **not** auto-post a summary. Discovery happens through the three quick-action chips above the input. This is a product call — if feedback after ship says reviewers never find the chips, revisit.
2. **Figma Make source reference**: the spec above is driven by the user's summary of `DESIGN_DOCUMENTATION.md` / `CSS_PATTERNS.md` / `QUICK_REFERENCE.md` rather than a direct read of those files (they live only in the Figma Make workspace). If the designer has pixel-specific overrides — e.g. a 240px FileTree instead of 256px, or a specific assistant-panel gradient — those should be reconciled against this spec before implementation. The tokens listed in §6 will absorb colour changes for free; only dimensions need a second pass.

## 12. Success Criteria

The overhaul is "done" when all of the following are true:

- `CodeReviewView` renders the three-panel layout with `256 / flex / 384` widths and a `44px` TopBar.
- No hardcoded colors, spacings, or radii remain in any `cr-*` CSS file — everything resolves through `--bde-*` tokens.
- Both `theme-pro-dark` and `theme-pro-light` look correct with zero per-theme overrides in the Code Review CSS.
- Every existing review action (Ship It / Merge / PR / Revise / Discard / Rebase / batch) is reachable from the new layout.
- `j` / `k` still navigate the review queue.
- `prefers-reduced-motion` disables the streaming cursor and all framer-motion transitions.
- Existing Playwright + Vitest tests pass with only their DOM queries updated for the new class names — no behavioural test changes.
- The view fits within the BDE panel system (no broken `min-width` overrides on outer panels).

---

_Pair this design doc with a follow-up implementation plan (use `superpowers:writing-plans`) that sequences the migration into reviewable slices._
