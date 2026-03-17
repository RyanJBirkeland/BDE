# Product Strategy: Ticket Creation & Spec Workflow

> **Author:** PM Evaluation (Claude)
> **Date:** 2026-03-16
> **Status:** PROPOSAL — ready for review
> **Scope:** NewTicketModal, SpecDrawer, spec generation, and the broader "idea → agent-ready prompt" pipeline

---

## 1. User Story

### Who

Ryan — a solo technical founder managing three codebases (BDE, life-os, feast). He treats AI coding agents like junior engineers on a sprint team. He's the PM, the architect, and the reviewer. He doesn't have a team to bounce ideas off of — the AI is his team.

### Why

Ryan needs to translate raw product ideas into agent-executable specs fast enough that the bottleneck is _thinking_, not _typing_. Every minute spent formatting a spec template or wrestling with a form is a minute not spent on the next idea. The ticket creation flow is the **front door** of BDE — if it's slow or clunky, the entire agentic workflow stalls.

### What Outcome

A ticket that lands in Backlog with a prompt good enough that an agent can pick it up, open a PR, and get it right on the first try — without Ryan having to babysit. The quality bar: **"Would I accept this spec from a senior engineer on my team?"**

### Current Pain Points (Observed)

1. **Template selection is disconnected from AI generation.** Picking "Bug Fix" pre-fills a markdown scaffold, but "Ask Paul" ignores the template and writes from scratch. The two features don't compose.
2. **No conversational refinement.** "Ask Paul" is a one-shot generation. If the spec is 80% right but needs adjustment, Ryan has to manually edit or re-generate from scratch.
3. **Title is the only creative input before spec.** There's no guided thinking — no "what's the root cause?", no "which files are involved?", no "what's out of scope?" The user goes from a one-line title to a wall of markdown.
4. **No quick-fire mode.** Sometimes Ryan just wants to capture "fix the toast z-index in SprintCenter" and move on. The current modal is optimized for the mid-complexity case.
5. **Spec quality is invisible.** There's no feedback on whether a spec is "agent-ready" or underspecified. Ryan has to eyeball it.

---

## 2. Current State Assessment

### What Works

| Feature | Status | Notes |
|---------|--------|-------|
| 4-column Kanban (backlog → queued → active → done) | **Shipped** | Solid. D&D works, status transitions are correct. |
| New Ticket modal with title, repo, priority | **Shipped** | Clean, focused. Enter-to-submit is nice. |
| 6 template chips (Feature, Bug Fix, Refactor, Audit, UX Polish, Infra) | **Shipped** | Pre-fill spec textarea with markdown scaffolds. Toggle behavior works. |
| "Ask Paul" AI spec generation | **Shipped** | Calls OpenClaw gateway, generates markdown spec from title + repo + notes. 30s timeout. |
| SpecDrawer view/edit/save | **Shipped** | Markdown rendering, edit mode, Cmd+S save, dirty-state tracking. |
| SpecDrawer "Ask Paul" for existing tasks | **Shipped** | Can regenerate/improve spec for backlog tasks. |
| Optimistic create with toast | **Shipped** | Card appears instantly in Backlog. |
| Agent launch from queued tasks | **Shipped** | Spawns Claude CLI with stream-json I/O. |

### What's MVP-Incomplete

| Gap | Impact | Severity |
|-----|--------|----------|
| **Template + AI don't compose.** Selecting "Bug Fix" then hitting "Ask Paul" doesn't use the template structure — Paul generates freeform. | Spec quality variance. Templates exist but don't influence AI output. | Medium |
| **One-shot generation only.** No back-and-forth with Paul. If the spec needs refinement, user manually edits. | Friction on complex tasks. Ryan becomes a spec editor instead of a spec director. | High |
| **No quick-capture mode.** Even a trivial fix requires opening the full modal, picking a repo, and hitting save. | Slows down idea capture. Ryan might context-switch to a text file instead. | Medium |
| **No spec quality signal.** No "this spec is missing files to change" or "this is ready to launch." | Under-specified tasks get launched and fail, wasting agent time + API cost. | High |
| **Description field is a no-op.** `description` is accepted in the type but never persisted to SQLite (no column). Dead code path. | Confusing for anyone reading the code. No user impact since it's not in the UI. | Low |
| **`column_order` not persisted.** TypeScript type has it, DB doesn't. Within-column reorder is wired but nonfunctional. | No user impact yet — priority + created_at provides adequate ordering. | Low |
| **Spec file path loading is fragile.** SpecDrawer regex-extracts `docs/specs/*.md` from the prompt field. If prompt format changes, spec display breaks. | Brittleness, not a UX issue today. | Low |

---

## 3. Feature Vision: Three Modes of Ticket Creation

The core insight: **different tasks need different amounts of thinking.** A one-line bug fix doesn't need a conversation with an AI architect. A new feature that touches 12 files does. The modal should adapt to the complexity of the task, not force every task through the same funnel.

### Mode Selection UX

When the user opens "+ New Ticket", the modal presents three mode tabs at the top:

```
┌──────────────────────────────────────────────────────────────┐
│  ✦ NEW TICKET                                        [×]     │
│                                                              │
│  [ ⚡ Quick ]  [ 📋 Template ]  [ 🎨 Design with Paul ]     │
│  ─────────────────────────────────────────────────────────── │
│                                                              │
│  (mode-specific content below)                               │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

Default mode: **Quick** (fastest path to a backlog card).

---

### Mode 1: QUICK MODE — "Capture and Go"

**Philosophy:** Minimum viable ticket. Get the idea out of your head and into the backlog in under 5 seconds. The AI fills in the rest later.

#### Layout

```
┌──────────────────────────────────────────────────────────────┐
│  [ ⚡ Quick ]  [ 📋 Template ]  [ 🎨 Design with Paul ]     │
│  ─────────────────────────────────────────────────────────── │
│                                                              │
│  What needs to happen?                                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Fix toast z-index so it renders above the SpecDrawer  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  Repo: [BDE ▼]                                               │
│                                                              │
│           [Cancel]  [⚡ Save to Backlog — Paul writes spec]  │
└──────────────────────────────────────────────────────────────┘
```

#### Behavior

1. **Two fields only:** Title (required) + Repo (required, defaults to BDE).
2. **Priority auto-set to Medium** (can be changed later in SpecDrawer or card context menu).
3. **On save:** Task is created in Backlog with `prompt = title`. A background job fires "Ask Paul" to auto-generate a spec from the title alone. The card appears with a subtle shimmer/loading indicator while the spec generates.
4. **Auto-generated spec uses heuristics from the title:**
   - Title contains "fix", "bug", "broken", "crash" → Bug Fix template structure
   - Title contains "add", "new", "create", "implement" → Feature template structure
   - Title contains "refactor", "extract", "move", "rename" → Refactor template structure
   - Title contains "test", "coverage", "spec" → Test Coverage template structure
   - Title contains "perf", "slow", "optimize", "cache" → Performance template structure
   - Title contains "style", "css", "ui", "ux", "polish", "design" → Design Polish template structure
   - Fallback → Feature template structure
5. **When spec generation completes:** Card stops shimmering, spec is saved. User can review in SpecDrawer before pushing to Sprint.

#### Acceptance Criteria

- [ ] Quick mode is the default when modal opens
- [ ] Only title and repo are visible (no priority, no template chips, no spec textarea)
- [ ] Enter key submits immediately
- [ ] Task appears in Backlog within 200ms (optimistic)
- [ ] Background spec generation starts automatically after save
- [ ] Card shows loading state (shimmer or spinner badge) during generation
- [ ] Generated spec uses appropriate template structure based on title heuristics
- [ ] If generation fails (timeout, gateway down), task still exists with `prompt = title` — no data loss
- [ ] User can open SpecDrawer to review/edit generated spec
- [ ] Total time from "click + New Ticket" to "card in backlog" < 5 seconds for a simple title

---

### Mode 2: TEMPLATE MODE — "Structured Spec Builder"

**Philosophy:** Choose your adventure. Pick a template that matches your task type, fill in the sections, optionally let Paul polish it. This is today's flow, refined.

#### Layout

```
┌──────────────────────────────────────────────────────────────┐
│  [ ⚡ Quick ]  [ 📋 Template ]  [ 🎨 Design with Paul ]     │
│  ─────────────────────────────────────────────────────────── │
│                                                              │
│  Title                                                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Add recipe search to Feast onboarding                 │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  Repo              Priority                                  │
│  [Feast ▼]         [● Medium ▼]                              │
│                                                              │
│  Template                                                    │
│  [Feature✓] [Bug Fix] [Refactor] [Test] [Perf] [Design]     │
│                                                              │
│  Spec                                          [✨ Ask Paul] │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ## Problem                                            │   │
│  │ Feast onboarding has no way to search for recipes...  │   │
│  │                                                       │   │
│  │ ## Solution                                           │   │
│  │ Add a search bar to the onboarding flow that...       │   │
│  │                                                       │   │
│  │ ## Files to Change                                    │   │
│  │ - src/onboarding/RecipeSearch.tsx (create)             │   │
│  │                                                       │   │
│  │ ## Out of Scope                                       │   │
│  │ - Full-text search indexing (use simple filter)        │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│                          [Cancel]  [Save to Backlog]         │
└──────────────────────────────────────────────────────────────┘
```

#### Template Roster (Expanded from Current 6)

| Template | Pre-filled Sections | When to Use |
|----------|-------------------|-------------|
| **Feature** | Problem, Solution, Files to Change, Out of Scope | New functionality |
| **Bug Fix** | Bug Description, Steps to Reproduce, Root Cause, Fix, Files to Change, How to Test | Something is broken |
| **Refactor** | What's Being Refactored, Why, Target State, Files to Change, Out of Scope | Code quality improvement |
| **Test Coverage** | What to Test, Test Strategy (unit/integration/e2e), Files to Create, Coverage Target | Adding tests |
| **Performance** | Bottleneck Description, Current Metrics, Target Metrics, Approach, Files to Change | Speed/memory optimization |
| **Design Polish** | UX Problem, Target Design (ASCII wireframe), Files to Change (CSS + TSX), Visual References | UI/CSS improvements |

#### "Ask Paul" Improvement: Template-Aware Generation

**Key change from current behavior:** When a template is selected, "Ask Paul" generates within that template's structure rather than freeform. The system prompt includes:

```
You are writing a spec for a {template_type} task.
Use EXACTLY this structure:
{template_markdown_scaffold}

Fill in each section based on:
- Title: "{title}"
- Repo: {repo}
- User's notes: {whatever the user has typed so far}

Be specific. Name exact files. Describe exact changes.
```

This means templates and AI compose naturally — the template provides structure, Paul provides content.

#### Acceptance Criteria

- [ ] Switching to Template mode shows title, repo, priority, template chips, and spec textarea
- [ ] 6 templates available: Feature, Bug Fix, Refactor, Test Coverage, Performance, Design Polish
- [ ] Selecting a template pre-fills the spec textarea with that template's markdown scaffold
- [ ] "Ask Paul" generates content within the selected template's structure (not freeform)
- [ ] If no template is selected, "Ask Paul" generates freeform (current behavior)
- [ ] User can edit the spec after AI generation
- [ ] Template selection is toggle-able (click again to deselect)
- [ ] Switching templates replaces spec content (with confirmation if dirty)
- [ ] All current modal functionality preserved (Enter submit, ESC close, Shift+Enter for newline)
- [ ] Spec textarea supports Cmd+A select-all, standard text editing
- [ ] "Ask Paul" shows inline loading state ("Generating..." in textarea)

---

### Mode 3: DESIGN MODE — "Work with Paul"

**Philosophy:** Conversational product design. Instead of filling out a form, the user describes what they want in plain language. Paul asks clarifying questions, proposes approaches, and generates the spec collaboratively. Like pair programming, but for product design.

This is the **signature feature** of BDE's ticket creation flow. It's what makes BDE more than a task board — it's an AI pair-programmer for solo devs.

#### Layout

```
┌──────────────────────────────────────────────────────────────┐
│  [ ⚡ Quick ]  [ 📋 Template ]  [ 🎨 Design with Paul ]     │
│  ─────────────────────────────────────────────────────────── │
│                                                              │
│  ┌──── Conversation ─────────────────── Spec Preview ────┐  │
│  │                                      │                 │  │
│  │  Paul: What are you thinking about   │  (empty)        │  │
│  │  building? Describe the feature or   │                 │  │
│  │  problem in your own words.          │  Spec will      │  │
│  │                                      │  appear here    │  │
│  │  You: The Feast app needs a way to   │  as Paul        │  │
│  │  search recipes during onboarding.   │  drafts it.     │  │
│  │  Right now users just see a fixed    │                 │  │
│  │  list and can't find what they want. │                 │  │
│  │                                      │                 │  │
│  │  Paul: Good. A few questions:        │                 │  │
│  │  1. Is this search client-side       │                 │  │
│  │     filtering or server-side?        │                 │  │
│  │  2. What does the recipe data model  │                 │  │
│  │     look like — do you have a name   │                 │  │
│  │     field and tags?                  │                 │  │
│  │  3. Should search persist across     │                 │  │
│  │     onboarding steps?               │                 │  │
│  │                                      │                 │  │
│  │  You: Client-side. Recipes have      │                 │  │
│  │  name, tags, and cuisine. Search     │                 │  │
│  │  should reset each step.            │                 │  │
│  │                                      │                 │  │
│  │  Paul: Got it. Here's what I'm       │  ## Problem     │  │
│  │  thinking for the spec...            │  Feast onboard  │  │
│  │  [see spec panel →]                  │  shows a fixed  │  │
│  │                                      │  recipe list... │  │
│  │  Does this look right? Anything      │                 │  │
│  │  to add or change?                   │  ## Solution    │  │
│  │                                      │  Add a search   │  │
│  │  You: Add a note that we should      │  input that...  │  │
│  │  debounce the search input.          │                 │  │
│  │                                      │  ## Files...    │  │
│  │  Paul: Updated. Spec is ready.       │  ## Out of...   │  │
│  │                                      │                 │  │
│  ├──────────────────────────────────────┤                 │  │
│  │  [Type your response...]     [Send]  │                 │  │
│  └──────────────────────────────────────┴─────────────────┘  │
│                                                              │
│  Repo: [Feast ▼]    Priority: [● Medium ▼]                   │
│                                                              │
│              [Cancel]  [✓ Save Spec to Backlog]              │
└──────────────────────────────────────────────────────────────┘
```

#### Conversation Flow

**Phase 1 — Discovery (1-3 exchanges)**

Paul's system prompt:
```
You are Paul, a senior product engineer helping design a coding task for BDE.
Your job is to understand what the user wants to build, ask 2-3 clarifying
questions, then propose a spec. Be concise. Don't over-engineer. Ask about:
- Scope (what's in, what's out)
- Data model (what types/schemas are involved)
- Files affected (which files in the {repo} repo)
- Edge cases (what could go wrong)
Don't ask more than 3 questions at once. Be conversational, not formal.
```

Paul opens with: _"What are you thinking about building? Describe the feature or problem in your own words."_

After the user responds, Paul asks 2-3 targeted clarifying questions based on the response. These questions should be specific to the task domain — not generic.

**Phase 2 — Spec Proposal (1 exchange)**

After enough context (usually 2-3 user messages), Paul generates a full spec in the right panel. The spec follows the most appropriate template structure (auto-detected from conversation content). Paul says something like:

_"Here's the spec I'd propose. Take a look at the panel on the right — does this capture what you're thinking? Anything to add or change?"_

**Phase 3 — Refinement (0-N exchanges)**

The user can request changes: _"Add a note about debouncing"_, _"The file path should be src/components not src/pages"_, _"Actually, make this a refactor instead."_

Paul updates the spec in the right panel in real-time after each refinement.

**Phase 4 — Finalization**

When the user is satisfied, they click "Save Spec to Backlog." The conversation is discarded (it was a means to an end), and the spec is saved as the task's spec + prompt.

#### Technical Architecture

- **Conversation state:** Local React state in the modal. Array of `{ role: 'user' | 'assistant', content: string }` messages.
- **AI calls:** Each user message sends the full conversation history to OpenClaw gateway via `window.api.invokeTool('sessions_send', ...)`. System prompt includes repo context and spec template instructions.
- **Spec extraction:** Paul's responses include the spec in a fenced block (` ```spec ... ``` `) or as a structured section. The right panel extracts and renders the latest spec from the conversation.
- **Repo context injection:** When a repo is selected, Paul's system prompt can optionally include high-level repo structure (file tree summary) to make file path suggestions more accurate. This can be fetched via `window.api` on mode entry.
- **Session management:** Design mode uses a dedicated ephemeral session (not the main agent session). Conversation is discarded on close or save — it's scratchpad, not history.

#### Acceptance Criteria

- [ ] Design mode opens with a split-panel layout: chat on left, spec preview on right
- [ ] Paul's opening message appears immediately (no AI call needed — it's static)
- [ ] User can type messages and receive AI responses within 5 seconds
- [ ] Paul asks 2-3 clarifying questions after the initial user message
- [ ] After sufficient context, Paul generates a full spec visible in the right panel
- [ ] User can request spec refinements via conversation
- [ ] Spec panel updates in real-time as Paul revises
- [ ] Repo selector and priority selector are accessible during conversation
- [ ] "Save Spec to Backlog" creates a task with the finalized spec
- [ ] Task title is auto-generated from the conversation (Paul proposes one)
- [ ] Conversation is not persisted after save — it's ephemeral
- [ ] If the user closes the modal mid-conversation, they get a "Discard draft?" confirmation
- [ ] Chat input supports Enter to send, Shift+Enter for newline
- [ ] Conversation scrolls to bottom on new messages
- [ ] Spec preview renders markdown with the same renderer as SpecDrawer
- [ ] If OpenClaw gateway is unavailable, Design mode shows a clear error state

---

## 4. Prioritization

### Shipping Order

| Phase | Mode | Effort | Impact | Ship Target |
|-------|------|--------|--------|-------------|
| **Phase 1** | Template Mode improvements | Small (2-3 tickets) | Medium | This week |
| **Phase 2** | Quick Mode | Medium (3-4 tickets) | High | Next week |
| **Phase 3** | Design Mode | Large (5-8 tickets) | Very High | 2 weeks |

### Rationale

**Phase 1 — Template Mode improvements (quick wins)**

The current Template Mode is 90% there. The main fix is making "Ask Paul" template-aware — when a user selects "Bug Fix" and hits "Ask Paul", the AI should generate within the Bug Fix scaffold, not freeform. This is a prompt engineering change + minor UI wiring. Also: add "Test Coverage" and "Performance" templates. Low risk, immediate quality improvement.

Tickets:
1. Make "Ask Paul" template-aware (pass selected template structure in system prompt)
2. Add "Test Coverage" and "Performance" templates
3. Confirmation dialog when switching templates with dirty spec

**Phase 2 — Quick Mode (high impact, moderate effort)**

Quick Mode unlocks the "idea capture" use case. Ryan should be able to fire off 5 task ideas in 60 seconds without stopping to write specs. Background spec generation means the specs are ready by the time he circles back to review them. This changes BDE from "a tool you sit down to use" to "a tool you capture ideas into throughout the day."

Tickets:
1. Add mode tab switcher to NewTicketModal
2. Implement Quick Mode UI (title + repo only)
3. Background spec generation after save (with shimmer loading state on card)
4. Title heuristic → template type mapping for auto-generation

**Phase 3 — Design Mode (big bet, high reward)**

Design Mode is the differentiator. It turns ticket creation from a _form-filling exercise_ into a _thinking exercise_. Paul becomes a product thinking partner, not just a spec writer. This is what makes BDE an AI pair-programmer rather than a fancy task board.

Tickets:
1. Design Mode split-panel layout (chat + spec preview)
2. Conversation state management + message rendering
3. Paul system prompt engineering (discovery → proposal → refinement flow)
4. Spec extraction from conversation (fenced block parsing)
5. Auto-title generation from conversation
6. Repo context injection (optional file tree in system prompt)
7. Ephemeral session management (don't pollute main agent session)
8. Polish: loading states, error handling, discard confirmation

---

## 5. How Design Mode Fits the BDE Vision

### BDE's Core Promise

BDE exists because solo devs shouldn't have to choose between "moving fast" and "thinking carefully." The traditional workflow is:

```
Think about feature → Write spec → Write code → Review code → Ship
```

With AI agents, the middle steps collapse:

```
Think about feature → Agent writes code → Review code → Ship
```

But "think about feature" is doing a lot of heavy lifting. **The quality of the agent's output is directly proportional to the quality of the spec.** A vague spec produces a vague PR. A precise spec produces a precise PR.

### The Bottleneck Is Spec Quality

Today, spec writing is Ryan's job. He's both the PM and the engineer. Design Mode addresses this by making spec writing a **collaborative** activity instead of a solo one. Paul handles the structure, the boilerplate, the "did you think about edge cases?" prompts. Ryan handles the vision, the constraints, the "actually, not that — this."

### Design Mode as a Flywheel

```
Better specs → Better agent PRs → Less review time → More time for design thinking
     ↑                                                           │
     └───────────────────────────────────────────────────────────┘
```

When specs are higher quality:
1. Agents produce cleaner PRs (fewer rounds of "fix this")
2. Ryan spends less time reviewing/correcting agent output
3. Ryan has more time and energy for the _next_ design conversation
4. More tasks get done per day
5. BDE becomes genuinely multiplicative — one person doing the work of a team

### Design Mode vs. ChatGPT / Claude.ai

"Why not just open Claude.ai and have this conversation there?"

Because Design Mode is **contextual**. Paul knows:
- Which repo the task targets
- What the file structure looks like
- What the spec template format is
- That the output needs to be an agent-executable prompt, not just a design doc
- That the result feeds directly into BDE's sprint pipeline

Design Mode isn't a generic chatbot — it's a purpose-built product design tool that outputs directly into BDE's workflow. No copy-paste. No context switching. No re-formatting.

---

## 6. Success Metrics

### Leading Indicators (measure immediately)

| Metric | Baseline (current) | Target (90 days) | How to Measure |
|--------|-------------------|-------------------|----------------|
| **Time to create a ticket** | ~45 seconds (modal → save) | < 10s (Quick), < 60s (Template), < 3 min (Design) | Timestamp delta: modal open → task created_at |
| **Spec fill rate** | ~60% of tasks have specs | > 90% of tasks have specs | `SELECT COUNT(*) WHERE spec IS NOT NULL / COUNT(*)` |
| **Mode usage distribution** | N/A (one mode) | 50% Quick, 30% Template, 20% Design | Track which mode tab was active at save |
| **"Ask Paul" usage** | Unknown | > 40% of template-mode tickets use "Ask Paul" | Count invokeTool calls per ticket creation |

### Lagging Indicators (measure over weeks)

| Metric | Baseline | Target | How to Measure |
|--------|----------|--------|----------------|
| **Agent first-try success rate** | Unknown (estimate ~50%) | > 70% | Tasks that go active → done without manual intervention or re-launch |
| **Spec revision count** | Unknown | < 2 revisions before launch | Count sprint:update calls that modify `spec` field per task |
| **Time in Backlog** | Unknown | < 24 hours median | `started_at - created_at` for tasks that reach active |
| **Tasks completed per week** | ~5-8 (estimate) | > 12 | Count tasks entering `done` status per week |
| **PR rejection rate** | Unknown | < 20% | Tasks where PR is closed (not merged) / total PRs |

### Qualitative Signals

- Ryan uses Quick Mode for idea capture during the day (not just during dedicated sprint planning)
- Design Mode conversations produce specs Ryan wouldn't have written on his own (discovers edge cases, suggests better approaches)
- Ryan stops manually editing specs after Paul generates them (spec quality is high enough out of the box)
- Ryan creates more tasks per week (lower friction → more throughput)

---

## 7. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Design Mode conversations take too long** — Paul asks too many questions, user gets impatient | Medium | High | Cap at 3 clarifying questions. Paul should propose a spec after 2 user messages, even if uncertain. "Good enough now, refine later" > "perfect but slow." |
| **Quick Mode auto-specs are low quality** — title heuristics pick wrong template, generated spec is generic | Medium | Medium | Always show a "Review spec" prompt on the card after generation. Make it easy to jump into SpecDrawer. Quick Mode is capture, not finalization. |
| **Gateway latency makes AI features feel slow** — 5-10s waits for Paul responses | Medium | High | Streaming responses. Show Paul typing indicator. For Quick Mode, background generation means the user never waits. |
| **Mode switching is confusing** — users don't understand when to use which mode | Low | Medium | Default to Quick Mode (most common). Tooltip on each mode tab explaining when to use it. Mode choice doesn't lock you in — you can always edit in SpecDrawer later. |
| **Scope creep on Design Mode** — temptation to add memory, persistent sessions, etc. | High | Medium | Design Mode conversations are ephemeral. The output is the spec. V1 has no conversation history, no "resume last design session." Keep it simple. |

---

## 8. Open Questions

1. **Should Design Mode have repo context?** Injecting a file tree into Paul's system prompt would make file path suggestions more accurate, but adds latency (need to read file tree) and token cost. Recommendation: skip for v1, add as a toggle in v2.

2. **Should Quick Mode auto-push to Sprint?** If the auto-generated spec is good enough, the user might want Quick Mode to create tasks directly in Queued (skipping Backlog). Recommendation: no — always Backlog. The backlog is a safety net. Let the user review before launching.

3. **Should we persist Design Mode conversations?** For learning / post-mortems, it might be useful to save the design conversation alongside the spec. Recommendation: not in v1. Ephemeral keeps it simple. If users ask for it, add a "Save conversation" button in v2.

4. **How does this interact with SpecDrawer?** After a task is created via any mode, the SpecDrawer should be the canonical place to edit specs. Design Mode is for initial creation only. Should SpecDrawer also have a "chat with Paul" mode? Recommendation: yes, eventually — but not in this phase. SpecDrawer gets the existing "Ask Paul" one-shot for now.

5. **Token cost management.** Design Mode conversations could use 10-20k tokens per ticket. At ~$0.003/1k tokens for Sonnet, that's ~$0.03-0.06 per ticket. Acceptable for a solo dev tool, but worth tracking. Surface cost per Design Mode session in the Cost view.

---

## 9. Appendix: Current Template Scaffolds (for Reference)

These are the 6 templates currently shipped in `NewTicketModal.tsx`:

| Template | Sections |
|----------|----------|
| Feature | Problem, Solution, Files to Change, Out of Scope |
| Bug Fix | Bug Description, Root Cause, Fix, Files to Change, How to Test |
| Refactor | What's Being Refactored, Target State, Files to Change, Out of Scope |
| Audit | Audit Scope, Criteria, Deliverable |
| UX Polish | UX Problem, Target Design, Files to Change (CSS + TSX), Visual References |
| Infra | Infrastructure Task, Steps, Verification |

Proposed additions for Phase 1:

| Template | Sections |
|----------|----------|
| Test Coverage | What to Test, Test Strategy (unit/integration/e2e), Files to Create, Coverage Target, Out of Scope |
| Performance | Bottleneck Description, Current Metrics, Target Metrics, Approach, Files to Change, How to Verify |
