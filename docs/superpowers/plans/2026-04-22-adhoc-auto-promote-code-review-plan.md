# Adhoc Auto-Promote to Code Review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make user-spawned agents (Adhoc + Assistant) auto-escalate committed work to the Code Review Station on session close, via a discoverable console-header button, and — if the SDK supports it — via an in-process `promote_to_review` agent tool. Add transcript, toast, and nav-badge breadcrumbs on every promotion.

**Architecture:** Reuse the existing `promoteAdhocToTask()` service as the single promotion path; extend it with an `autoCommitIfDirty` option and an idempotency guard that reads/writes the existing `agent_runs.sprint_task_id` column. Add a new `agents:stopAndPromote` IPC channel so the close-path orchestrates promote-then-kill atomically in the main process. Two tiny schema changes: a `promoted_to_review_at` column on `sprint_tasks` (to power the nav badge) and a `ui.last_review_opened_at` settings key (the badge's watermark).

**Tech Stack:** TypeScript, Electron (main/preload/renderer), React + Zustand, vitest, SQLite (better-sqlite3), `@anthropic-ai/claude-agent-sdk`.

**Related docs:**
- Design spec: `docs/superpowers/specs/2026-04-22-adhoc-auto-promote-code-review-design.md`
- BDE conventions: `CLAUDE.md`, `docs/BDE_FEATURES.md`

---

## Ground rules

- Work in this worktree: `~/worktrees/BDE/chore-spec-adhoc-auto-promote-review`. The branch is `chore/spec-adhoc-auto-promote-review`. Do NOT switch branches, do NOT touch `~/projects/BDE` directly.
- TDD: red → green → refactor → commit. One logical change per commit.
- Before EVERY commit: `npm run typecheck` zero errors, `npm test` all pass, `npm run lint` zero errors (warnings OK). Plus update `docs/modules/` per the table in CLAUDE.md.
- Use `safeHandle()` for all new IPC handlers. Pass `parseArgs` validators on channels that accept user-controlled JSON.
- Use `execFileAsync` from `src/main/lib/async-utils.ts` with argument arrays. Never string-interpolated shell commands.
- New main-process modules: use `createLogger(name)` from `src/main/logger.ts`. Not raw `console.*`.
- SQLite multi-statement SQL gotcha (from CLAUDE.md): assign SQL to `const sql = ...` on its own line before passing to the DB method. Single-statement DDL can use a string literal argument directly.

---

## Task 1: Confirm SDK custom-tool support (gates Task 17)

**Why first:** If the installed `@anthropic-ai/claude-agent-sdk` version doesn't support in-process MCP servers at the `query()` call used by `adhoc-agent.ts`, Trigger 3 (the `promote_to_review` agent tool) is descoped per §Dependencies of the spec. Tasks 2–16 ship without it. We need to know up front.

**Task 1 outcome (2026-04-22):** SDK SUPPORTS: proceed with Task 17. Version: 0.2.81. `mcpServers` is declared on the `Options` type at `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1020` as `mcpServers?: Record<string, McpServerConfig>`, and `McpServerConfig` (sdk.d.ts:607) includes the in-process variant `McpSdkServerConfigWithInstance` (sdk.d.ts:600) — i.e. in-process (not just HTTP/stdio) servers are first-class. In-process server factory: `createSdkMcpServer` (exported at `sdk.d.ts:324`). The call site in `src/main/adhoc-agent.ts` is `sdk.query({ prompt, options })` at `src/main/adhoc-agent.ts:293`, where `options` is built from `baseOptions` (defined at `src/main/adhoc-agent.ts:155`) which already passes `mcpServers: { bde: plannerServer }` (line 164) — confirming both that the `Options` object accepts `mcpServers` and that the adhoc path is already wired for in-process MCP servers. Task 17 can register the `promote_to_review` tool under the same `mcpServers` field, either by adding a second server or by extending `plannerServer`.

**Files:**
- Read: `package.json` (root)
- Read: the SDK's type definitions (likely `node_modules/@anthropic-ai/claude-agent-sdk/dist/*.d.ts`)
- Read: `src/main/adhoc-agent.ts` — find the `query()` call site and its options object

- [ ] **Step 1:** Read `package.json` and note the installed version of `@anthropic-ai/claude-agent-sdk`.
- [ ] **Step 2:** Inspect the SDK's `Options` / `QueryOptions` type. Confirm whether it has an `mcpServers` field and whether in-process servers (not HTTP) are supported.
- [ ] **Step 3:** Inspect `src/main/adhoc-agent.ts`'s spawn path. Note the exact call site (filename + line) where adhoc/assistant agents are spawned via the SDK.
- [ ] **Step 4:** Record the finding at the top of Task 17 below — either "SDK SUPPORTS: proceed with Task 17" or "SDK DOES NOT SUPPORT: skip Task 17; Trigger 3 descoped." Commit this single-line annotation on the plan file so the execution record is in git.

No code changes beyond that annotation.

---

## Task 2: Migration v053 — add `sprint_tasks.promoted_to_review_at`

**Files:**
- Create: `src/main/migrations/v053-add-promoted-to-review-at-to-sprint-tasks.ts`
- Create: `src/main/migrations/__tests__/v053.test.ts`
- Check: `src/main/migrations/loader.ts` to confirm the loader auto-discovers the new file; if not, add it explicitly following the pattern used by v052.

- [ ] **Step 1: Write the failing migration test first** at `src/main/migrations/__tests__/v053.test.ts`, modeled on `v049.test.ts`. Two cases: (a) existing rows get a NULL value for the new column; (b) ISO8601 timestamps can be written and read back.

- [ ] **Step 2: Run the test — expect FAIL** with `no such column: promoted_to_review_at`:

```bash
cd ~/worktrees/BDE/chore-spec-adhoc-auto-promote-review
npx vitest run src/main/migrations/__tests__/v053.test.ts
```

- [ ] **Step 3: Write the migration.** Use `ALTER TABLE sprint_tasks ADD COLUMN promoted_to_review_at TEXT` as a single-statement DDL. Check a sibling migration (e.g., `v050-add-indices-on-started-at-and-completed-at.ts`) for the exact module shape the loader expects (named `version` const + `up(db)` function, or default export, or whatever convention v050+ use). Mirror it exactly.

- [ ] **Step 4: Run the test — expect PASS.**

- [ ] **Step 5:** Update `docs/modules/` if the migrations layer has an index file (check first — may or may not be required).

- [ ] **Step 6: Commit.**

```bash
git add src/main/migrations/v053-*.ts src/main/migrations/__tests__/v053.test.ts docs/modules
git commit -m "chore: add migration v053 for sprint_tasks.promoted_to_review_at"
```

---

## Task 3: Write `promoted_to_review_at` on transitions (pipeline + adhoc paths)

**Files:**
- Modify: `src/main/agent-manager/review-transition.ts` (pipeline path — `transitionToReview()`)
- Modify: `src/main/data/sprint-task-crud.ts` (adhoc path — `createReviewTaskFromAdhoc()` is defined here, around line 239, despite the re-export wrapper in `sprint-service.ts`)
- Modify: `src/shared/types/task-types.ts` — add `promoted_to_review_at?: string` to `SprintTask`
- Modify: `src/main/data/sprint-task-mapper.ts` — hydrate the field on read
- Test: extend the corresponding existing tests

- [ ] **Step 1:** Confirm `createReviewTaskFromAdhoc` is in `src/main/data/sprint-task-crud.ts` (grep to be sure — the file may have been renamed since this plan was written). `nowIso` is already imported there — don't add a duplicate import.

- [ ] **Step 2: Write failing tests** asserting both paths write `promoted_to_review_at` to a valid ISO8601 string on transition to `review`. Follow the existing test style in those files.

- [ ] **Step 3: Run — expect FAIL** (the field is never set).

- [ ] **Step 4: Implement.** In `review-transition.ts`, add `promoted_to_review_at: nowIso()` to the `repo.updateTask()` payload (`nowIso` is already imported from `../../shared/time`). In `createReviewTaskFromAdhoc()`, add the same field to the insert. Add the field to `SprintTask` in `src/shared/types/task-types.ts` and hydrate it in `sprint-task-mapper.ts` mirroring the `completed_at` handling.

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: Run typecheck + full suite** (new optional field may ripple through narrower view types):

```bash
npm run typecheck && npm test
```

- [ ] **Step 7:** Update `docs/modules/` for every file touched (mapper, types, review-transition, sprint-service).

- [ ] **Step 8: Commit.**

```bash
git commit -m "feat(data): record promoted_to_review_at on review transition"
```

---

## Task 4: Extend `promoteAdhocToTask()` signature — options param + stale-meta guard

**Files:**
- Modify: `src/main/services/adhoc-promotion-service.ts`
- Create-or-extend: `src/main/services/__tests__/adhoc-promotion-service.test.ts`

- [ ] **Step 1:** Check whether `src/main/services/__tests__/adhoc-promotion-service.test.ts` exists. If not, scaffold it from an existing service test (`sprint-service.test.ts` is a good model).

- [ ] **Step 2: Write failing tests** for the new signature AND idempotency re-fetch:
  - Test A: when `getAgentMeta(agentId)` returns a row with `sprintTaskId` already set, the service short-circuits with `{ok: true, taskId: <existing>}`. `createReviewTaskFromAdhoc` is NOT called.
  - Test B: calling with the new `options` param (`{autoCommitIfDirty: true}`) does not TypeError. (Behavior check is in Task 5.)

- [ ] **Step 3: Run — expect FAIL** (signature doesn't accept options; no re-fetch).

- [ ] **Step 4: Implement the signature change.** New shape:

```ts
export interface PromoteAdhocOptions {
  autoCommitIfDirty?: boolean
  trigger?: 'close' | 'button' | 'tool'  // default 'button' (added fully in Task 7)
}

export async function promoteAdhocToTask(
  agentId: string,
  options: PromoteAdhocOptions = {}
): Promise<PromoteAdhocResult> {
  const agent = await getAgentMeta(agentId)
  if (!agent) return { ok: false, error: `Agent ${agentId} not found` }

  if (agent.sprintTaskId) {
    return { ok: true, taskId: agent.sprintTaskId }
  }

  // ... rest of existing checks and logic, now reading from the re-fetched `agent` ...
}
```

Remove the old `agent: AgentMeta` param. Update the single call site in `src/main/handlers/agent-handlers.ts` (line ~231) — drop the `getAgentMeta` call there and pass `(agentId)` or `(agentId, {})` as appropriate.

- [ ] **Step 5: Run the test — expect PASS.**

- [ ] **Step 6: Run typecheck** to confirm the call-site change compiles.

- [ ] **Step 7: Run the full suite.** `agent-handlers.test.ts` exercises this path; it should still pass.

- [ ] **Step 8: Commit.**

```bash
git commit -m "refactor(adhoc-promotion): options param + idempotency re-fetch"
```

---

## Task 5: Implement `autoCommitIfDirty` path

**Files:**
- Modify: `src/main/services/adhoc-promotion-service.ts`
- Test: `src/main/services/__tests__/adhoc-promotion-service.test.ts`

- [ ] **Step 1: Write failing tests:**
  - Test A: when no commits exist AND worktree is dirty AND `autoCommitIfDirty: true`, the service runs `git add -A` then `git commit -m "chore: capture uncommitted work on session close"`, then proceeds to promotion.
  - Test B: when no commits AND clean tree AND `autoCommitIfDirty: true`, returns `{ok: false, error: ...}` (no commit attempt).
  - Test C: when commits already exist, the auto-commit path is skipped regardless of the option.

Mock `execFileAsync` to sequence the git calls and assertions.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** Add two helpers (`isWorktreeDirty`, `commitAllChanges`) that wrap `execFileAsync` calls to `git status --porcelain`, `git add -A`, and `git commit -m <msg>`. In `promoteAdhocToTask`, after the `hasCommitsBeyondMain` check fails, branch on `options.autoCommitIfDirty`:

- If true and dirty: call `commitAllChanges`, then re-check commits. If re-check fails, return error. Otherwise fall through.
- If true and clean: return the "nothing to promote" error.
- If false: return the existing error (unchanged behavior).

Catch errors from the git calls and return them as `{ok: false, error}` — never throw.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(adhoc-promotion): auto-commit dirty worktree on promotion"
```

---

## Task 6: Write `sprintTaskId` back to `agent_runs` on success

**Files:**
- Modify: `src/main/agent-history.ts` — add `setAgentSprintTaskId(agentId, taskId)`
- Modify: `src/main/services/adhoc-promotion-service.ts` — call it after successful promotion
- Test: extend both test files

- [ ] **Step 1: Write a failing test** asserting the service writes `sprintTaskId` on the agent_runs row after a successful promotion. Use a spy on `setAgentSprintTaskId` or query the DB in a test fixture.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement the helper in `agent-history.ts`.** `UPDATE agent_runs SET sprint_task_id = ? WHERE id = ?` — prepared statement, same style as the existing writes in that file.

- [ ] **Step 4: Call it from the service** after `createReviewTaskFromAdhoc` returns a task, before returning `{ok: true, taskId}`.

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: Commit.**

```bash
git commit -m "feat(adhoc-promotion): bind agent to promoted task via sprintTaskId"
```

---

## Task 7: Add `agent:promoted` event variant + emit on success

**Files:**
- Modify: `src/shared/types/agent-types.ts` — add the discriminant `{ type: 'agent:promoted'; taskId: string; trigger: 'close' | 'button' | 'tool' }` to the `AgentEvent` union. Include `timestamp` per the union's existing convention.
- Modify: `src/main/agent-event-mapper.ts` — add `emitAgentPromoted(agentId, taskId, trigger)` helper that calls the existing `emitAgentEvent` path (broadcast + persist)
- Modify: `src/main/services/adhoc-promotion-service.ts` — on success (after the sprintTaskId write), call the helper with the trigger from `options.trigger ?? 'button'`
- Test: extend the service test

- [ ] **Step 1: Write failing test** asserting `emitAgentPromoted` was called with `(agentId, taskId, 'button')` on a fresh-promotion code path (and NOT called on the idempotency short-circuit path).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Add the discriminant to the union.** TypeScript will flag exhaustive-switch sites elsewhere; follow the errors to update: the renderer's agent events store, the transcript renderer, any other consumers. For now, handle `agent:promoted` with a no-op `default`-adjacent branch or a placeholder — proper rendering comes in Task 14.

  **Also (not flagged by TS — data, not a switch):** add `'agent:promoted'` to the `AGENT_EVENT_TYPES` runtime Set in `src/main/handlers/agent-handlers.ts` (~line 29). `parseHistoryRow` uses this Set to filter events on history reload; if the new type isn't in the Set, promoted-events will replay as missing on reload and the transcript system line (Task 14) will silently disappear.

- [ ] **Step 4: Add the helper** to `agent-event-mapper.ts`. It's a thin wrapper — the actual broadcast + persist lives in `emitAgentEvent`.

- [ ] **Step 5: Wire it into the service.** Only emit on the fresh-promotion path (not the idempotency short-circuit). Pass `options.trigger ?? 'button'`.

- [ ] **Step 6: Run — expect PASS. Run typecheck.**

- [ ] **Step 7:** Update `docs/modules/` for agent-event-mapper + shared types.

- [ ] **Step 8: Commit.**

```bash
git commit -m "feat(agent-events): emit agent:promoted on successful promotion"
```

---

## Task 8: Extend `agents:promoteToReview` IPC handler + preload signature

**Files:**
- Modify: `src/shared/ipc-channels/` — update the `agents:promoteToReview` typed contract to accept an optional `{autoCommitIfDirty?: boolean}` second argument
- Modify: `src/main/handlers/agent-handlers.ts` — the `promoteToReview` handler (around line 225)
- Modify: `src/preload/index.ts` — preload bridge wrapper
- Modify: `src/renderer/src/components/agents/ConsoleHeader.tsx` — `handlePromote` passes `{autoCommitIfDirty: true}`
- Test: extend `src/main/handlers/__tests__/agent-handlers.test.ts`

- [ ] **Step 1: Update the channel's typed contract** in `src/shared/ipc-channels/` (grep for `promoteToReview` to find the file).

- [ ] **Step 2: Write failing test** that calling the IPC with `{autoCommitIfDirty: true}` causes the service to be invoked with that option and `trigger: 'button'`.

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Update the handler**:

```ts
safeHandle('agents:promoteToReview', async (_e, agentId: string, options?: { autoCommitIfDirty?: boolean }) => {
  try {
    return await promoteAdhocToTask(agentId, {
      autoCommitIfDirty: options?.autoCommitIfDirty ?? false,
      trigger: 'button'
    })
  } catch (err) {
    logError(log, '[agents:promoteToReview] failed', err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}, /* add parseArgs validator */)
```

- [ ] **Step 5: Update the preload wrapper** to accept and forward the options argument.

- [ ] **Step 6: Update `ConsoleHeader.tsx`'s `handlePromote`** to call `window.api.agents.promoteToReview(agent.id, { autoCommitIfDirty: true })`.

- [ ] **Step 7: Run typecheck + full suite.**

- [ ] **Step 8: Update `docs/modules/` for handlers.**

- [ ] **Step 9: Commit.**

```bash
git commit -m "feat(ipc): agents:promoteToReview accepts autoCommitIfDirty option"
```

---

## Task 9: `stopAndPromote(agentId)` orchestrator

**Files:**
- Modify: `src/main/adhoc-agent.ts` — add and export `stopAndPromote(agentId)`
- Test: `src/main/__tests__/adhoc-agent.test.ts` (verify path via grep; may live elsewhere)

- [ ] **Step 1: Write failing tests:**
  - Promotion runs first, then kill. (Use call-order assertion.)
  - Kill runs even when promotion fails; failure is returned as `{ok: false, error}`.
  - The service is called with `{trigger: 'close', autoCommitIfDirty: true}`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement:**

```ts
export async function stopAndPromote(agentId: string): Promise<PromoteAdhocResult> {
  const result = await promoteAdhocToTask(agentId, {
    autoCommitIfDirty: true,
    trigger: 'close'
  })

  const handle = getAdhocHandle(agentId)
  if (handle) {
    try {
      handle.close()
    } catch (err) {
      log.warn(`[stopAndPromote] kill failed for ${agentId}: ${err}`)
    }
  }

  return result
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5:** Update `docs/modules/` for adhoc-agent.

- [ ] **Step 6: Commit.**

```bash
git commit -m "feat(adhoc-agent): stopAndPromote orchestrator for close-path"
```

---

## Task 10: `agents:stopAndPromote` IPC channel + preload

**Files:**
- Modify: `src/shared/ipc-channels/` — declare the new channel
- Modify: `src/main/handlers/agent-handlers.ts` — register the handler
- Modify: `src/preload/index.ts` — expose `window.api.agents.stopAndPromote(agentId)`
- Test: extend `src/main/handlers/__tests__/agent-handlers.test.ts`

- [ ] **Step 1:** Declare the channel. Shape: `agents:stopAndPromote: (agentId: string) => Promise<{ ok: boolean; taskId?: string; error?: string }>`.

- [ ] **Step 2: Write failing test** that calling the IPC delegates to `stopAndPromote(agentId)`.

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Register the handler** with `safeHandle` + a `parseArgs` string validator.

- [ ] **Step 5: Expose in preload.**

- [ ] **Step 6: Run typecheck + full suite.**

- [ ] **Step 7:** Update `docs/modules/`.

- [ ] **Step 8: Commit.**

```bash
git commit -m "feat(ipc): agents:stopAndPromote channel"
```

---

## Task 11: `review:queueChanged` broadcast

**Files:**
- Modify: `src/shared/ipc-channels/` — declare the broadcast channel with payload `{ taskId: string }`
- Modify: `src/preload/ipc-helpers.ts` — where the `onBroadcast<T>()` factory lives (consumed by `api-utilities.ts` / `api-agents.ts`); wire the new broadcast through the same pattern
- Create or modify: a shared main-process helper `broadcastReviewQueueChanged(taskId)` (check `src/main/` for an existing broadcast utility; create one if not)
- Modify: `src/main/services/adhoc-promotion-service.ts` — call the helper on fresh-promotion success
- Modify: `src/main/agent-manager/review-transition.ts` — call it on pipeline success too (nav badge benefits pipeline consistently)
- Test: extend both service tests with a broadcast assertion

- [ ] **Step 1: Declare the channel.**

- [ ] **Step 2: Write failing tests** asserting the broadcast fires on successful transition for both paths.

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement** the helper + wire both call sites.

- [ ] **Step 5: Expose the subscription** via preload's `onBroadcast` factory.

- [ ] **Step 6: Run — expect PASS.**

- [ ] **Step 7: Commit.**

```bash
git commit -m "feat(ipc): review:queueChanged broadcast on promotion"
```

---

## Task 12: Renderer — discoverable promote button

**Files:**
- Modify: `src/renderer/src/components/agents/ConsoleHeader.tsx`
- Modify: the associated CSS file (grep `console-header__` to find it)
- Test: `src/renderer/src/components/agents/__tests__/ConsoleHeader.test.tsx` (extend or create)

- [ ] **Step 1: Write failing tests:**
  - A labeled "Promote to Code Review" button is visible for adhoc agents with a worktree. Assert the button has a visible text label, not just an `aria-label`.
  - The button is hidden once the agent has `sprintTaskId` set.

- [ ] **Step 2: Run — expect FAIL** (current button is icon-only).

- [ ] **Step 3: Implement.** Replace the icon-only `<button>` (around line 255-265) with an icon + label combo. Move it OUT of `console-header__actions` into its own slot adjacent to the model badge. Add a new CSS class `console-header__promote-btn` with primary styling — padded, accent-colored background, hover state, clearly an affordance (not a neutral icon).

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Visually verify.** `npm run dev`, spawn an adhoc agent with a worktree, confirm the button is obvious. Capture a screenshot for the PR body.

- [ ] **Step 6:** Update `docs/modules/`.

- [ ] **Step 7: Commit.**

```bash
git commit -m "feat(ui): discoverable Promote to Code Review button"
```

---

## Task 13: Renderer — dual-action stop dialog

**Files:**
- Inspect: `src/renderer/src/components/ui/ConfirmModal.tsx` (grep `confirm` to find the exact path)
- Decide: extend `ConfirmModal` (prefer if small) OR create `DualActionConfirmModal.tsx`
- Modify: `src/renderer/src/components/agents/ConsoleHeader.tsx` — `handleStop` branches on `canPromote`
- Test: `ConsoleHeader.test.tsx` — three new tests

- [ ] **Step 1:** Read `ConfirmModal` (find it first via grep) to understand its API. Decide extend vs new.

- [ ] **Step 2: Write failing tests** for `handleStop`:
  - Dual-action dialog appears when `canPromote` is true. Clicking "Stop and promote" invokes `window.api.agents.stopAndPromote`. Kill is NOT called.
  - Same dialog, clicking "Stop without promoting" invokes `window.api.agents.kill`. `stopAndPromote` is NOT called.
  - When `canPromote` is false, the current single-action dialog is shown and kill is called as before.

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement the modal change.** If extending `ConfirmModal`, add an optional `secondaryAction?: { label: string; onConfirm: () => void }` prop. Render a secondary button when present. Keyboard navigation (Tab between actions; Escape cancels) must work. Update the `confirm()` return type to include which action was chosen.

- [ ] **Step 5: Implement `handleStop` branch** on `canPromote`. When true, open the dual-action dialog with the new copy (*"Stopping this session will auto-commit any pending changes and promote the work to Code Review."*). Route the primary/secondary button clicks to `stopAndPromote` / `kill` respectively. When false, the current path is unchanged.

- [ ] **Step 6: Run — expect PASS.**

- [ ] **Step 7: Visually verify** in `npm run dev`. Screenshot both dialog variants.

- [ ] **Step 8: Commit.**

```bash
git commit -m "feat(ui): dual-action stop dialog for promotable agents"
```

---

## Task 14: Renderer — transcript system line on `agent:promoted`

**Files:**
- Grep `agent:completed` in `src/renderer/src/components/agents/` to locate the event-rendering switch (likely `AgentConsole.tsx` or similar)
- Modify: that file to add an `agent:promoted` case
- Test: the component test (create or extend)

- [ ] **Step 1: Grep to locate the transcript renderer.**

- [ ] **Step 2: Write failing test** that an `agent:promoted` event renders a distinct system row with "Promoted to Code Review" text and a clickable link to the task id.

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement the case.** Use a visual style consistent with existing system rows (not an agent message). The link should switch to the code-review view and select the task — mirror the navigation in `handlePromote`.

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: Commit.**

```bash
git commit -m "feat(ui): render agent:promoted as transcript system line"
```

---

## Task 15: Renderer — toast on `review:queueChanged`

**Files:**
- Grep `onBroadcast` in `src/renderer/src/` to find where broadcasts are subscribed (likely an init module or a store)
- Add: a subscription to `review:queueChanged` that fires a toast

- [ ] **Step 1: Locate the subscription pattern.**

- [ ] **Step 2: Subscribe** to `review:queueChanged` via the existing pattern and call `toast.success('New work in Code Review')` on each event.

- [ ] **Step 3: Manually verify** by triggering a promotion in dev and confirming the toast appears.

- [ ] **Step 4: Commit.**

```bash
git commit -m "feat(ui): toast on review queue updates"
```

---

## Task 16: Renderer — Code Review nav badge

**Files:**
- Modify: `src/renderer/src/lib/view-registry.ts` — add optional `badgeSelector?: (state: /* typed */) => number`
- Modify: `src/renderer/src/stores/sprintTasks.ts` — add `selectUnseenReviewCount(lastOpenedAt: string | null)`
- Modify: the nav-rendering component (grep for where `view-registry` is consumed; likely in `src/renderer/src/components/panels/`)
- Modify: `src/renderer/src/views/CodeReviewView.tsx` — write `ui.last_review_opened_at = nowIso()` on mount, debounced via `createDebouncedPersister`
- Test: selector test + view-mount test

- [ ] **Step 1: Write failing tests:**
  - Selector: counts only `review`-status tasks with `promoted_to_review_at > lastOpenedAt`. Returns 0 when `lastOpenedAt` is null.
  - View: on mount, the setting key `ui.last_review_opened_at` is written (debounced).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement the selector:**

```ts
export const selectUnseenReviewCount = (lastOpenedAt: string | null) =>
  (state: SprintTasksState): number => {
    if (!lastOpenedAt) return 0
    return state.tasks.filter(
      (t) => t.status === 'review' &&
             t.promoted_to_review_at != null &&
             t.promoted_to_review_at > lastOpenedAt
    ).length
  }
```

- [ ] **Step 4: Extend view-registry** with an optional `badgeSelector`. The Code Review entry gets `badgeSelector: selectUnseenReviewCount(/* reads ui.last_review_opened_at */)`.

- [ ] **Step 5: Render the badge** in the nav component. Small count pill on the view entry; hidden when count is 0.

- [ ] **Step 6: Implement the view-mount write** in `CodeReviewView.tsx`. On mount: persist `ui.last_review_opened_at = nowIso()`, then re-render. Debounce via `createDebouncedPersister` so remounts don't churn.

- [ ] **Step 7: Run — expect PASS.**

- [ ] **Step 8: Visually verify.** Complete an adhoc session in dev; see badge appear; open Code Review; see badge clear.

- [ ] **Step 9:** Update `docs/modules/` for view-registry, sprintTasks store, CodeReviewView. Screenshots for PR.

- [ ] **Step 10: Commit.**

```bash
git commit -m "feat(ui): Code Review nav badge for unseen review tasks"
```

---

## Task 17 (CONDITIONAL): `promote_to_review` agent tool

**GATE:** Skip this task entirely if Task 1 recorded "SDK DOES NOT SUPPORT." In that case, add a note to the spec document (`docs/superpowers/specs/2026-04-22-adhoc-auto-promote-code-review-design.md`) that Trigger 3 is deferred until SDK support lands, commit that edit, and proceed to Task 18.

**Files (if proceeding):**
- Modify: `src/main/agent-manager/sdk-adapter.ts` (or the adhoc/assistant spawn path confirmed by Task 1) — register an in-process MCP server with one tool for adhoc/assistant spawns only
- Create: `src/main/agent-manager/promote-to-review-tool.ts` — the tool handler
- Test: `src/main/agent-manager/__tests__/promote-to-review-tool.test.ts`

- [ ] **Step 1: Write failing tests:**
  - Tool handler delegates to `promoteAdhocToTask(agentId, { autoCommitIfDirty: true, trigger: 'tool' })`.
  - When the service returns `{ok: false, error}`, the tool returns a string that the agent can relay in its next message.
  - The tool is registered only for `role: 'adhoc' | 'assistant'` spawns — not pipeline/reviewer/copilot/synthesizer.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement the tool handler.** Use the SDK's in-process MCP server API as confirmed in Task 1. Tool name: `promote_to_review`. No inputs. Output: success message with the task id, or error string.

- [ ] **Step 4: Wire the MCP server** into the adhoc/assistant spawn path only.

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: Manual QA.** In `npm run dev`, spawn an adhoc agent with a worktree and some commits. Say *"send this to code review"*. Confirm it calls the tool and produces the review task + the three breadcrumbs.

- [ ] **Step 7:** Update `docs/modules/` for agent-manager.

- [ ] **Step 8: Commit.**

```bash
git commit -m "feat(agent-sdk): promote_to_review tool for adhoc/assistant"
```

---

## Task 18: Manual QA checklist

No code; execute these scenarios in a built dev app and confirm each.

- [ ] Adhoc + commits → close via **Stop and promote** → review entry + transcript system line + toast + badge all appear.
- [ ] Adhoc + dirty tree, no commits → close → auto-commit fires; promotion succeeds; same breadcrumbs.
- [ ] Adhoc + clean tree, no commits → close → dialog appears; promotion returns an error; no review entry; scratchpad preserved; kill proceeds.
- [ ] Mid-session click of the discoverable button → task created; session continues; button disappears (`canPromote` now false); second close is a no-op.
- [ ] Tool call (*"send this to code review"*) → task created; agent references the task id in its response. **(Skip if Task 17 was descoped.)**
- [ ] **Stop without promoting** chosen → kill proceeds, no review entry.
- [ ] Promotion failure path — manually delete the worktree mid-session, then trigger close → warning toast with reason, no crash, session ends.
- [ ] Regression: pipeline agent completes → still transitions to `review` as before; now also writes `promoted_to_review_at` and fires the broadcast (badge updates). Existing pipeline tests still pass.

If any scenario fails: stop, diagnose, fix, retest.

---

## Task 19: Self-heal + open PR

Per CLAUDE.md:

- [ ] `npm run typecheck` — zero errors.
- [ ] `npm test` — all pass.
- [ ] `npm run test:main` — all pass.
- [ ] `npm run lint` — zero errors.
- [ ] `npm run build` — succeeds.
- [ ] `docs/modules/` updated for every source file touched across all tasks.
- [ ] UX screenshots captured (discoverable promote button, dual-action stop dialog, transcript system line, nav badge).

- [ ] Push the branch: `git push -u origin chore/spec-adhoc-auto-promote-review`.
- [ ] Open PR via `gh pr create` with a body that:
  - Links the spec and this plan.
  - Describes the three breadcrumbs (transcript, toast, badge).
  - Lists the schema changes (migration v053, new settings key).
  - Documents the SDK-capability outcome (Task 17 landed or descoped).
  - Includes the UX screenshots.

---

## Rollback

Migration v053 adds a nullable column — safe to leave in place even if the feature is reverted. Reverting the PR cleanly removes all runtime behavior changes. The `sprint_task_id` writes for adhoc agents that promoted during the window remain in the DB — they accurately reflect the bindings that happened and do not need to be undone. The `task_changes` audit trail has the pre-existing shape; any rollback-time inspection of adhoc promotions can be reconstructed from it.
