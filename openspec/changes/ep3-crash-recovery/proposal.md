## Why

After a crash or forced kill, `recoverOrphans` re-queues `active` tasks with no counter bump — a task that crashes BDE three times in a row will spin forever. Recovery is invisible to the user (no UI signal, no banner). Tasks in `review` status with preserved PRs leave dependents blocked because their PR-poller terminal path was never fired. Repeated "has PR, clearing claimed_by" log lines on every startup are noise that masks real problems.

## What Changes

- **NEW** `orphan_recovery_count` field on `sprint_tasks` — incremented on every recovery; tasks exceeding a cap (3) are marked `error` instead of re-queued
- `orphan:recovered` IPC broadcast → in-app banner on Sprint Pipeline showing which tasks were recovered
- Recovery log includes `retry_count`, `started_at`, and prior status for each orphaned task
- `review`-status orphans that have a PR trigger `onTaskTerminal('done'/'cancelled')` based on PR state, or stay in `review` with a note
- Repeated "has PR, clearing claimed_by" startup log suppressed after first occurrence per session

## Capabilities

### New Capabilities

- `orphan-recovery-cap`: Per-task `orphan_recovery_count` with a hard cap before transitioning to `error` — prevents infinite crash loops

### Modified Capabilities

<!-- No spec-level behavior changes visible to end users except the new banner and error transition -->

## Impact

- `src/main/agent-manager/orphan-recovery.ts` — counter increment, cap check, enriched log
- `src/main/db.ts` / migrations — new `orphan_recovery_count` column (default 0)
- `src/main/index.ts` — broadcast `orphan:recovered` after recovery run
- `src/renderer/src/components/sprint/SprintPipeline.tsx` — banner on `orphan:recovered`
- `src/shared/ipc-channels/` — new `orphan:recovered` channel
