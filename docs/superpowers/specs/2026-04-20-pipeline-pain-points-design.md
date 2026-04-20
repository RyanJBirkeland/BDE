# Pipeline Dogfood Pain Points — Root-Cause Fix Design

**Date:** 2026-04-20
**Context:** Install-readiness audit (docs/superpowers/audits/2026-04-20/) uncovered 10 operational pain points during its pipeline dogfood runs. This document catalogs the root causes and the shape of each fix so individual implementation plans can reference a common design.

## Motivation

Two rounds of dogfooding (wave-1: 23 P0/P1 tasks; wave-2: 6 P2/P3 tasks) exposed the same small set of root causes producing the same failure modes over and over:

- **Worktree isolation was advisory.** 5 of 7 wave-1 tasks wrote files to the main checkout and committed there directly, bypassing their own git worktree. A prompt-level mitigation in wave-2 dropped the rate to 1 of 6 but did not eliminate it.
- **Completion verification rejected all successful work.** 5 of 6 wave-2 tasks pushed clean conventional commits to their agent branches. Every one was marked `failed: tip-mismatch` because the check compares commit *subject* against task-id strings. 100% of correctly-done work failed the check.
- **Environmental failures cascaded into batch-level damage.** 16 of 23 wave-1 tasks transitioned to `error` in under four minutes when the main repo had one untracked directory. Entire batches are lost to a single environmental slip.
- **Audit docs written in the repo blocked the audit's own tasks.** The main-repo-guard rejects *any* untracked file, including pure documentation, creating a circular dependency between authoring an audit and running its tasks.
- **Operator UX for errored tasks is invisible.** `failure_reason` is left null. No UI banner surfaces when the drain loop is systemically blocked. Re-queueing is manual SQL only.
- **Readiness validation forked between code paths.** MCP `tasks.create` applies a stricter template check than the UI form; direct-SQL bypasses both. Same spec, three outcomes.
- **Schema discoverability gaps.** `epics.create` rejects `icon: "shield"` with an unhelpful Zod length error; the 4-character cap is not mentioned in the description.
- **Re-queue data hygiene.** Setting `status='queued'` on a terminal row leaves `completed_at`, `failure_reason`, `claimed_by` populated with stale values.

None of these are feature gaps. They are root-cause bugs in the pipeline's enforcement, verification, scheduling, and UX layers. This design addresses them at the root.

## Phasing

Work is structured into three phases. **Phase 1 must land before the pipeline can be used reliably for any future dogfooding** — without it, every batch produces the same salvage overhead we hit twice in a row.

| Phase | Root cause | Blocks |
|---|---|---|
| **Phase 1** | 1. Worktree isolation hook | All future pipeline use |
| **Phase 1** | 2. Completion verification rewrite | All future pipeline use |
| **Phase 2** | 3. Drain-loop error classification | Batch dogfooding (fixes scorching + circular docs + operator visibility simultaneously) |
| **Phase 3** | 4. Readiness validation unification | — |
| **Phase 3** | 5. Operator UX surfaces | — |
| **Phase 3** | 6. Data hygiene on re-queue | — |

Phase 3 fixes are parallelizable. Phase 2 can land with or just after Phase 1.

---

## Root Cause 1 — Worktree isolation is advisory, not enforced

### Problem

Pipeline agents run with `cwd` set to their worktree, but the SDK's `Bash`, `Edit`, and `Write` tools accept arbitrary absolute paths. An agent that writes `/Users/ryanbirkeland/Projects/git-repos/BDE/src/main/foo.ts` bypasses the worktree entirely. 5 of 7 wave-1 tasks did exactly this. The resulting commits landed on local `main` via the agent running `git commit` in the main checkout — the completion flow never saw them on the agent branch, so every task was marked `failed: tip-mismatch`.

Wave-2's prompt-level mitigation (explicit constraints in `pipeline-personality.ts`) reduced but did not eliminate the behavior: T-11 still ran `find /Users/.../BDE/docs` (absolute main-repo path), T-46 wrote to `src/main/mcp-server/tools/tasks.test.ts` in the main repo mid-flight, and T-66 committed directly to main.

### Root cause

No enforcement at tool-invocation time. The prompt is advisory; the agent may ignore it, misread paths in grep output as permission to use them, or invent absolute paths from context. Nothing in the execution layer rejects the tool call.

### Fix

Add an SDK `preToolUse` hook, bound at spawn time for pipeline agents only, that inspects every `Bash`, `Edit`, and `Write` invocation and rejects the ones that touch the main checkout.

**New module:** `src/main/agent-manager/worktree-isolation-hook.ts`

```ts
export function createWorktreeIsolationHook(worktreeBase: string, taskWorktreePath: string): PreToolUseHook
```

The hook:
- For `Edit` / `Write`: reject if the resolved absolute path does not begin with `taskWorktreePath + '/'`.
- For `Bash`: reject if the command string contains any of these patterns (parsed conservatively — substring check after argument splitting):
  - `cd <mainRepoPath>` (bare or chained with `&&`)
  - Any argument that is an absolute path under `/Users/<anyone>/Projects/` and points at the primary repo checkout (determined via `getRepoPaths()`)
  - Redirect operators (`>`, `>>`) with absolute targets under the main checkout
- Return a structured rejection with `{ denied: true, reason: string }` so the SDK surfaces the reason to the agent and the agent can self-correct.

**Integration:** Attach the hook inside `spawnAgent` in `src/main/agent-manager/sdk-adapter.ts` only when `opts.pipelineTuning` is set. Adhoc, assistant, copilot, synthesizer, and reviewer spawn paths are untouched.

**Logging:** Every rejection writes a `[worktree-isolation-hook]` entry to the agent-manager log with the tool name, the rejected path, and the reason, so post-run forensics can see whether the hook fired and how often.

### Alternatives considered

- **Disable `Bash` for pipeline agents.** Too restrictive. Agents need `npm test`, `npm run typecheck`, `git add/commit/push`.
- **Post-spawn filesystem watcher.** Reactive — the write has already happened; cleanup races with auto-commit.
- **Stricter prompt.** Wave-2 proved prompt alone is insufficient.

### Acceptance

- A 10-task dogfood batch produces **zero** writes to the main checkout (verified by `git status` being empty throughout and `git log origin/main..HEAD` showing only explicitly-shipped commits).
- A test suite for the hook covers: allowed relative path, allowed worktree-absolute path, denied main-checkout absolute path, denied `cd` prefix in Bash, denied redirect operator.
- Non-pipeline agents (adhoc, assistant, copilot, synthesizer) are unaffected — verified by their existing test suites passing unchanged.

### Files expected to change

- `src/main/agent-manager/worktree-isolation-hook.ts` (new)
- `src/main/agent-manager/worktree-isolation-hook.test.ts` (new)
- `src/main/agent-manager/sdk-adapter.ts` (attach hook when pipelineTuning is set)
- `src/main/agent-manager/spawn-sdk.ts` (thread hook through to SDK options)

---

## Root Cause 2 — Completion verification rejects clean conventional commits

### Problem

After the agent exits, the completion flow in `src/main/agent-manager/completion.ts` checks the tip commit on the agent branch and expects its subject to match one of: the task UUID (`agent_run_id`), the task title verbatim, or the task id (`audit-20260420-t-NN`). Agents correctly follow BDE's commit-message convention (`{type}({scope}): {what} — {why}`) which contains none of those. Result: every successful agent run is flagged `failed: tip-mismatch` and requires manual cherry-pick salvage from `origin/agent/*` branches.

This is a 100% false-positive rate against clean commits. Wave-2 produced 5 salvageable cases out of 6.

### Root cause

The check assumes agents write commit subjects that identify the task. They don't — and shouldn't, because the commit-message convention prioritizes what-and-why prose over bookkeeping. The task linkage is already encoded elsewhere:
- The branch name: `agent/t-11-pass-encoding-utf8-to-execfile-in-a-064f79ef` contains the task ID (`t-11`) and group ID.
- The `~/.bde/memory/tasks/<task-id>/` scratchpad directory.
- The worktree path itself.

The check is pattern-matching the wrong artifact.

### Fix

Use the branch name as the primary source of truth.

**Edit:** `src/main/agent-manager/completion.ts`

- Add `extractTaskIdFromBranch(branch: string): string | null` using the regex `/^agent\/t-([a-zA-Z0-9-]+?)-[a-f0-9]{8}$/`. The captured group after `t-` is the task id slug; reassemble to match against the full task id (e.g., `audit-20260420-t-11`).
- The existing tip-check continues to verify the branch has at least one commit beyond `origin/main` (legitimate "no work done" detection).
- Keep commit-subject matching as a *secondary* signal for forward-compat — if the branch-name extraction returns null (e.g., manually-created branch with non-standard name), fall back to the old behavior.
- Remove UUID matching from the check; branch-name + subject cover every legitimate path.

### Alternatives considered

- **Require a `Refs: <task-id>` commit trailer.** Agents must be taught to write it; forgetting = same bug. Also requires updating the commit-message convention in CLAUDE.md. Brittle.
- **Check every commit on the branch, not just tip.** Still string-matching; still brittle if subjects don't identify the task.
- **Use scratchpad presence.** Confirms the agent ran, not that its work is correct — doesn't tell us whether commits landed on the branch.

### Acceptance

- Replay test: all 6 wave-2 salvage cases (T-11, T-13, T-17, T-44, T-46, T-66's agent branch if it existed) pass the new check.
- Regression test: a branch with zero commits beyond `origin/main` still fails the check (legitimate "agent did nothing").
- Integration test: spawn a fake agent that creates a worktree, makes a conventional commit, pushes to `agent/t-99-...`, exits; the completion flow marks it `review`, not `failed`.

### Files expected to change

- `src/main/agent-manager/completion.ts`
- `src/main/agent-manager/completion.test.ts` (new cases; file may not exist yet — create if needed)

---

## Root Cause 3 — Drain loop cannot distinguish environmental from spec failures

### Problem

When the main repo is dirty, the `main-repo-guard` rejects every worktree setup attempt with the same error. The drain loop treats each rejection as a per-task fast-fail, burning through the entire queue in minutes and transitioning every queued task to `error` status. Wave-1 observed 16 tasks destroyed in ~4 minutes. The tasks themselves are fine — the environment is broken — but the scheduler kills them as if they were individually broken.

Three downstream pains are all caused by this single scheduler bug:

- **Fast-fail scorching** (16-tasks-in-4-minutes symptom)
- **Circular dogfood dependency** (untracked audit docs trip the guard that then scorches the audit's tasks)
- **`failure_reason` empty** (the agent-manager log has the details but the task row does not)
- **No UI banner** on systemic drain blockage

All four collapse into one fix.

### Root cause

`src/main/agent-manager/failure-classifier.ts` already exists for distinguishing SDK-level errors. It does not have an "environmental" category for spawn-time guard rejections. The drain loop (`drain-loop.ts`) calls the classifier only after the SDK returns — but worktree setup failures happen *before* the SDK is reached and are treated as fatal by the spawning path.

### Fix

Extend the classifier and the drain loop.

**Classifier:** `src/main/agent-manager/failure-classifier.ts`

Add an `environmental` category with detectors for:
- `Main repo has uncommitted changes` (main-repo-guard)
- `No repo path` (missing repo configuration)
- Credential/auth errors from `credential-service`
- Network errors during `git fetch origin`

These map to `FailureCategory.Environmental`.

**Drain loop:** `src/main/agent-manager/drain-loop.ts`

When `setupWorktree` or a pre-spawn precondition fails:
1. Classify the failure.
2. If `Environmental`: set the task's `failure_reason` to the classified reason (populated column, not just log), leave `status='queued'`, emit a `agentManager:drainPaused` event via broadcast, and pause the drain for `DRAIN_PAUSE_ON_ENV_ERROR_MS` (30 seconds — long enough to signal, short enough to auto-recover).
3. If spec-level: current behavior (retry with backoff, eventually fail).

**Status event:** New broadcast channel `agentManager:drainPaused` with payload `{ reason: string; pausedUntil: number; affectedTaskCount: number }`. The renderer subscribes in a new `useDrainStatus` hook (or extends an existing one) and renders a Dashboard/Pipeline banner.

**Circular docs fix embedded:** The main-repo-guard itself should get a `docs-only` escape — if every dirty path matches `^docs/.*\.md$` OR `^docs/.*\.svg$` etc., it's non-fatal. This is a small scoped relaxation; the guard still catches actual source pollution.

### Alternatives considered

- **Circuit breaker on repeat errors.** Simpler but slower — takes N failures before reacting, still wastes the first few tasks.
- **Task-level skip vs abort flag.** Same behavior as above but exposed differently to the scheduler.

### Acceptance

- With dirty main: drain emits one `drainPaused` event, 0 tasks transition to `error`, `failure_reason` is populated on every queued row, UI banner shows within 2 seconds.
- With clean main: drain resumes on the next tick after the pause window; tasks claim normally.
- With pure-docs dirty state (audit writing `docs/*.md`): the guard does not fire; drain proceeds.
- Spec-level failures still retry-and-fail as before (regression check).

### Files expected to change

- `src/main/agent-manager/failure-classifier.ts`
- `src/main/agent-manager/failure-classifier.test.ts`
- `src/main/agent-manager/drain-loop.ts`
- `src/main/agent-manager/drain-loop.test.ts` (new case)
- `src/main/agent-manager/main-repo-guard.ts` (docs-only escape)
- `src/main/broadcast.ts` (new channel if needed)
- `src/preload/index.ts` (subscriber bridge)
- `src/renderer/src/hooks/useDrainStatus.ts` (new or extended)
- `src/renderer/src/views/DashboardView.tsx` and/or `SprintPipeline.tsx` (banner render)

---

## Root Cause 4 — Readiness validation forks across code paths

### Problem

Creating a task by three paths produces three different outcomes:

- **UI form** (Task Workbench) calls `createTaskWithValidation` — structural + heading checks. Fair.
- **MCP `tasks.create`** also calls `createTaskWithValidation` but *additionally* enforces a hardcoded required-heading list ("## Overview") that the UI doesn't. Stricter than UI.
- **Direct SQL insert** bypasses both entirely.

### Root cause

The MCP handler wraps the shared validator with an additional ad-hoc check. There's no single policy surface.

### Fix

Make `createTaskWithValidation` the single policy surface. Remove the MCP-specific extra check. If the MCP needs an admin-bypass for batch tooling, expose it explicitly.

**Edit:** `src/main/services/sprint-service.ts`
- Extend the signature: `createTaskWithValidation(input, deps, opts?: { skipReadinessCheck?: boolean })`.
- When `skipReadinessCheck` is true, the service skips the heading/section validator but still runs structural validation (required fields, repo configured, no forbidden fields). Logged when used, with the caller's identity (from `deps.logger` context).

**Edit:** `src/main/mcp-server/tools/tasks.ts`
- Drop the MCP-layer readiness check.
- Expose the `skipReadinessCheck` boolean via the MCP schema (default false, documented as admin-only).

**Error codes:** Every validation failure returns `{ code: 'spec-structure', message, field? }` instead of free-text strings — MCP clients can branch on `code`.

### Alternatives considered

- **Relax MCP to match UI.** Same effect but less explicit — no record of *why* MCP was strict.
- **Tighten SQL path.** Adds an INSERT trigger; breaks batch tooling by design.

### Acceptance

- The same spec produces the same `{ ok, errors }` outcome via UI, MCP, and MCP-with-`skipReadinessCheck`.
- A CreateTaskInput spec with `## Overview` missing is accepted via UI (default profile) but rejected via MCP with the *new shared* check — not the old ad-hoc one. Current behavior drifts resolved.
- All validation errors carry a machine-readable `code`.

### Files expected to change

- `src/main/services/sprint-service.ts` (`createTaskWithValidation` signature + logic)
- `src/main/services/task-validation.ts` (error-code shape)
- `src/main/mcp-server/tools/tasks.ts` (remove extra check, add bypass)
- `src/main/mcp-server/schemas.ts` (expose `skipReadinessCheck`)
- Related tests

---

## Root Cause 5 — Operator UX surfaces for errored / paused tasks

### Problem

When things go wrong, the operator has no in-app affordances:
- No retry button on errored tasks — manual SQL only.
- `failure_reason` column empty in the task row (log-only).
- No banner when drain is systemically paused.
- MCP schema hints missing (e.g., `icon` cap) — users discover constraints by failing the call.

### Root cause

Operator UX was secondary during feature build-out. Each missing affordance is a small patch; together they matter.

### Fix

Three small independently-shippable patches:

**5a. Retry button on errored tasks.** Task Pipeline row action for `status='error'` rows. Wires to `sprint:update` with `{ status: 'queued' }` AND calls `resetTaskForRetry(id)` (see #6) in the same IPC handler so the row looks fresh. Button hidden when task is not in `error` / `failed` / `cancelled` state.

**5b. MCP schema description polish.** Expand the `description` strings on MCP schemas that have length caps or narrow enums:
- `icon`: `"Single emoji glyph identifying the epic (max 4 chars)"`
- Any other short-description fields discovered via `grep "description: '" src/main/mcp-server/schemas.ts`.

**5c. Drain-status banner.** (Delivered by Root Cause 3 — listed here for completeness; the subscriber and banner component live in this group.)

### Acceptance

- Retry button round-trips: click → row goes to `queued` → drain picks it up within 30s.
- `failure_reason` is shown alongside the row when populated (delivered by #3 + this UI).
- MCP `epics.create` with `icon: "shield"` returns an error whose message matches the schema description exactly (not the raw Zod length error).

### Files expected to change

- `src/renderer/src/components/sprint/TaskDetailActionButtons.tsx` or sibling (retry button)
- `src/renderer/src/hooks/useDrainStatus.ts` (banner subscriber — see #3)
- `src/renderer/src/views/DashboardView.tsx` (banner placement)
- `src/main/mcp-server/schemas.ts` (description polish)
- `src/main/handlers/sprint-retry-handler.ts` (retry IPC — existing file; extend to call `resetTaskForRetry`)

---

## Root Cause 6 — Re-queue leaves stale terminal-state fields

### Problem

Running `UPDATE sprint_tasks SET status='queued' WHERE id=?` on a terminal row leaves `completed_at`, `failure_reason`, `claimed_by`, `started_at`, `retry_count`, `fast_fail_count`, and `next_eligible_at` populated from the prior run. Re-queued tasks look half-terminal in the UI, and the retry counter can immediately re-trip fast-fail.

### Root cause

No symmetric reset step. `updateTask` only sets the fields in its patch.

### Fix

Add `resetTaskForRetry(id)` to sprint-service. Clears `completed_at`, `failure_reason`, `claimed_by`, `started_at`, `retry_count`, `fast_fail_count`, `next_eligible_at`. Status is set explicitly by the caller (usually `'queued'`, but `'backlog'` is valid too).

**Callers:**
- The Retry button IPC (#5a)
- The MCP `tasks.update` path when transitioning from a terminal status back to `'queued'` (new logic inside the handler)
- Any admin SQL tooling — documented in CLAUDE.md

### Alternatives considered

- **Trigger on status change.** SQLite triggers are possible but spread the contract across SQL and code. Simpler to do it in one service function.

### Acceptance

- After `resetTaskForRetry(id)` followed by `status='queued'`, the row's terminal-state fields are null, the retry counters are zero, and the Pipeline UI renders the task as freshly queued.
- Unit tests cover the reset for each field.

### Files expected to change

- `src/main/services/sprint-service.ts`
- `src/main/handlers/sprint-retry-handler.ts`
- `src/main/mcp-server/tools/tasks.ts` (terminal→queued transition detection)

---

## Cross-cutting design decisions

- **No new top-level directories.** Every fix lives in the existing `src/main/agent-manager/`, `src/main/services/`, `src/main/handlers/`, `src/renderer/src/hooks/`, or `src/renderer/src/views/` layers. We respect the existing module map in `docs/modules/`.
- **Tests at the fix boundary.** Each root-cause fix ships with unit tests for its new code + one integration test where the fix crosses a process boundary (hook + spawn, completion + worktree, drain + failure classifier).
- **No breaking changes to MCP tool schemas.** Additive only. New `skipReadinessCheck` field defaults to false; existing clients unaffected.
- **Module docs.** Each source file touched gets a row in `docs/modules/<layer>/index.md` (and a detail file if exports/behavior change), per CLAUDE.md's pre-commit policy.

## Whole-effort acceptance

A second audit batch queued after this work is complete should exhibit:

- **0% bypass rate** (Root Cause 1 enforces).
- **0 tip-mismatch false positives** on successful agent runs (Root Cause 2).
- **0 `error` transitions** from environmental causes in a batch where main is temporarily dirty (Root Cause 3).
- **No manual SQL required** to re-queue an errored task, no manual log-spelunking required to see why it errored (Root Causes 5 + 6).
- **Consistent validation outcomes** across UI, MCP, and MCP-bypass (Root Cause 4).

When all six root causes are shipped and those criteria hold, pipeline dogfooding becomes a supported workflow rather than a salvage operation.
