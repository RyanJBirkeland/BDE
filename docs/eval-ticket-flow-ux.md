# UX Evaluation: Ticket Creation Flow

> **Date:** 2026-03-16
> **Scope:** NewTicketModal, SpecDrawer, SprintCenter, KanbanBoard, TaskCard
> **Evaluator:** UX Audit (automated)
> **Status of flow:** Functional end-to-end, but raw

---

## 1. Current Flow Walkthrough

### Step 1 — Entry Point
User clicks **"+ New Ticket"** button in the SprintCenter header bar (top-right, next to the refresh button). The button is always visible regardless of scroll position.

### Step 2 — Modal Opens
`NewTicketModal` mounts with a scale-in animation (glass morphism `glass-modal elevation-3`). A dark overlay covers the kanban board behind it. Title input auto-focuses after 100ms.

**What the user sees:**

```
+--------------------------------------------------+
|  NEW TICKET                                   [x] |
|--------------------------------------------------|
|  Title                                            |
|  [ e.g. "Add recipe search to Feast onboarding" ]|
|                                                    |
|  Repo             Priority                        |
|  [BDE      v]     [Medium   v]                    |
|                                                    |
|  Template                                         |
|  [Feature] [Bug Fix] [Refactor] [Audit]           |
|  [UX Polish] [Infra]                              |
|                                                    |
|  Spec                            [Ask Paul]       |
|  +----------------------------------------------+ |
|  | Write your spec in markdown or pick a         | |
|  | template above...                             | |
|  |                                               | |
|  |                                               | |
|  |                                               | |
|  |                                               | |
|  |                                               | |
|  |                                               | |
|  |                                               | |
|  +----------------------------------------------+ |
|                                                    |
|                         [Cancel]  [Save to Backlog]|
+--------------------------------------------------+
```

### Step 3 — User Fills Form
1. **Title** (required) — free text input
2. **Repo** — dropdown: BDE, life-os, feast (defaults to first option)
3. **Priority** — dropdown: Low / Medium / High (defaults to Medium)
4. **Template** (optional) — 6 chips that populate the spec textarea with a structured markdown skeleton
5. **Spec** (optional) — raw markdown textarea, 10 rows
6. **Ask Paul** (optional) — AI-generates a spec from the title + repo + current notes

### Step 4 — Submit
User clicks "Save to Backlog" (disabled if title is empty). Enter key in the title field also submits.

**What happens:**
- Optimistic card inserted into the Backlog column immediately
- IPC call: `sprint:create` inserts row into SQLite
- Optimistic row replaced with server row (real ID)
- Toast: "Ticket created — saved to Backlog"
- Modal closes

### Step 5 — Post-Creation Lifecycle
- Card appears in **Backlog** column with title, repo badge, spec indicator
- User can click **"Spec"** to open SpecDrawer and edit/view the spec
- User can click **"-> Sprint"** or drag to move to Queued column
- In Queued, user clicks **"Launch"** to spawn a Claude agent
- Agent runs, card moves to Active, then Done when PR merges

---

## 2. What Works Well

- **Optimistic UI**: Card appears instantly, no perceived latency
- **Template system**: 6 categories with structured markdown — good starting point
- **Ask Paul integration**: AI spec generation from title + context, 30s timeout
- **Keyboard shortcuts**: Enter to submit, Escape to close
- **Glass morphism styling**: Consistent with the app's dark-mode identity
- **Full lifecycle**: Create -> queue -> launch -> monitor -> done is wired end-to-end
- **SpecDrawer**: Separate view/edit modes, Cmd+S save, rendered markdown preview

---

## 3. What Is Missing or Incomplete

### 3.1 Missing CSS for Modal
The `NewTicketModal` uses class names `.new-ticket-overlay`, `.new-ticket-modal__header`, `.new-ticket-modal__body`, `.new-ticket-modal__footer`, `.new-ticket-modal__label`, `.new-ticket-modal__row`, `.new-ticket-modal__field`, `.new-ticket-modal__templates`, `.new-ticket-modal__chip`, `.new-ticket-modal__spec-editor`, `.new-ticket-modal__spec-header` — but **none of these classes have CSS rules in any stylesheet**. The modal relies entirely on the `.glass-modal` base class and reuses `.sprint-tasks__input` / `.sprint-tasks__select` from the old task panel. This means:
- No explicit layout for the modal body
- No sizing constraints for the modal container
- No styles for template chips (active state, hover, etc.)
- No responsive behavior
- The spec editor textarea has no dedicated styling

### 3.2 No Field Validation Feedback
- Title is required but no visual indicator (no asterisk, no red border on empty submit)
- No character limits on title or spec
- No "title too short" or "title too long" warnings
- Empty submit is silently blocked — user gets no feedback on *why* Save is disabled

### 3.3 No Description Field Used
- `description` is accepted at creation (always empty string `""`) but never displayed or editable anywhere in the UI
- The `notes` column in the database is never populated or shown
- These are dead fields creating conceptual weight in the data model

### 3.4 No Markdown Preview in Modal
- The spec textarea is raw markdown — user can't preview what they're writing
- SpecDrawer has a rendered markdown view, but the modal does not
- Rendered view in SpecDrawer uses a custom regex renderer that misses many markdown features

### 3.5 No Smart Defaults
- Repo always defaults to the first option (BDE) regardless of context
- Priority always defaults to Medium
- No suggestion based on title keywords (e.g., "fix" -> Bug Fix template, "perf" -> priority High)

### 3.6 Ask Paul Has No Error Feedback
- On failure: `catch {}` — completely silent (line 121 of NewTicketModal)
- User sees "Generating..." then nothing happens
- No toast, no error message, no retry affordance
- 30s timeout is long with no progress indicator beyond the button label change

### 3.7 No Duplicate Detection
- Can create identical tickets with the same title
- No "similar tasks exist" warning

### 3.8 Template Selection UX Issues
- Clicking a template replaces the entire spec textarea contents with no confirmation
- If user has typed custom content, one click destroys it
- No undo after template selection
- Active template chip styling may not render (missing CSS)

### 3.9 No Keyboard Navigation for Templates
- Template chips are buttons but no tab order or arrow-key navigation documented
- No shortcut to cycle templates

### 3.10 No Zustand Store for Sprint State
- All sprint state is local to SprintCenter component (`useState`)
- No way for other views to read or interact with sprint state
- The Sessions view can't show "current task being worked on"
- No cross-view coordination

---

## 4. Friction Points and Drop-Off Risks

### High Friction
| Issue | Risk | Severity |
|-------|------|----------|
| **No CSS for modal** — layout depends on browser defaults and inherited glass styles | Modal may look broken or misaligned on different screen sizes | Critical |
| **Ask Paul fails silently** — user waits 30s, gets nothing | User loses trust in AI feature, stops using it | High |
| **Template click destroys user content** | User loses work, frustrated, may abandon ticket creation | High |
| **No validation feedback** | User doesn't know why button is disabled, may think app is broken | Medium |

### Medium Friction
| Issue | Risk | Severity |
|-------|------|----------|
| **No markdown preview** — user writes blind | Specs may have formatting errors that are only visible in SpecDrawer | Medium |
| **No smart defaults** — repo/priority always same | User has to manually change every time for non-BDE repos | Medium |
| **Modal is one-shot** — no draft saving | If user accidentally closes, all work is lost | Medium |
| **Spec textarea is small** (10 rows) for complex specs | Awkward scrolling for detailed features | Low |

### Low Friction (Annoyances)
| Issue | Risk | Severity |
|-------|------|----------|
| **No duplicate title check** | Backlog accumulates duplicates | Low |
| **Dead description/notes fields** | Data model confusion for future contributors | Low |
| **Enter key submits from title** even if user intended newline | Accidental submit (mitigated: shift+enter is not newline-capable since it's an `<input>` not `<textarea>`) | Low |

---

## 5. UX Vision: Improved Ticket Creation Flow

### 5.1 Prompt Templates (Enhanced)

Expand the 6 existing templates to 8, with richer structure and inline hints:

| Category | Template Sections | Smart Trigger |
|----------|-------------------|---------------|
| **Feature** | Problem, Solution, Data Shapes, Files to Change, Out of Scope | Title contains "add", "create", "implement", "new" |
| **Bug Fix** | Bug Description, Steps to Reproduce, Root Cause, Fix, How to Test | Title contains "fix", "bug", "broken", "crash" |
| **Refactor** | What's Being Refactored, Why Now, Target State, Migration Plan, Files | Title contains "refactor", "extract", "move", "rename", "clean" |
| **Test** | What to Test, Test Strategy (unit/integration/e2e), Coverage Targets | Title contains "test", "coverage", "spec" |
| **Performance** | What's Slow, Measurement (before), Target (after), Approach, Verification | Title contains "perf", "slow", "optimize", "latency" |
| **Design / UX** | UX Problem, User Journey (before/after), Target Design, Visual Refs | Title contains "ui", "ux", "design", "style", "layout" |
| **Audit** | Scope, Criteria, Deliverable Format | Title contains "audit", "review", "check" |
| **Infra** | What's Being Changed, Steps, Rollback Plan, Verification | Title contains "infra", "deploy", "ci", "config" |

**Auto-suggest behavior:** As user types title, highlight the most relevant template chip with a subtle glow. User can still override.

### 5.2 AI-Assisted Spec Writing

**Current state:** "Ask Paul" generates a full spec from title + repo in one shot.

**Improved flow:**

1. **Contextual generation**: Include recent git log, open PRs, and codebase file tree in the prompt so Paul can reference actual files
2. **Streaming response**: Show spec text streaming in real-time instead of waiting 30s for the full response
3. **Section-by-section**: Let user approve/edit each section before Paul generates the next one
4. **Refinement**: After initial generation, user can highlight a section and say "expand this" or "make this more specific"
5. **Error handling**: On failure, show a toast with retry button. On timeout, offer "Try again with a simpler prompt"

### 5.3 "Design a Feature" Mode

A conversational flow for complex features that aren't ready for a spec yet:

```
+--------------------------------------------------+
|  DESIGN A FEATURE                             [x] |
|--------------------------------------------------|
|                                                    |
|  Paul: What feature are you thinking about?       |
|                                                    |
|  User: I want to add a cost tracking dashboard    |
|        that shows API spend per agent per day     |
|                                                    |
|  Paul: Good start. Let me ask a few questions:    |
|        1. Should this show historical data or     |
|           just the current session?               |
|        2. What API providers are we tracking?     |
|        3. Should there be budget alerts?          |
|                                                    |
|  User: Historical, last 30 days. Anthropic only   |
|        for now. Yes to budget alerts.             |
|                                                    |
|  Paul: Here's my proposed spec:                   |
|        [rendered markdown spec preview]           |
|                                                    |
|  [Edit Spec]  [Looks Good -> Create Ticket]       |
+--------------------------------------------------+
```

**Implementation:**
- Reuse the existing `invokeTool('sessions_send')` integration
- New component: `DesignFeatureModal` with a chat interface
- Conversation history maintained in local state
- Final output: structured spec that populates NewTicketModal fields
- "Create Ticket" button pre-fills the standard modal and submits

### 5.4 Smart Defaults

| Default | Logic |
|---------|-------|
| **Repo** | If user has an active git context (from Diff view or Sessions), pre-select that repo |
| **Priority** | Keyword analysis: "urgent", "critical", "blocker" -> High; "nice to have", "cleanup" -> Low |
| **Template** | Auto-highlight based on title keywords (see 5.1 table) |
| **Spec pre-fill** | If title matches an existing template keyword, pre-load the template without requiring a click |

---

## 6. Wireframe: Improved NewTicketModal

### Phase 1 — Polish (minimal changes)

```
+----------------------------------------------------------+
|  NEW TICKET                                          [x]  |
|----------------------------------------------------------|
|                                                           |
|  Title *                                                  |
|  +------------------------------------------------------+|
|  | Add cost tracking dashboard to BDE                    ||
|  +------------------------------------------------------+|
|  Suggested: [Feature]  (based on "Add")                   |
|                                                           |
|  +------------------+  +------------------+               |
|  | Repo             |  | Priority         |               |
|  | [BDE         v]  |  | [Medium      v]  |               |
|  +------------------+  +------------------+               |
|                                                           |
|  Template                                                 |
|  (Feature) [Bug Fix] [Refactor] [Test]                    |
|  [Perf] [Design] [Audit] [Infra]                         |
|                   ^highlighted = auto-suggested           |
|                                                           |
|  Spec                     [Preview]  [Ask Paul]           |
|  +------------------------------------------------------+|
|  | ## Problem                                            ||
|  | <!-- What's broken or missing and why it matters -->  ||
|  |                                                       ||
|  | ## Solution                                           ||
|  | <!-- What will be built -->                           ||
|  |                                                       ||
|  | ## Files to Change                                    ||
|  | <!-- Explicit list -->                                ||
|  |                                                       ||
|  | ## Out of Scope                                       ||
|  | <!-- What is NOT being built in this PR -->           ||
|  +------------------------------------------------------+|
|                                                           |
|  +------------------------------------------------------+|
|  |  "Unsaved draft — will be lost if you close"         ||
|  +------------------------------------------------------+|
|                                                           |
|           [Cancel]  [Design with Paul]  [Save to Backlog] |
+----------------------------------------------------------+
```

**Changes from current:**
- `*` asterisk on required Title field
- "Suggested: [Template]" hint below title
- "Preview" toggle for markdown spec
- "Unsaved draft" warning when content exists
- "Design with Paul" button (launches conversational flow)
- Template chip styling with auto-suggestion highlight
- 2 additional template categories (Test, Perf)

### Phase 2 — Conversational Design Mode

```
+----------------------------------------------------------+
|  DESIGN A FEATURE                   [Back to Form]  [x]  |
|----------------------------------------------------------|
|                                                           |
|  +------------------------------------------------------+|
|  |                                                       ||
|  |  Paul: What are you building? Give me a sentence     ||
|  |  or two and I'll help shape the spec.                ||
|  |                                                       ||
|  |  You: Cost tracking — show daily API spend per       ||
|  |  agent, with a chart and budget alerts               ||
|  |                                                       ||
|  |  Paul: That's a solid feature. A few questions:      ||
|  |                                                       ||
|  |  1. Data source — are costs already logged, or do    ||
|  |     we need to add cost tracking to agent spawning?  ||
|  |  2. Chart library — any preference? recharts is      ||
|  |     already in package.json.                         ||
|  |  3. Budget alerts — per-day? per-agent? cumulative?  ||
|  |                                                       ||
|  |  You: Costs are in the agent_runs table already.     ||
|  |  Use recharts. Per-day budget with a toast warning.  ||
|  |                                                       ||
|  |  Paul: Got it. Here's the spec I'd suggest:          ||
|  |  [## Problem ... ## Solution ... ## Files ...]       ||
|  |                                                       ||
|  +------------------------------------------------------+|
|  +------------------------------------------------------+|
|  |  Type your response...                          [->] ||
|  +------------------------------------------------------+|
|                                                           |
|        [Start Over]  [Edit Spec Manually]  [Create Ticket]|
+----------------------------------------------------------+
```

---

## 7. Priority: What to Build First vs Later

### P0 — Fix Now (broken/missing fundamentals)
| Item | Effort | Why |
|------|--------|-----|
| **Add CSS rules for `.new-ticket-modal__*` classes** | 1-2 hrs | Modal layout is unstyled — may render incorrectly |
| **Add error feedback for Ask Paul** | 30 min | Silent failure erodes trust in the AI feature |
| **Confirm-before-template-overwrite** | 30 min | Prevents data loss when user has typed custom spec |
| **Disable submit button with tooltip explaining why** | 30 min | "Title is required" tooltip on hover |

### P1 — Build Next Sprint (high-impact improvements)
| Item | Effort | Why |
|------|--------|-----|
| **Smart template suggestion** from title keywords | 2-3 hrs | Reduces clicks, guides novice users |
| **Markdown preview toggle** in spec editor | 3-4 hrs | Users need to see what they're writing |
| **Streaming Ask Paul response** | 4-6 hrs | Eliminates the 30s black-box wait |
| **Add Test and Perf template categories** | 1 hr | Common task types currently uncovered |
| **Draft persistence** (localStorage) | 2 hrs | Prevents accidental loss on modal close |

### P2 — Build Later (vision features)
| Item | Effort | Why |
|------|--------|-----|
| **"Design a Feature" conversational mode** | 2-3 days | High-value for complex features, but needs chat UI infrastructure |
| **Smart repo default** from active context | 3-4 hrs | Nice but requires cross-view state (needs Zustand sprint store first) |
| **Contextual Ask Paul** (git log + file tree in prompt) | 4-6 hrs | Better AI output, but depends on main process data availability |
| **Section-by-section spec refinement** | 1-2 days | Powerful but complex interaction model |
| **Duplicate title detection** | 2-3 hrs | Low urgency — small team, few tickets |

### P3 — Future / Nice-to-Have
| Item | Effort | Why |
|------|--------|-----|
| **Sprint store in Zustand** (extract from component state) | 1 day | Architectural improvement, enables cross-view features |
| **Priority suggestion from description NLP** | 4-6 hrs | Diminishing returns — priority is quick to set manually |
| **Ticket templates from git history** (learn from past specs) | 2-3 days | Advanced ML feature, low urgency |

---

## 8. Summary

The ticket creation flow is **functional but unfinished**. The happy path works: create a ticket, add a spec (manually or via AI), queue it, launch an agent. But the edges are rough:

1. **No dedicated CSS** for the modal — it renders on inherited styles alone
2. **Silent AI failures** undermine trust in the "Ask Paul" feature
3. **Template selection is destructive** — overwrites user content without warning
4. **No validation feedback** — disabled buttons with no explanation
5. **No markdown preview** in the creation flow (only in SpecDrawer after save)
6. **No smart defaults** — every field starts at the same value regardless of context

The highest-impact improvements are in the **P0 and P1** tiers: fix the CSS, add error feedback, add a preview toggle, and stream the AI response. These changes would transform the modal from "functional prototype" to "polished tool" with roughly 1-2 days of focused work.

The **P2 conversational design mode** is the most ambitious UX improvement — it would make BDE unique as an AI IDE where you co-design features with your agent before coding begins. But it depends on the foundation being solid first.
