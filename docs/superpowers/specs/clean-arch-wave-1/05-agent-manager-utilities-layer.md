# Extract Agent-Manager Utilities to src/main/lib/

## Context
Three files live inside `src/main/agent-manager/` but are imported by services and handlers outside the agent orchestration engine:
- `git-operations.ts` — imported by `services/post-merge-dedup.ts` and `handlers/`
- `resolve-dependents.ts` — imported by `services/task-terminal-service.ts`
- `prompt-composer.ts` — imported by handlers and potentially services

This creates inward dependency rule violations: services importing from the agent-manager internal namespace. The dep-rule audit lens also flagged a micro-cycle: `agent-manager/git-operations.ts` imports `services/post-merge-dedup`, while services import from `agent-manager/`. Moving these to `src/main/lib/` (shared utilities available to all main-process modules) resolves the ambiguity.

`post-merge-dedup.ts` should also be moved as a prerequisite (it is the other end of the cycle).

## Goal
Move 4 files to `src/main/lib/`. Update all import sites. No behavioral changes.

## Files to Move

| From | To |
|------|----|
| `src/main/agent-manager/git-operations.ts` | `src/main/lib/git-operations.ts` |
| `src/main/agent-manager/resolve-dependents.ts` | `src/main/lib/resolve-dependents.ts` |
| `src/main/agent-manager/prompt-composer.ts` | `src/main/lib/prompt-composer.ts` |
| `src/main/services/post-merge-dedup.ts` | `src/main/lib/post-merge-dedup.ts` |

**Note on prompt-composer.ts:** This file is referenced by name in CLAUDE.md as a key file location. After moving, update the CLAUDE.md reference to reflect the new path.

## Instructions
1. Before moving any file, grep for all import sites of each file across the entire `src/` tree.
2. Move one file at a time. After each move: update all import paths, run `npm run typecheck` to confirm zero errors before proceeding.
3. Move order: `post-merge-dedup.ts` first (smallest impact), then `resolve-dependents.ts`, then `git-operations.ts`, then `prompt-composer.ts`.
4. Files within `agent-manager/` that import from these moved files must update their import paths to `../lib/`.
5. Update `docs/CLAUDE.md` key file reference for `prompt-composer.ts`.
6. Do not change any function signatures or exports — only file location.

## Files to Change (import sites to update)
Run these greps before starting to find all import sites:
- `grep -r "agent-manager/git-operations" src/`
- `grep -r "agent-manager/resolve-dependents" src/`
- `grep -r "agent-manager/prompt-composer" src/`
- `grep -r "services/post-merge-dedup" src/`

## How to Test
- `npm run typecheck` must pass after every individual file move.
- `npm test` must pass at the end.
- `npm run test:main` must pass.
- `npm run lint` must pass.
- No functional changes — CI is the primary verification signal.
