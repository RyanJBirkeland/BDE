# Shared

Types, IPC channel constants, and utilities shared across main and renderer processes.
Source: `src/shared/`

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `task-statuses.ts` | Single source of truth for task status constants, predicates, and UI metadata. Re-exports everything from `task-state-machine.ts` plus `ALL_TASK_STATUSES`, `TASK_STATUS` (object-style constants), `STATUS_METADATA`, `BucketKey`, and `StatusMetadata`. `TASK_STATUS` is also re-exported from `constants.ts` for callers that prefer that import path. | `ALL_TASK_STATUSES`, `TASK_STATUS`, `TaskStatus`, `TERMINAL_STATUSES`, `FAILURE_STATUSES`, `STATUS_METADATA`, `BucketKey`, `isTerminal`, `isFailure` |
| `types/review-types.ts` | Review Partner domain types — findings, inline comments, review results, chat wire types. Relocated from `src/shared/review-types.ts`; re-exported via `src/shared/types/index.ts`. | `FindingSeverity`, `FindingCategory`, `InlineComment`, `FileFinding`, `ReviewFindings`, `ReviewResult`, `PartnerMessage`, `ChatChunk` |
| `types/task-types.ts` | Core task domain types — `SprintTask`, `TaskStatus`, `FailureReason` union (auth, timeout, test_failure, compilation, spawn, no_commits, unknown), and narrow view aliases (`SprintTaskCore`, `SprintTaskSpec`, `SprintTaskExecution`, `SprintTaskPR`). | `SprintTask`, `TaskStatus`, `FailureReason`, `SprintTaskCore`, `SprintTaskSpec`, `SprintTaskExecution`, `SprintTaskPR` |
| `spec-quality/types.ts` | Shared spec validation types — `IssueCode` union (includes `PRESCRIPTIVENESS_CHECK_FAILED`), `IssueSeverity`, `SpecIssue`, `ParsedSpec`, `ParsedSection`, `SpecQualityResult` | `IssueCode`, `IssueSeverity`, `SpecIssue`, `ParsedSpec`, `ParsedSection`, `SpecQualityResult` |
| `ipc-channels/settings-channels.ts` | Settings IPC channel type definitions including `settings:hasSecret` (returns boolean, avoids sending sensitive plaintext to renderer) | `SettingsChannels`, `ClaudeConfigChannels`, `AuthChannels`, `OnboardingChannels` |
