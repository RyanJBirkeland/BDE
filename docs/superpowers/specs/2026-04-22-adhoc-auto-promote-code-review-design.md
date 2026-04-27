# Adhoc Agent Auto-Promotion to Code Review — Design

**Date:** 2026-04-22
**Status:** Design approved; awaiting implementation plan
**Related files:** `src/main/services/adhoc-promotion-service.ts`, `src/main/agent-manager/review-transition.ts`, `src/main/handlers/agent-handlers.ts`, `src/main/adhoc-agent.ts`, `src/renderer/src/components/agents/ConsoleHeader.tsx`

## Motivation

Pipeline agents auto-escalate to the Code Review Station on completion. Adhoc and Assistant agents — both user-spawned, both running in `~/.fleet/worktrees-adhoc/`, both capable of committing code — do not. They are intentionally treated as "scratchpads" that never enter the sprint task lifecycle unless the user takes an explicit action.

Three things are broken with the current UX:

1. **The Promote button is present in `ConsoleHeader.tsx` but undiscoverable.** The existing button at lines 255-265 renders as a small icon-only `GitPullRequest` glyph (size 14) tucked among Terminal / Stop / Copy Log icons in a dense header row, with only a `title` tooltip and `aria-label`. In real-world use (see the session transcript that motivated this spec) the user did not realize the glyph was the promote action and resorted to prompting the agent with *"push the changes to code review."* The agent interpreted this as `git push`, pushed to GitHub, and told the user to "open Code Review" — but the task never entered FLEET's review queue because `agents:promoteToReview` was never called. The button isn't missing; it's invisible.
2. **Even when the button is used, it is silent at the session boundary.** There is no auto-promotion when the user stops the session, no system message in the agent transcript once a promotion happens, and no badge on the Code Review nav entry. An adhoc agent that finishes committing work and goes idle just sits there with its worktree; the user has to remember to come back. Pipeline agents don't have this failure mode because the task flips to `review` automatically and Code Review polls for updates.
3. **The Stop confirm dialog actively discourages the right behavior for adhoc/assistant.** `handleStop` in `ConsoleHeader.tsx:121` warns *"Killing it will leave those changes on disk but will not commit or push them."* For a worktree-running scratchpad with uncommitted edits, that's exactly the outcome users complain about — work stranded on disk, no review entry. The current warning reflects the old scratchpad-only model.

The fix is to make user-spawned agents (Adhoc + Assistant) behave like pipeline agents at the boundary that matters — work that produces commits ends up in Code Review, with the user notified, regardless of agent type, and with a visible trigger surface that users actually see.

## Scope

**In scope**

- FLEET Adhoc agents (role: `adhoc`)
- FLEET Assistant agents (role: `assistant`)

Both share the `~/.fleet/worktrees-adhoc/` base and have identical tool access; no valid reason exists for them to diverge at the review boundary.

**Out of scope**

- Pipeline agents — already auto-transition via `transitionToReview()`; unchanged.
- Reviewer / Copilot / Synthesizer — no worktree, or no commits produced.
- Claude Code subagents spawned via the Agent tool with `isolation: "worktree"` — those are orchestrated by Claude Code, not FLEET; outside FLEET's lifecycle.
- Pure research / chat adhoc sessions that never commit — preserved as scratchpads; no promotion occurs.

## Design

### Lifecycle — three triggers, one promotion path

All three triggers flow through the existing `promoteAdhocToTask()` service in `src/main/services/adhoc-promotion-service.ts` (extended — see §Implementation). The service is the single source of truth for promotion; triggers differ only in how they call it.

**Trigger 1 — Session close (auto)**

The existing `handleStop` confirm dialog (`ConsoleHeader.tsx:98-145`) is updated for agents where the promote predicate (`canPromote`, already defined at line 160) holds. The dialog copy for these agents replaces the current *"will leave those changes on disk but will not commit or push them"* warning with: *"Stopping this session will auto-commit any pending changes and promote the work to Code Review as task #T-N."* Two confirmation buttons: **Stop and promote** (default) and **Cancel**. A secondary link *"Stop without promoting"* preserves the old behavior for users who explicitly want the scratchpad path.

On confirmed **Stop and promote**, FLEET:

1. If the agent is mid-turn, waits for the turn to finish (or abort to land) before proceeding.
2. Inspects the worktree: commits beyond `origin/main` exist? If yes → promotes directly.
3. No commits, but dirty working tree (modified or untracked files under the worktree)? Runs `git add -A` followed by `git commit -m "chore: capture uncommitted work on session close"`, then promotes. Mirrors the pipeline agent auto-commit behavior in `completion.ts`.
4. No commits and clean worktree? Scratchpad — no promotion; teardown proceeds as today.

On confirmed **Stop without promoting**, current behavior is preserved: session ends, worktree remains as today.

**Trigger 2 — Console header button (discoverability fix)**

The existing `canPromote` predicate (`(agent.status === 'done' || agent.status === 'running') && !!agent.worktreePath && !agent.sprintTaskId`) is preserved. This already correctly excludes pipeline agents (which carry `sprintTaskId`) and limits the button to worktree-having sessions in done/running state, so Adhoc and Assistant agents with worktrees get it and Reviewer / Copilot / Synthesizer do not (they have no `worktreePath`).

The discoverability problem is solved by:

- Replacing the icon-only button with an icon + label pair: `GitPullRequest` glyph + the text *"Promote to Code Review"*.
- Giving it its own styling distinct from the neutral icon buttons (e.g., the existing accent color `var(--fleet-accent)` is retained, but the button becomes primary-shaped rather than a 28px square icon).
- Moving it to the left of the icon cluster — visually adjacent to the task name and model badge, not hidden in the action-icon row.

Click path is unchanged in shape — `window.api.agents.promoteToReview(agent.id)` — but the IPC handler now passes `{autoCommitIfDirty: true}` into the service so the button honors the same auto-commit semantics as the close path.

**Trigger 3 — Agent tool call**

A new `promote_to_review` tool is registered for adhoc and assistant spawns only (not pipeline, reviewer, copilot, synthesizer). The user says *"send this to code review"* in chat; the agent's model recognizes the intent and calls the tool. The tool handler delegates to the promotion service with `autoCommitIfDirty: true`. The tool result returns `{ok: true, taskId: "T-123"}` on success or a human-readable error string, which the agent then references in its next message.

### Idempotency

On successful promotion, the adhoc agent's meta row has its existing `sprintTaskId` field written with the newly created review task's id. No new column is introduced for idempotency — `sprintTaskId` already exists on `agent_runs` and is already consulted by the `canPromote` predicate (`!agent.sprintTaskId`). Writing it on promotion has two aligned effects:

1. The button disappears from `ConsoleHeader.tsx` (since `canPromote` becomes false), which is the correct state: there's no second task to create.
2. Subsequent close / tool-call triggers read the same field, find it populated, and short-circuit with `{ok: true, taskId}` without creating duplicate tasks or emitting duplicate system messages.

**Semantic note.** Today, pipeline agents acquire `sprintTaskId` at spawn (pre-bound to the task they're executing). Adhoc/assistant agents acquire it retroactively via promotion. Both meanings are "this agent is bound to that sprint task" — the timing differs but the field is authoritative in either case. No separate `promoted_task_id` is required.

**Stale-meta race guard.** `promoteAdhocToTask()` re-reads `AgentMeta` via `getAgentMeta(agentId)` at the top of the function, before the idempotency check. This prevents a stale snapshot (e.g., a button-path caller invoking the service with in-memory meta from before the tool-path already promoted) from bypassing the guard.

**Live diffs flow through without snapshot work.** New commits produced after the first promotion appear in Code Review automatically. This is backed by the current read logic in `src/renderer/src/hooks/useReviewChanges.ts`: when `task.worktree_path` is set and exists on disk, the hook reads the live diff from the worktree and only falls back to `review_diff_snapshot` when the worktree is gone. Since the worktree is preserved across the adhoc session's lifetime, Code Review sees live commits without any snapshot refresh. The snapshot exists solely for post-teardown review.

### User-visible outcomes

Every successful promotion — regardless of trigger — produces three artifacts:

1. **Transcript system line** — A non-agent event injected into the agent event stream and persisted to `agent_events`: *"✓ Promoted to Code Review → Task #T-123"*. Renders as a system row in the console, distinct from agent-generated content. Replays on history reload.
2. **Toast** — Fires once in the renderer on receipt of a `review:queueChanged` broadcast.
3. **Code Review nav badge** — Small count badge on the Code Review nav entry. Count = review-status tasks with `promoted_to_review_at > ui.last_review_opened_at`. Clears to zero when the user opens Code Review. Also benefits pipeline completions; not adhoc-specific.

### Schema changes

Two new fields (no third). The idempotency marker reuses the existing `agent_runs.sprintTaskId` column — see §Idempotency.

| Field | Location | Purpose |
|---|---|---|
| `sprint_tasks.promoted_to_review_at` (TEXT, ISO8601, nullable) | New column via SQLite migration (next sequential `vNNN`) | Timestamps when a task transitioned into `review` status. Written by both `transitionToReview()` (pipeline path) and `createReviewTaskFromAdhoc()` (adhoc path). Used by the nav badge selector. |
| `settings.ui.last_review_opened_at` (TEXT, ISO8601) | Existing `settings` table, new key | Written on Code Review view mount (debounced so remounts don't churn). Read by the badge selector. No migration beyond a default insert. |

Badge comparison is strict: `promoted_to_review_at > last_review_opened_at`. The write order on view open is (1) persist `last_review_opened_at = now()`, (2) trigger re-render, so any promotion arriving after the write naturally surfaces the next time the user leaves and re-enters the view.

Migration tests follow the `vNNN.test.ts` pattern per CLAUDE.md (data-mutating migrations require a dedicated test).

### Error surfaces

All failures are non-destructive; the worktree is never deleted on a failure path (it is the user's recovery surface).

| Failure | Outcome |
|---|---|
| Worktree vanished between session start and trigger | Skip promotion, warning toast, log entry. Close proceeds. |
| Agent mid-turn when close fires | Wait for turn to finish or abort to land. If the turn times out, skip promotion with a warning. |
| `git add -A` or auto-commit fails | Warning toast with reason. Worktree preserved. Agent meta unmarked so the user can retry via the button. |
| `createReviewTaskFromAdhoc()` returns null after successful commit | Warning toast with reason. Worktree preserved. Unmarked so retry is possible. |
| Tool call with clean worktree and no commits | Tool returns an error string (*"No work to promote — nothing committed or modified since branch creation"*). Agent relays it. No task created. |
| Assistant agent with no worktree | Tool / button returns a clear error. No attempt to promote. |
| Double-close race / concurrent tool + close | Idempotency guard on `agent_runs.sprintTaskId` — second caller sees existing task id, returns `{ok: true, taskId}` without side effects. |

## Implementation

Changes grouped by FLEET process boundary.

### Main process

- `src/main/services/adhoc-promotion-service.ts`
  - Extend the `PromoteAdhocParams` / function signature with `autoCommitIfDirty?: boolean` (default `false` for backward compat with existing callers).
  - At the top of the function, re-fetch `AgentMeta` via `getAgentMeta(agentId)`. If `meta.sprintTaskId` is set, return `{ok: true, taskId: meta.sprintTaskId}` (idempotency short-circuit, see §Idempotency).
  - When `autoCommitIfDirty` is true and `hasCommitsBeyondMain()` returns false, run `git add -A` + `git commit -m "chore: capture uncommitted work on session close"` inside the worktree (using `execFileAsync` with `buildAgentEnv()`), then re-check for commits. If still none, return `{ok: false, error: ...}`.
  - On successful promotion, write the new task's id into the adhoc agent's `sprintTaskId` via the history layer.
- `src/main/agent-history.ts`
  - Add `setAgentSprintTaskId(agentId, taskId)` helper that persists into the existing `sprintTaskId` column on `agent_runs`. No schema change.
- `src/main/adhoc-agent.ts`
  - Expose a `stopAndPromote(agentId)` orchestrator that: (a) calls `promoteAdhocToTask(agentId, {autoCommitIfDirty: true})`, (b) emits the `agent:promoted` event and `review:queueChanged` broadcast, (c) kills the SDK session regardless of promotion outcome. If promotion fails, emit a warning toast and still tear down; worktree preservation on failure is the service's responsibility.
  - Separately expose `stopWithoutPromoting(agentId)` that skips promotion and only tears down. (Wired for the secondary dialog action.)
- `src/main/agent-manager/sdk-adapter.ts` (or the adhoc spawn path — verify at implementation)
  - Register an in-process MCP server exposing a single `promote_to_review` tool for adhoc and assistant spawns only. Tool handler calls `promoteAdhocToTask(agentId, {autoCommitIfDirty: true})` directly (same path as the main-process orchestrator; the tool runs inside the main process since it's in-process MCP). If SDK support is unavailable at the version in `package.json`, Trigger 3 is descoped per §Dependencies; no fallback is implemented.
- `src/main/agent-event-mapper.ts`
  - Add a new `agent:promoted` event variant (payload: `{ taskId: string; trigger: 'close' | 'button' | 'tool' }`). Persist via the existing `emitAgentEvent()` path so it hits both the renderer broadcast and `agent_events`.

### Preload / IPC

- `agents:promoteToReview` — existing handler, extended to accept an optional payload `{autoCommitIfDirty?: boolean}`. Default `false` to preserve prior behavior. The button path passes `true`. Signature change is additive.
- `agents:stopAndPromote` — **new** channel. Renderer calls this from the updated stop confirm dialog when the user chooses *"Stop and promote"*. Main-side handler delegates to `stopAndPromote(agentId)` in `adhoc-agent.ts`, which orchestrates promote-then-kill atomically. Keeps the renderer from having to sequence two IPCs and handle partial-failure UI.
- `agents:kill` — existing handler, unchanged. Used by the secondary *"Stop without promoting"* action and by all non-promote-eligible stops (pipeline agents, assistant-with-no-worktree, etc.).
- Tool-path (Trigger 3) runs in-process via the SDK's MCP integration — no IPC involvement.
- New broadcast channel `review:queueChanged` — emitted after successful promotion; renderer listens to update the nav badge and fire a toast.

### Renderer

- `src/renderer/src/components/agents/ConsoleHeader.tsx`
  - Keep the existing `canPromote` predicate (no change needed — pipeline is already excluded via `!sprintTaskId`, reviewer/copilot/synthesizer have no `worktreePath`). The predicate's `!sprintTaskId` clause will naturally hide the button once promotion writes the field (desired; see §Idempotency).
  - Replace the icon-only button (lines 255-265) with an icon + label pair. Promote it visually to a primary-styled action distinct from the neutral icon cluster (Terminal / Stop / Copy Log). Move it out of the `console-header__actions` cluster to its own slot adjacent to the model badge.
  - Update `handlePromote` to continue invoking `window.api.agents.promoteToReview(agent.id, {autoCommitIfDirty: true})`.
  - Update `handleStop` to branch on `canPromote`. When `canPromote` is true, show a custom dialog (the existing `ConfirmModal` component at `src/renderer/src/components/ui/` takes `title`/`message`/`confirmLabel`/`variant` and does not natively support a secondary action link, so a one-off dialog component or a `ConfirmModal` extension is needed — call it out in the plan). Primary action: *"Stop and promote"* → `window.api.agents.stopAndPromote(agent.id)`. Secondary action: *"Stop without promoting"* → `window.api.agents.kill(agent.id)`. When `canPromote` is false, keep the current single-button dialog and existing kill path.
- Agent transcript renderer (verify exact component at implementation)
  - Handle the new `agent:promoted` event kind; render as a distinct system row with a link to the promoted task.
- Toast — emit on `review:queueChanged` broadcast.
- Nav — add a badge to the Code Review view entry in `view-registry.ts`. Badge selector reads review-status tasks with `promoted_to_review_at > ui.last_review_opened_at`. Clears on view open. View registry may need an optional `badgeSelector` field.
- `src/renderer/src/stores/sprintTasks.ts` — add a derived selector `selectUnseenReviewCount(lastOpenedAt)` that returns the badge count.
- Settings key `ui.last_review_opened_at` — written on Code Review view mount (debounced to avoid spam if the view remounts).

### Shared

- `src/shared/types/agent-types.ts`
  - Add the `agent:promoted` event discriminant to the event union. No new agent-meta field needed — reusing existing `sprintTaskId`.
- `src/shared/ipc-channels/`
  - Declare `agents:stopAndPromote` channel with `{ agentId: string }` payload and `{ ok: boolean; taskId?: string; error?: string }` return.
  - Declare `review:queueChanged` broadcast channel.

## Testing

### Unit

- `src/main/services/__tests__/adhoc-promotion-service.test.ts` — extend:
  - Idempotency: second call with an already-promoted agent returns the existing task id without side effects.
  - Auto-commit path: dirty tree → `git add -A` + commit runs → promotion proceeds → task created in `review` status.
  - No-work path: clean tree and no commits → returns an error; no commit, no task.
  - Worktree-missing path: returns an error; no side effects.
- `src/main/__tests__/adhoc-agent.test.ts` (or nearest existing test for the adhoc lifecycle):
  - Close handler calls the promotion service with `autoCommitIfDirty: true` for adhoc and assistant roles only.
  - Close handler does NOT call the service for pipeline / reviewer / copilot / synthesizer roles.
- New `promote-to-review-tool.test.ts`:
  - Tool is registered only for adhoc/assistant spawns.
  - Tool handler delegates to the service and surfaces error strings on failure.

### Component

- `ConsoleHeader.test.tsx`:
  - Button renders for adhoc/assistant sessions with a worktree.
  - Button hidden/disabled for incompatible session types or sessions without a worktree.
  - Click calls `agents:promoteToReview` with the correct agent id.
- Transcript component test:
  - `agent:promoted` event renders as a system row and includes a link to the task.

### Integration

- End-to-end: spawn an adhoc agent, commit a file in the worktree, close the session → verify
  - A sprint task is created in `review` status.
  - Transcript system line appears and replays on reload.
  - Toast fires.
  - Code Review nav badge count increments; clears on view open.
- End-to-end: spawn an adhoc agent, do nothing destructive (pure chat), close → verify no task, no system line, no toast. Scratchpad preserved.
- Regression: existing pipeline agent completion test still passes; `transitionToReview()` is untouched.

### Manual QA checklist

- Adhoc + commits → close → appears in Code Review with all three breadcrumbs.
- Adhoc + dirty tree, no commits → close → auto-commit fires; appears in review.
- Adhoc + clean tree → close → no promotion; agent history shows session, no review entry.
- Mid-session tool call (*"send to code review"*) → task created, session continues; second close is a no-op.
- Mid-session button click → same as tool call.
- Promotion failure path: manually delete worktree mid-session, then close → warning toast, no crash, teardown proceeds.

## Rollout

- Single PR. No feature flag. Behavior change is additive: the existing button works today (it's just hard to find) and the existing manual-promote path stays in place; what's new is discoverability + auto-promote-on-close + the tool.
- Coverage thresholds unchanged; new code ships with its own tests.
- No new npm dependencies expected.

## Dependencies / risks

- **SDK custom-tool support must be confirmed before the implementation plan lands**, not deferred to implementation. The plan author inspects the `@anthropic-ai/claude-agent-sdk` version in FLEET's `package.json` and confirms that `query()` (or the call used by `adhoc-agent.ts`) accepts an `mcpServers` option with in-process servers. If not supported, **Trigger 3 (agent tool) is descoped to a follow-up** and this spec ships with Triggers 1 and 2 only. The user message-scanning fallback mentioned in earlier drafts is explicitly rejected as a substitute — it's a different UX surface and would not land under this spec's banner.
- **No behavior change for pipeline agents** beyond `transitionToReview()` gaining a single `promoted_to_review_at` write. The pipeline completion flow, worktree teardown, and review transition are otherwise untouched.
- **Discoverability button redesign** — moving the button out of the icon cluster is a visible UX change on an established surface. Screenshot / ASCII in the PR body per FLEET's UX PR rule.

## Open questions (none blocking design)

- **Squash-on-merge in Code Review** — the auto-commit path produces a boilerplate *"chore: capture uncommitted work on session close"* trailing commit. If users consistently want to drop it, Code Review can grow a squash option. Out of scope here; revisit after real usage.
- **Promoted-task title derivation for close-triggered promotions** — existing service uses the first non-blank line of the adhoc agent's freeform task text. Keep as-is; adequate for both close and tool paths.
