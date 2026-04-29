## Why

The four most consequential untested paths in the agent completion pipeline — the pre-review verification gates, the 10-phase success-pipeline orchestrator, the pluggable advisory system, and the terminal-handler deduplication guard — have zero test coverage. Silent regressions here either promote broken agent work into the review queue, corrupt task state in SQLite, or fail to unblock dependent tasks.

## What Changes

- Add tests for `verifyBranchTipOrFail` and `verifyWorktreeOrFail` in `verification-gate.ts` — the two pre-review guards that prevent mismatched branches and broken builds from reaching review
- Add integration tests for `resolveSuccess` in `success-pipeline.ts` — verifying all 10 phases execute in order, `PipelineAbortError` at any phase aborts subsequent phases cleanly, and the `detectNoOpAndFailIfSo` write-failure guard never calls `onTaskTerminal` when the DB write fails
- Add tests for `runPreReviewAdvisors` in `pre-review-advisors.ts` — verifying advisor errors are caught and logged without stalling the success path
- Add tests for `handleTaskTerminal` in `terminal-handler.ts` — verifying idempotent deduplication under concurrent same-task calls and correct metrics recording

## Capabilities

### New Capabilities

- `agent-completion-pipeline-tests`: Test coverage for the four highest-priority untested segments of the agent completion pipeline: verification gates, success-pipeline phase ordering and abort propagation, pre-review advisory error isolation, and terminal-handler deduplication.

### Modified Capabilities

## Impact

- `src/main/agent-manager/__tests__/verification-gate.test.ts` — new file
- `src/main/agent-manager/__tests__/success-pipeline.test.ts` — new file
- `src/main/agent-manager/__tests__/pre-review-advisors.test.ts` — new file
- `src/main/agent-manager/__tests__/terminal-handler.test.ts` — new file
- No production code changes; no IPC changes; no new dependencies
