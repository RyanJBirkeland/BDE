## 1. Fix the production regex and constant

- [x] 1.1 In `src/main/agent-manager/worktree.ts` at line 394, replace the regex `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` with `/^[0-9a-f]{32}$/i`
- [x] 1.2 Rename the constant from `TASK_ID_UUID_PATTERN` to `TASK_ID_HEX_PATTERN` (update both the declaration and the single call-site in `isPrunableCandidate`)
- [x] 1.3 Replace the doc comment on the constant (lines 386–393) with one that accurately describes the `lower(hex(randomblob(16)))` format — no mention of UUID or dashes
- [x] 1.4 In `isPrunableCandidate`'s JSDoc (lines 458–467), replace the phrase "UUID-shaped" with "FLEET hex task ID-shaped" (or equivalent accurate wording)

## 2. Fix test fixtures and add regression test

- [x] 2.1 In `src/main/agent-manager/__tests__/worktree.test.ts`, replace `UUID_A`, `UUID_B`, `UUID_C` constants (currently dashed UUIDs) with realistic 32-char lowercase hex strings (e.g. `aaaa...` × 32, `bbbb...` × 32, `cccc...` × 32)
- [x] 2.2 Add a new test in the `pruneStaleWorktrees` describe block that: seeds a directory named with a real-shaped 32-char hex task ID containing a `.git` file, calls `pruneStaleWorktrees` with `isActive = () => false`, and asserts the return value is `> 0` (regression guard ensuring the pruner is not a no-op for real task IDs)
- [x] 2.3 Add a companion test that uses a dashed-UUID directory name and asserts `pruneStaleWorktrees` returns `0` (confirms human worktrees with UUID-like names remain protected)

## 3. Verify and document

- [x] 3.1 Run `npm run test:main` and confirm all worktree tests pass with zero failures
- [x] 3.2 Run `npm run typecheck` and confirm zero errors
- [x] 3.3 Run `npm run lint` and confirm zero errors
- [x] 3.4 Update `docs/modules/agent-manager/index.md` to note the constant rename (find the `worktree.ts` row and update if it references the old name)
