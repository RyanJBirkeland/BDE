## Why

Four policy and detection functions in the agent manager — `getDiffFileStats`, `isCssOnlyChange`, `listChangedFiles`/`detectUntouchedTests`, and `classifyFailureReason` precedence — are either completely untested or have meaningful edge-case gaps. These functions make silent decisions that affect whether tests are skipped, how advisory notes are generated, and which failure category a task receives. A malformed `git numstat` line, an uppercase `.CSS` extension, or a multi-keyword error message silently produces wrong results today with no tests to catch a regression.

## What Changes

- Extend `auto-merge-policy.test.ts` with malformed-numstat edge cases for `getDiffFileStats` (T-13) and missing `isCssOnlyChange` extension-casing cases (T-14)
- Create `test-touch-check.test.ts` covering `listChangedFiles` (empty output, error handling) and `detectUntouchedTests` (sibling-test lookup logic) (T-16)
- Extend `failure-classifier.test.ts` with `environmental`-first precedence cases, `incomplete_files` pattern coverage, and custom-pattern-loses-to-builtin documentation (T-34)

## Capabilities

### New Capabilities

- `agent-manager-policy-detection-tests`: Test coverage for four previously untested or undertested policy/detection functions: `getDiffFileStats` malformed-input resilience, `isCssOnlyChange` case-insensitivity and double-extension behaviour, `listChangedFiles`/`detectUntouchedTests` end-to-end via injected deps, and `classifyFailureReason` first-match precedence completeness.

### Modified Capabilities

None — no production code changes.

## Impact

- `src/main/agent-manager/__tests__/auto-merge-policy.test.ts` — extended with T-13 and T-14 test cases
- `src/main/agent-manager/__tests__/test-touch-check.test.ts` — new file (T-16)
- `src/main/agent-manager/__tests__/failure-classifier.test.ts` — extended with T-34 test cases
- No production code changes; no IPC changes; no new dependencies
