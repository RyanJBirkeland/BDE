## Context

`resolveSuccess` in `resolve-success-phases.ts` has 9 steps: verify worktree, detect branch, check no-op, commit, rebase, verify branch tip, transition to review, run advisors, return. Each step calls back into `deps` for git operations via `execFileAsync` with no timeout. The function is ~200 lines with the stepdown rule violated throughout (high-level orchestration and low-level git string manipulation at the same level).

## Goals / Non-Goals

**Goals:**
- Refactor `resolveSuccess` into a `SuccessPhase[]` array, each `{ name, run(ctx): Promise<void> }` — orchestrator iterates, phases are independently testable
- Add `timeoutMs: 30_000` to every `execFileAsync('git', …)` call in completion + review-transition
- Log `{ changedFiles }` when no-op guard fires (even if empty)
- Add `PreReviewAdvisor` interface; register the two existing advisory checks as implementations
- Add decision log on requeue-vs-terminal and on commit count + rebase outcome

**Non-Goals:**
- Changing which git operations are performed
- Adding new advisory checks (just the interface + existing checks)

## Decisions

### D1: SuccessPhase as simple objects, not classes

```ts
interface SuccessPhase {
  name: string
  run(ctx: ResolveSuccessContext): Promise<void>
}
const phases: SuccessPhase[] = [verifyWorktreePhase, detectBranchPhase, ...]
```

Orchestrator: `for (const phase of phases) { await phase.run(ctx) }`. Each phase returns void or throws to abort. Matches existing error-handling contract without introducing a new class hierarchy.

### D2: Git timeout via `execFileAsync` wrapper

```ts
function gitWithTimeout(args: string[], cwd: string): Promise<ExecResult> {
  return execFileAsync('git', args, { cwd, timeoutMs: GIT_EXEC_TIMEOUT_MS })
}
```

`GIT_EXEC_TIMEOUT_MS = 30_000`. Replace every `execFileAsync('git', …)` in completion files with this wrapper.

### D3: PreReviewAdvisor as a fire-and-forget chain

```ts
interface PreReviewAdvisor { name: string; advise(ctx): Promise<string | null> }
```

Each advisor returns a warning string or null. Warnings are appended to `task.notes` before the review transition. Errors in advisors are caught and logged but do not block the transition.

## Risks / Trade-offs

- **Risk**: SuccessPhase refactor introduces a regression in the completion path → Mitigation: all 69 run-agent + completion tests must pass; no behavior change
- **Trade-off**: 30s git timeout may be too short for large repos with slow remotes → constant is named and documented; operators can tune
