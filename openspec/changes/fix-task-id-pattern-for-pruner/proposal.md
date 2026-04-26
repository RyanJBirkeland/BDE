## Why

`pruneStaleWorktrees` has been silently a no-op since BDE task IDs were established: the guard pattern `TASK_ID_UUID_PATTERN` requires a dashed UUID format (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`), but BDE task IDs are generated as `lower(hex(randomblob(16)))` — a 32-character hex string with no dashes. Every real BDE worktree is rejected by `isPrunableCandidate`, so the pruner always returns 0 and stale worktrees accumulate on disk indefinitely.

## What Changes

- Change `TASK_ID_UUID_PATTERN` regex from the dashed UUID format to `/^[0-9a-f]{32}$/i` to match actual BDE task IDs.
- Rename the constant to `TASK_ID_HEX_PATTERN` so the name accurately describes what it matches.
- Update the doc comment on the constant to describe the real format (`lower(hex(randomblob(16)))`), not the now-incorrect UUID claim.
- Update the inline comment in `isPrunableCandidate` that calls it "UUID-shaped."
- Update test fixtures in `worktree.test.ts`: replace the three dashed-UUID constants (`UUID_A/B/C`) with realistic 32-char hex IDs and add an explicit regression test that seeds a real-shaped task ID and asserts the pruner returns > 0.

## Capabilities

### New Capabilities

- `worktree-pruner-task-id-matching`: The pruner correctly identifies BDE-managed worktree directories by matching the 32-char hex task ID format, enabling stale worktrees to actually be cleaned up.

### Modified Capabilities

<!-- No existing specs are changing at the requirement level — this is a bug fix within the worktree management module. -->

## Impact

- **`src/main/agent-manager/worktree.ts`** — regex constant, constant name, and two comments.
- **`src/main/agent-manager/__tests__/worktree.test.ts`** — three UUID fixture constants and addition of one regression test asserting a real-shaped task ID is pruned.
- No IPC surface changes, no schema changes, no migration required.
- Human worktrees (non-UUID-shaped names, e.g. `fix-some-bug`) remain protected by the existing name-shape check; only the matched shape changes.
