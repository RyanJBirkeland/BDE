# Adhoc Agent Auto-Promotion to Code Review — Design

**Date:** 2026-04-22
**Status:** Design approved; awaiting implementation plan
**Related files:** `src/main/services/adhoc-promotion-service.ts`, `src/main/agent-manager/review-transition.ts`, `src/main/handlers/agent-handlers.ts`, `src/main/adhoc-agent.ts`, `src/renderer/src/components/agents/ConsoleHeader.tsx`

## Motivation

Pipeline agents auto-escalate to the Code Review Station on completion. Adhoc and Assistant agents — both user-spawned, both running in `~/.bde/worktrees-adhoc/`, both capable of committing code — do not. They are intentionally treated as "scratchpads" that never enter the sprint task lifecycle unless the user explicitly clicks a "Promote to Code Review" button.

Two things are broken with this model:

1. **The button is missing or not rendering** in the console header today. The scratchpad helper text in the Agents sidebar still references it, so something in `ConsoleHeader.tsx` has drifted from intent. Users must verbally prompt the agent — *"push the changes to code review"* — and agents interpret this as `git push`, which pushes to GitHub but does not put anything in BDE's Code Review queue.
2. **Even if the button worked**, it is silent: an adhoc agent that has finished committing work never announces itself, and there is no UI breadcrumb drawing the user back to Code Review. The user has to remember to check. Pipeline agents do not have this failure mode because the task status flips to `review` automatically and the Code Review view updates.

The fix is to make user-spawned agents (Adhoc + Assistant) behave like pipeline agents at the boundary that matters — work that produces commits ends up in Code Review, with the user notified, regardless of agent type.

## Scope

**In scope**

- BDE Adhoc agents (role: `adhoc`)
- BDE Assistant agents (role: `assistant`)

Both share the `~/.bde/worktrees-adhoc/` base and have identical tool access; no valid reason exists for them to diverge at the review boundary.

**Out of scope**

- Pipeline agents — already auto-transition via `transitionToReview()`; unchanged.
- Reviewer / Copilot / Synthesizer — no worktree, or no commits produced.
- Claude Code subagents spawned via the Agent tool with `isolation: "worktree"` — those are orchestrated by Claude Code, not BDE; outside BDE's lifecycle.
- Pure research / chat adhoc sessions that never commit — preserved as scratchpads; no promotion occurs.

## Design

### Lifecycle — three triggers, one promotion path

All three triggers flow through the existing `promoteAdhocToTask()` service in `src/main/services/adhoc-promotion-service.ts` (extended — see §Implementation). The service is the single source of truth for promotion; triggers differ only in how they call it.

**Trigger 1 — Session close (auto)**

When the user clicks stop/close on the agent card, BDE checks the session's role. For `adhoc` and `assistant` sessions only:

1. If the agent is mid-turn, wait for the turn to finish (or abort to land).
2. Inspect the worktree: commits beyond `origin/main` exist? If yes → promote directly.
3. No commits, but dirty working tree (modified or untracked files under the worktree)? Run `git add -A` followed by `git commit -m "chore: capture uncommitted work on session close"`, then promote. Mirrors the pipeline agent auto-commit behavior in `completion.ts`.
4. No commits and clean worktree? Scratchpad — do nothing; teardown proceeds as today.

**Trigger 2 — Console header button**

Fix the broken/missing "Promote to Code Review" button in `ConsoleHeader.tsx`. Button is visible only for `adhoc` and `assistant` sessions that have a worktree. Clicking it invokes `agents:promoteToReview` IPC with the current agent id. Same auto-commit-if-dirty semantics as the close path.

**Trigger 3 — Agent tool call**

A new `promote_to_review` tool is registered for adhoc and assistant spawns only (not pipeline, reviewer, copilot, synthesizer). The user says *"send this to code review"* in chat; the agent's model recognizes the intent and calls the tool. The tool handler delegates to the promotion service. The tool result returns `{ok: true, taskId: "T-123"}` on success or a human-readable error string, which the agent then references in its next message.

### Idempotency

After the first successful promotion, the agent meta is marked with `promotedTaskId`. Subsequent triggers (close, button, tool call) check this field and return early with `{ok: true, taskId}` — no second task is created, no duplicate system messages are emitted. New commits produced after the first promotion automatically flow into the existing review entry because the Code Review view reads from the live branch / worktree, not the frozen diff snapshot captured at promotion time. The snapshot only matters after worktree teardown.

### User-visible outcomes

Every successful promotion — regardless of trigger — produces three artifacts:

1. **Transcript system line** — A non-agent event injected into the agent event stream and persisted to `agent_events`: *"✓ Promoted to Code Review → Task #T-123"*. Renders as a system row in the console, distinct from agent-generated content. Replays on history reload.
2. **Toast** — Fires once in the renderer on receipt of a `review:queueChanged` broadcast.
3. **Code Review nav badge** — Small count badge on the Code Review nav entry. Count = review-status tasks with `promoted_at > ui.lastReviewOpenedAt`. Clears to zero when the user opens Code Review. Also benefits pipeline completions; not adhoc-specific.

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
| Double-close race / concurrent tool + close | Idempotency guard on `promotedTaskId` — second caller sees existing task id, returns `{ok: true, taskId}` without side effects. |

## Implementation

Changes grouped by BDE process boundary.

### Main process

- `src/main/services/adhoc-promotion-service.ts`
  - Extend the `PromoteAdhocParams` interface with `autoCommitIfDirty?: boolean` (default `false` for backward compat with existing callers).
  - When set and `hasCommitsBeyondMain()` returns false, run `git add -A` + `git commit -m "chore: capture uncommitted work on session close"` inside the worktree (using `execFileAsync` with `buildAgentEnv()`), then re-check for commits. If still none, return `{ok: false, error: ...}`.
  - Idempotency: before doing anything, read `agent.promotedTaskId`. If set, return `{ok: true, taskId: agent.promotedTaskId}`.
  - On successful promotion, call a new `markAgentPromoted(agentId, taskId)` in the history layer.
- `src/main/agent-history.ts`
  - Add `promotedTaskId?: string` to the `AgentMeta` shape.
  - Add `markAgentPromoted(agentId, taskId)` helper that persists the field.
- `src/main/adhoc-agent.ts`
  - In the close / teardown path, before worktree cleanup is considered: for `role: 'adhoc' | 'assistant'` sessions, call `promoteAdhocToTask(agentId, meta, {autoCommitIfDirty: true})`. Log and emit a warning toast on non-idempotent errors; proceed with teardown regardless.
- `src/main/agent-manager/sdk-adapter.ts` (or the adhoc spawn path — verify at implementation)
  - Register an in-process MCP server exposing a single `promote_to_review` tool for adhoc and assistant spawns only. Tool handler delegates to `promoteAdhocToTask()`. If the SDK version in BDE does not support in-process MCP servers for adhoc, fall back to scanning each user message for a canonical intent phrase (`/promote-to-review` or a natural-language marker) before forwarding to the SDK — less elegant but equivalent behavior.
- `src/main/agent-event-mapper.ts`
  - Add a new `agent:promoted` event variant (payload: `{ taskId: string; trigger: 'close' | 'button' | 'tool' }`). Persist via the existing `emitAgentEvent()` path so it hits both the renderer broadcast and `agent_events`.

### Preload / IPC

- Existing `agents:promoteToReview` handler remains the single entry point. No new handler needed. (The close-path and tool-path both call the service directly in main, not via IPC.)
- New broadcast channel `review:queueChanged` — emitted after successful promotion; renderer listens to update the nav badge and fire a toast.

### Renderer

- `src/renderer/src/components/agents/ConsoleHeader.tsx`
  - Audit the render path. Expected behavior: the "Promote to Code Review" button is visible when `agent.role === 'adhoc' || agent.role === 'assistant'` AND `agent.worktreePath` is set. Currently missing or hidden — fix whatever invariant drifted.
  - Button click calls `window.api.agents.promoteToReview(agentId)`; UI surface shows inflight state + toast on result.
- Agent transcript renderer (`src/renderer/src/components/agents/` — verify file at implementation)
  - Handle the new `agent:promoted` event kind; render as a distinct system row with a link to the promoted task.
- Toast — emit on `review:queueChanged` broadcast.
- Nav — add a badge to the Code Review view entry in `view-registry.ts`. Badge selector reads review-status tasks with `promoted_at > ui.lastReviewOpenedAt`. Clears on view open. View registry may need an optional `badgeSelector` field.
- `src/renderer/src/stores/sprintTasks.ts` — add a derived selector for the unseen-review count.
- Settings row `ui.lastReviewOpenedAt` — persisted on Code Review view open.

### Shared

- `src/shared/types/agent-types.ts`
  - Add `promotedTaskId?: string` to the agent meta type.
  - Add the `agent:promoted` event discriminant to the event union.
- `src/shared/ipc-channels/` — declare the `review:queueChanged` channel.

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

- Single PR. No feature flag. Behavior change is additive (new breadcrumbs + working button) and the existing manual-promote path is preserved.
- Coverage thresholds unchanged; new code ships with its own tests.
- No new npm dependencies expected. SDK custom-tool registration is confirmed against the `@anthropic-ai/claude-agent-sdk` version already in use during implementation.

## Open questions (none blocking design)

- **Squash-on-merge in Code Review** — the auto-commit path produces a boilerplate *"chore: capture uncommitted work on session close"* trailing commit. If users consistently want to drop it, Code Review can grow a squash option. Out of scope here; revisit after real usage.
- **Promoted-task title derivation for close-triggered promotions** — existing service uses the first non-blank line of the adhoc agent's freeform task text. Keep as-is; adequate for both close and tool paths.
