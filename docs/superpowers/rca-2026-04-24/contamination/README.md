# Contamination evidence

The single file in this directory was **created in the main repo by a misbehaving pipeline agent** during Phase B (B-arm T-47 clone, agent run `dafed796-3e6e-45a5-a2b6-ad57b41b9aed`, 2026-04-24 ~13:54 local).

The agent had absolute paths to both its own worktree (`~/.bde/worktrees/.../e79e2836…/…`) and the main repo (`/Users/ryanbirkeland/Projects/git-repos/BDE/…`). It used the Write tool with the main-repo path, creating an untracked file there.

The file was MOVED here (not copied) so that:

1. The main repo would no longer be dirty (the dirty state was blocking every subsequent agent spawn via `assertRepoCleanOrAbort`).
2. The agent's intended output is preserved for review — the user may want to keep this test (after auditing what it tests) and place it in a proper location.

## What's here

- `review-transition.test.ts.evidence` — the file as the agent wrote it. The `.evidence` extension prevents vitest from accidentally discovering and running it from this location.

## What you might do with it

- **Discard:** `rm review-transition.test.ts.evidence`. The file represents an attempted change to a feature that already failed verification, so the test may not be useful.
- **Salvage as a real test:** if the test logic is sound, move/rename to `src/main/agent-manager/__tests__/review-transition.test.ts`, fix any imports, ensure it actually compiles and passes, then commit it as a separate change.

## Why this matters beyond cleanup

The fact that this file appeared in main at all is a finding — see §2.3 of [`../phase-b-results.md`](../phase-b-results.md). Pipeline agents are not actually constrained to their worktrees; they only "stay there" by convention/prompt. A prompt-injected agent could overwrite arbitrary source files in main. This needs a tool-layer guard.
