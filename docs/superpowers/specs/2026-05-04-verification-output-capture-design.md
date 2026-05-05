# Verification Output Capture — Design Doc

**Date:** 2026-05-04  
**Issue:** #714 finding F10  
**Status:** Approved for implementation

---

## Problem

From the reviewer's seat in Code Review Station, there is no way to confirm that the
agent actually ran the commands listed in the spec's `## How to Test` section, or to see
the output of FLEET's own post-completion verification gate. Agents can write commit
messages like "Verified: prettier check OK" without having run anything. The reviewer
has no evidence either way.

Two gaps:

1. **FLEET's verification gate output is discarded on success.** The gate runs
   `typecheck` and `tests` after every agent completion, but only persists output on
   failure (written as JSON to `notes`). The reviewer never sees the green run.

2. **Non-standard "How to Test" commands are invisible.** The Tests tab pattern-matches
   agent Bash events against a fixed list of known test runners (`npm test`, `pytest`,
   etc.). Commands like `./gradlew prettierCheck` or `mvn verify` don't match and are
   silently excluded.

---

## Goals

- Show the reviewer both FLEET-confirmed verification (typecheck + tests) and the
  agent's own test execution, in one place.
- Capture FLEET gate output on success as well as failure.
- Expand agent-side pattern matching to cover common non-JS test runners.
- Keep the UI surface familiar — rename "Tests" → "Verification", consolidate there.
- Never bloat the SQLite row with unbounded test output.

## Non-goals

- Parsing the `## How to Test` spec section to match commands (too brittle).
- Showing all agent Bash commands (too noisy).
- Streaming live gate output to the UI.

---

## Approach

**Approach C — New DB column with output capping.**

Store structured gate results in a new `verification_results` JSON column on
`sprint_tasks`. Cap stdout/stderr at 10,000 chars per record with a `truncated` flag.
Expand the agent-side pattern regex to include gradle, maven, and other common runners.
Rename the Tests tab to Verification and restructure it to show both sources.

Rejected alternatives:

- **Agent events** (no migration): conflates FLEET-internal gate actions with agent
  conversation events; gate results would disappear if events are pruned.
- **Notes field** (no migration): `notes` is already overloaded with multiple JSON
  and plain-text formats; adding another format makes parsing brittle.

---

## Data Layer

### New type — `src/shared/types/task-types.ts`

```typescript
export interface VerificationRecord {
  exitCode: number
  stdout: string      // capped at OUTPUT_CAP chars
  stderr: string      // capped at OUTPUT_CAP chars
  truncated: boolean  // true when either field was capped
  durationMs: number
  timestamp: string   // ISO-8601
}

export interface VerificationResults {
  typecheck: VerificationRecord | null  // null when repo has no typecheck script
  tests: VerificationRecord | null      // null when typecheck failed (gate short-circuits before running tests)
}
```

`SprintTask` gains one new optional field:

```typescript
verification_results?: VerificationResults | null
```

### Output cap constant — `src/main/agent-manager/prompt-constants.ts`

```typescript
export const VERIFICATION_OUTPUT_CAP = 10_000  // chars per record field
```

Alongside the existing `PROMPT_TRUNCATION` object. Single source of truth — no magic
numbers scattered in gate or UI code.

### Migration — `src/main/migrations/v059-add-verification-results-to-sprint-tasks.ts`

```sql
ALTER TABLE sprint_tasks ADD COLUMN verification_results TEXT;
```

Nullable, no default. Existing rows remain `null` — the UI handles the null case with
an empty state.

Migration requires a test in
`src/main/migrations/__tests__/v059.test.ts` following the pattern in
`v049.test.ts` / `v038.test.ts`.

---

## Verification Gate Changes

**Files:** `src/main/agent-manager/verify-worktree.ts` and `verification-gate.ts`

### Current behaviour

`verifyWorktreeOrFail()` calls `verifyWorktreeBuildsAndTests()`. The underlying
`CommandResult` type is `{ ok: true } | { ok: false; output: string }` — stdout/stderr
are **discarded on success**. On failure, combined stderr is serialised into `notes` and
the task is requeued. On success, all output is thrown away.

Additionally, the gate **short-circuits**: if typecheck fails, tests are never run, so
we will only ever have a typecheck result in that case.

### New behaviour — `verify-worktree.ts`

Extend `CommandResult` to carry output on success too:

```typescript
type CommandResult =
  | { ok: true;  stdout: string; stderr: string; durationMs: number }
  | { ok: false; stdout: string; stderr: string; durationMs: number }
```

`runVerificationAttempt` and `execFileRunCommand` are updated to always capture and
return stdout/stderr regardless of exit code. The failure path continues to use
`formatFailureNote` (for `notes` feedback) but now the raw fields are also available.

`verifyWorktreeBuildsAndTests` returns a new type:

```typescript
export interface WorktreeVerificationOutput {
  typecheck: CommandResult | null  // null when no typecheck script exists
  tests: CommandResult | null      // null when typecheck failed (short-circuit)
}
```

### New behaviour — `verification-gate.ts`

After receiving `WorktreeVerificationOutput`:

1. Build a `VerificationResults` object using `toVerificationRecord(result, cap)` — a
   small pure helper that applies `capOutput` and maps fields to `VerificationRecord`.
2. Persist via `updateTask(id, { verification_results: results })` before the existing
   failure/success branching.
3. Existing failure path (`notes` + requeue) is unchanged — `verification_results`
   supplements it, does not replace it.

`capOutput` and `toVerificationRecord` are pure functions exported from
`verification-gate.ts` so they can be unit-tested independently.

### Row mapper — `src/main/data/sprint-task-mapper.ts`

Add `verification_results` to `mapRowToTask()`: parse the JSON column and validate the
shape. On parse failure, log a warning and return `null` (same defensive pattern used
for `depends_on`). Type guard `isVerificationResults(v: unknown): v is VerificationResults`
lives in `src/shared/types/task-types.ts`.

---

## UI Changes

### 1. Rename Tests → Verification

**File:** `src/renderer/src/components/code-review/DiffViewerPanel.tsx`

```typescript
const modes = [
  { key: 'diff',         label: 'Diff' },
  { key: 'commits',      label: 'Commits' },
  { key: 'verification', label: 'Verification' },  // was 'tests' / 'Tests'
]
```

`DiffMode` type in the code-review store gains `'verification'` and loses `'tests'`.
Any persisted `diffMode === 'tests'` is migrated to `'verification'` on load (single
guard in the store's hydration path).

### 2. VerificationTab component

**File:** `src/renderer/src/components/code-review/VerificationTab.tsx`  
(replaces `TestsTab.tsx`)

Two named sections, rendered in order:

#### Section A — FLEET Verified

Source: `task.verification_results` (from sprint tasks store — no extra IPC needed).

Renders a two-row summary table:

| Check | Status | Duration |
|-------|--------|----------|
| Type check | ✅ Passed / ❌ Failed | 4.2s |
| Tests | ✅ Passed / ❌ Failed | 18.1s |

Clicking a row expands a `<pre>` block showing stdout (and stderr if non-empty). If
`truncated === true`, a dim "output truncated at 10 000 chars" note appears below the
block. If `verification_results` is null (task completed before this feature shipped, or
gate hasn't run yet), the section shows: *"No FLEET verification record for this task."*

#### Section B — Agent Test Runs

Source: agent events via `useAgentEventsStore` — same data source as the current
Tests tab. Renders identically to the current Tests tab (command, pass/fail badge,
output block, "Showing latest of N" counter).

The header label is "Agent Test Runs" to distinguish it from FLEET's gate.

### 3. Expand agent test runner patterns

**File:** `src/renderer/src/lib/extract-test-runs.ts`

```typescript
const TEST_COMMAND_PATTERN =
  /\b(npm (run )?test|yarn test|pnpm (run )?test|npx\s+vitest|vitest|jest|pytest|cargo test|go test|\.\/gradlew\s+\w*[Tt]est\w*|gradle\s+test|mvn\s+(test|verify)|mvnw\s+(test|verify)|\.\/mvnw\s+(test|verify))\b/i
```

Additions: `./gradlew <anything containing Test>`, `gradle test`, `mvn test`,
`mvn verify`, `mvnw` variants. Pattern is tested via the existing
`extract-test-runs` test file.

---

## Component & Store Wiring

- `useCodeReviewStore` — `diffMode` type updated; hydration guard added.
- `VerificationTab` — reads `verification_results` directly from the task object
  (already in the sprint tasks store). No new IPC channel needed.
- `DiffViewerPanel` — renders `<VerificationTab />` in place of `<TestsTab />`.
- `TestsTab.tsx` — deleted. Logic for rendering agent test runs is inlined as Section B
  of `VerificationTab` (it's small enough that an extra file would be indirection
  without benefit).

---

## Testing Strategy

### Unit tests

| File | What to test |
|------|-------------|
| `verify-worktree.test.ts` | `execFileRunCommand` returns stdout + stderr on success (not just on failure) |
| `verification-gate.test.ts` | `capOutput` and `toVerificationRecord` pure functions: exact cap, under cap, empty string, truncated flag |
| `verification-gate.test.ts` | `verifyWorktreeOrFail` writes `verification_results` on success AND on failure; null tests field when typecheck fails |
| `sprint-task-mapper.test.ts` | `mapRowToTask` parses valid JSON, returns null on malformed JSON, returns null when column is absent |
| `v059.test.ts` | Migration adds column; existing rows retain null; column accepts valid JSON |
| `extract-test-runs.test.ts` | New gradle / maven patterns match; existing patterns still match; non-test commands don't match |

### Component tests

| File | What to test |
|------|-------------|
| `VerificationTab.test.tsx` | Renders both sections; null `verification_results` shows empty state; truncation note appears when `truncated: true`; expand/collapse works |
| `DiffViewerPanel.test.tsx` | Tab label is "Verification" not "Tests"; old `diffMode='tests'` migrates to `'verification'` |

### Manual smoke test

1. Queue a task, let it run to `review` status.
2. Open Code Review → Verification tab.
3. Confirm FLEET Verified section shows typecheck + test results with durations.
4. Confirm Agent Test Runs section shows the agent's test commands.
5. Force a task with a large test suite to confirm truncation note appears correctly.

---

## File Checklist

Files to create:
- `src/main/migrations/v059-add-verification-results-to-sprint-tasks.ts`
- `src/main/migrations/__tests__/v059.test.ts`
- `src/renderer/src/components/code-review/VerificationTab.tsx`
- `src/renderer/src/components/code-review/__tests__/VerificationTab.test.tsx`

Files to modify:
- `src/shared/types/task-types.ts` — add `VerificationRecord`, `VerificationResults`, `WorktreeVerificationOutput`, `isVerificationResults`, update `SprintTask`
- `src/main/agent-manager/prompt-constants.ts` — add `VERIFICATION_OUTPUT_CAP`
- `src/main/agent-manager/verify-worktree.ts` — extend `CommandResult` to carry stdout/stderr on success; return `WorktreeVerificationOutput`
- `src/main/agent-manager/verification-gate.ts` — capture + persist gate output, add `capOutput`, `toVerificationRecord`
- `src/main/data/sprint-task-mapper.ts` — parse `verification_results` column
- `src/renderer/src/lib/extract-test-runs.ts` — expand pattern
- `src/renderer/src/components/code-review/DiffViewerPanel.tsx` — rename tab, swap component
- `src/renderer/src/stores/codeReview.ts` — update `DiffMode` type, hydration guard
- `src/main/migrations/loader.ts` — register v059

Files to delete:
- `src/renderer/src/components/code-review/TestsTab.tsx`

Docs to update:
- `docs/modules/services/index.md`
- `docs/modules/components/index.md`
