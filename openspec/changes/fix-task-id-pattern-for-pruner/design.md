## Context

BDE task IDs are generated in SQLite as `lower(hex(randomblob(16)))`, producing a 32-character lowercase hex string with no dashes (e.g. `00313fab513f1807706c8b7665afc329`). This format has been stable since the `sprint_tasks` table was created in migration v006.

`pruneStaleWorktrees` in `src/main/agent-manager/worktree.ts` uses `TASK_ID_UUID_PATTERN` to decide whether a directory name looks like a BDE-managed worktree before deleting it. The pattern was authored as `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` — the dashed UUID v4 format — which never matches a real task ID. As a result `isPrunableCandidate` always returns false for every real worktree, so the pruner silently returns 0 every time it runs.

The existing tests in `worktree.test.ts` use the same dashed UUID fixtures (`UUID_A/B/C`) and therefore pass despite the bug; the tests are internally consistent but test the wrong shape.

## Goals / Non-Goals

**Goals:**
- Fix the regex so it matches the actual 32-char hex task ID format.
- Rename the constant from `TASK_ID_UUID_PATTERN` to `TASK_ID_HEX_PATTERN` so the name describes the real format.
- Update the doc comment and any inline references that repeat the incorrect "UUID" claim.
- Update test fixtures to use realistic task IDs and add a regression test that would have caught this bug.

**Non-Goals:**
- Changing the task ID generation scheme itself.
- Adding migration for any historical data.
- Changing the `.git`-entry defense-in-depth check (it is correct and unrelated).
- Changing the human-worktree safety guard logic (just the regex it uses).

## Decisions

### Decision: rename constant, do not add an alias

Keeping the old `TASK_ID_UUID_PATTERN` name alongside a corrected one would create confusion about which to use. A clean rename communicates that "UUID" was always wrong here, and there are no external callers of this module-private constant.

**Alternative considered:** leave the name unchanged and only fix the regex. Rejected — the name actively misleads the reader about what the pattern matches.

### Decision: update test fixtures rather than add separate regression-only tests

The three `UUID_A/B/C` constants in `worktree.test.ts` are used across many existing pruner scenarios. Replacing them with real-shaped IDs makes every existing test a regression test for the correct shape, which is more thorough than a single bolt-on regression test. One explicit regression test is added to make the bug scenario unmissable, but updating the fixtures is the primary fix to the test suite.

**Alternative considered:** add a new `describe` block with 32-char hex fixtures and leave the old UUID tests in place. Rejected — leaving the old tests creates false confidence that dashed UUIDs are a valid shape to test.

### Decision: case-insensitive flag retained

`lower(hex(...))` always produces lowercase. Keeping the `i` flag is belt-and-suspenders; it costs nothing and avoids a subtle bug if the generation ever changes casing.

## Risks / Trade-offs

- **Risk:** A human worktree whose branch name happens to be exactly 32 hex characters could now match the pattern and be pruned.
  **Mitigation:** This is astronomically unlikely in practice (a 32-char all-lowercase-hex branch name is not a valid git ref anyone would type). The `.git` defense-in-depth check provides a second gate. No mitigation beyond documentation is warranted.

- **Risk:** The test fixture replacement changes many existing test expectations at once.
  **Mitigation:** The only change to existing tests is swapping the three constant values; all assertions over those values remain structurally identical. A careful diff review suffices.

## Migration Plan

No runtime migration needed. The change takes effect on the next app launch. Stale worktrees that have accumulated will be pruned on the next `pruneStaleWorktrees` call (which runs at startup).
