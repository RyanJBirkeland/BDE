# BDE Dogfooding Report — 2026-04-17

**What this is:** A handoff document for a fresh Claude Code session. Captures everything observed during a ~3-hour session that ran 118 CSS/UI audit tasks through the BDE agent pipeline as a stress test of dogfooding readiness. Each finding includes evidence, suspected root cause, and proposed fix scoped to the relevant BDE module so the next session can act on it without re-running the experiment.

**Branch state at end:** `main` is 81+ commits ahead of where the session started. All 118 tasks shipped, all tests green at each push. The audit work itself succeeded; the report below is about the **agent infrastructure** that delivered it.

---

## TL;DR

The pipeline works for **simple, single-file changes**. It struggles with anything that requires reading + editing + verifying across multiple files, because the SDK's `maxTurns=20` cap is too tight for that pattern. ~30% of tasks needed manual intervention from me. The biggest infrastructure bug is **agent edits leaking into the main repo working tree** — which both pollutes ship cycles and confuses the agent on retry. Fix the leak, raise maxTurns for non-trivial specs, and add a "tests-touched-by-this-change" check before agent commits, and the same audit would likely run unattended.

---

## Session statistics

| Metric | Value |
|---|---|
| Tasks queued | 118 (10 epics) |
| Tasks shipped | 118 (100%) |
| Wall clock | ~3h 15min |
| Agent completion events | ~150 (incl. retries) |
| Commits on `main` | 80+ |
| Manual-ship interventions | ~25 |
| Recovery from "failed" status | 5 (T-87, T-89, T-69 manual rescue; T-19 + T-42 hand-rolled) |
| Pre-push hook failures | ~8 (mostly transient native-module rebuilds + 4 real test breaks) |
| `npm run dev` restarts | 1 (initial PATH fix; ran continuously after) |
| Estimated agent-only completion rate | ~70% (rest needed sharpened specs, manual fixes, or full hand-rolls) |

---

## Findings

Findings are P0 (blocked the experiment), P1 (significant friction), P2 (cosmetic friction). Each has evidence + a fix sized for one task.

---

### F-1 · P0 · Packaged BDE.app can't find `node` on macOS

**Evidence:**
- Initial run after queueing produced 30+ identical agent-manager log errors: `Claude Code executable not found at /Applications/BDE.app/Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js. Is options.pathToClaudeCodeExecutable set?`
- Verified: `cli.js` exists, has `#!/usr/bin/env node` shebang, is executable.
- `PATH=/usr/bin:/bin which node` → not found. fnm-installed node lives at `~/.local/share/fnm/aliases/default/bin/node` which is not on a GUI-launched Electron app's PATH.
- 2 tasks burned to permanent `error` state with `failure_reason='spawn'` before I caught it.

**Root cause:** The SDK uses the shebang-resolved `node` interpreter to spawn `cli.js`. macOS GUI-launched apps inherit `/etc/paths` (`/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`) — fnm's per-shell symlinks under `~/.local/state/fnm_multishells/.../bin/` are never on this list. Bun-managed and nvm-managed Node have the same issue.

**Workaround used:** Killed BDE.app, ran `npm run dev` from a terminal where `node` was on PATH; Electron's main process inherited the shell PATH.

**Proposed fix (scope: 1 task):**
1. In `src/main/sdk-adapter.ts` (or wherever the SDK is constructed), set `options.pathToClaudeCodeExecutable` explicitly to a known-good Node path. Detect bundled Node via `process.execPath` — Electron ships with its own Node that the SDK can use directly. Or fall back to `which-fnm-node`-style probing of common installer paths (`~/.local/share/fnm/aliases/default/bin/node`, `~/.nvm/versions/node/*/bin/node`, `/opt/homebrew/bin/node`).
2. Document in `docs/BDE_FEATURES.md` packaging section that fnm/nvm users currently must launch from a terminal until this lands.

**Files to investigate:**
- `src/main/agent-manager/sdk-adapter.ts`
- `src/main/index.ts` (where the agent-manager is constructed)
- Any spot that constructs the SDK options object

---

### F-2 · P0 · Agent edits leak into the main repo working tree

**Evidence:** 8+ incidents. Pattern: an agent times out at maxTurns without committing. Next time I run `git status` in the main repo, files the agent was editing show up as `M ...` even though I never touched them. Examples logged:

- After T-122 timed out: `M src/renderer/src/components/ui/TextareaPromptModal.tsx` appeared in main checkout with the agent's partial edit.
- After T-104 timed out: `M src/renderer/src/components/sprint/TaskPill.css` appeared in main with valid focus-visible additions.
- After T-101 retry: `M src/renderer/src/components/sprint/PipelineHeader.tsx` + `.css` showed up in main.

**Suspected root cause:** Unknown — three theories:
1. The Vite dev server (running `npm run dev`) watches the source tree and somehow cross-talks between worktrees. The agent's worktree shares `node_modules` via symlink; possibly some HMR pathway is writing to wrong directory.
2. The agent's `cwd` is briefly the main repo (not its worktree) during some tool call. If `Edit` is run before `cd` resolves, edits land in the wrong place.
3. The completion handler's cleanup path moves files from worktree to main when it shouldn't.

**Why this is critical:** When I went to ship the next task with `ship_task.py`, the dirty file blocked the cherry-pick. Worse, when an agent was retrying a failed task, its **fresh worktree** would copy from main → see the half-finished work already there → spend turns trying to figure out what was already done.

**Workaround used:** Auto-restore in `ship_task.py`:
```python
if status.stdout.strip():
    print(f'  auto-restoring dirty files in main repo:\n{status.stdout.rstrip()}')
    run(['git', 'checkout', '--', '.'])
```

**Proposed fix (scope: 1 investigation + 1 fix task):**
1. **Investigate**: instrument `agent-manager/run-agent.ts` to log the `cwd` and `target_path` of every `Edit`/`Write` tool call. Run a known-failing task (anything in S5) and observe whether tool calls ever target the main repo path.
2. **Defensive fix in `worktree.ts`**: ensure the agent's spawn `cwd` is the worktree path AND that the SDK's tool-use validators reject any `file_path` outside the worktree. This is a hardening pass even if the leak source turns out to be Vite.
3. **Test**: Trigger a maxTurns timeout, confirm main repo stays clean.

**Files to investigate:**
- `src/main/agent-manager/run-agent.ts`
- `src/main/agent-manager/worktree.ts`
- `src/main/agent-manager/sdk-adapter.ts` (look at `cwd` option)
- `src/main/agent-manager/completion.ts` (cleanup path)

---

### F-3 · P0 · "no_commits" retry loop runs forever when work auto-merges elsewhere

**Evidence:** Several tasks (T-19, T-28, T-42, T-43, T-69, T-73, T-87, T-115) cycled through 3 `no_commits` retries while their actual work was already on `origin/main` via auto-merge or earlier successful runs. The agent's fresh worktree saw the work done, spent 20 turns investigating why it was being asked again, gave up.

Example log for T-28:
```
agent:tool_call git status
agent:tool_call git log --oneline -5
agent:tool_call Read LaunchpadGrid.css (with focus-visible already in it)
agent:tool_call Grep ":focus-visible" path=...launchpad.css
agent:tool_call git diff HEAD src/.../LaunchpadGrid.css
agent:tool_call git log --oneline --all --grep="focus-visible"
agent:tool_call git ls-remote origin agent/...
agent:tool_call git log -1 --format=full 3727de2a
agent:error max_turns_exceeded
```

**Root cause:** There's no "is this work already done" check before spawning. When `auto-merge-policy.ts` merges a successful agent's commit to `main`, BDE doesn't update the task's status atomically — so the drain loop sees `status='queued', retry_count=N` and tries again.

**Proposed fix (scope: 1 task):**
1. In `agent-manager/drain.ts` (or wherever tasks are claimed), before spawning add a check: `if (taskHasMatchingCommitOnMain(task)) { markDone(task); return }`. Heuristic for "matching commit": commit message contains `(T-N)` reference OR commit subject is the task title verbatim OR the `agent_run_id` is referenced anywhere in `git log`.
2. Make the auto-merge path **transactional**: when `auto-merge-policy.ts` lands a commit on main, immediately mark the task `done` in the same DB transaction.
3. Add a max-retry-cap (3 is the current limit?) → after exhaustion, set `status='failed'` instead of looping.

**Files to investigate:**
- `src/main/agent-manager/drain.ts` or `index.ts`
- `src/main/agent-manager/auto-merge-policy.ts`
- `src/main/agent-manager/completion.ts` (the no-commits path)

---

### F-4 · P1 · `maxTurns = 20` is badly calibrated for non-trivial specs

**Evidence:** Of the 118 tasks, agent completion rate was:
- **~95%** for single-file CSS edits with explicit selector + change
- **~60%** for TSX-only changes (e.g. add aria-label, swap className)
- **~30%** for TSX + CSS combined changes (where agent reads both, edits both, verifies tests)
- **~10%** for "shared component migration" tasks (T-87, T-89, T-110, T-114, T-115) — these almost always hit maxTurns

`maxTurns_exceeded` was the dominant `failure_reason` in the no_commits cases. Logs consistently showed agents spending 8-12 turns on file reads + grep + verification, leaving only 8-12 turns for actual edits.

**Proposed fix (scope: 1 task):**
1. In `prompt-composer.ts` or wherever maxTurns is set, **make it spec-aware**:
   - Default: 30 (currently 20)
   - For specs that mention "TSX" + "CSS" or list 3+ files: 50
   - For specs flagged with `## Multi-File: true` (new spec convention): 75
2. OR: introduce a `tool_budget` per spec rather than turn count — each `Edit` is "cheap" but each `Bash`/`Grep`/`Read` outside the listed files is "expensive". Keeps agents focused.
3. Include in the prompt a **"don't over-verify"** instruction: "Trust the spec's file list. Skip exploring directories outside the listed files. Skip running tests — the pre-push hook does that."

**Files to investigate:**
- `src/main/agent-manager/prompt-composer.ts`
- `src/main/agent-manager/sdk-adapter.ts` (where `maxTurns` is passed)
- `src/main/agent-manager/prompt-pipeline.ts`

---

### F-5 · P1 · Agent branches drift to wrong commits during retry cleanup

**Evidence:** I lost ~30 min to detective work on this. Specific incidents:

- After T-101's retry, `agent/convert-pipelineheader-stat-chips-from-s-ce2fd16c` pointed at commit `f5bd632c fix(planner): change .modal-select:focus to :focus-visible` (T-44's work, totally unrelated).
- Multiple agent branches resolved to the same commit SHA after a series of retries.
- ~5 tasks had branches whose `git log` tip showed a commit message belonging to a different task entirely.

If I had cherry-picked these blindly, I would have **reverted other tasks' work**. My `ship_batch.py` heuristic (compare `git diff --name-only branch...main` to the task's expected files) caught most of them but isn't bulletproof.

**Suspected root cause:** The retry cleanup path in `completion.ts` does some kind of branch reset, possibly to `origin/main`'s tip, but if a stale ref is still around it ends up pointing at whatever commit was current when the original agent finished (which may be unrelated work that auto-merged in the meantime).

**Proposed fix (scope: 1 task):**
1. On retry, **delete the agent branch entirely** before recreating the worktree. Don't try to re-use the branch ref.
2. After agent completion, **verify the branch tip** matches the agent_run_id in the commit's metadata before allowing transition to `review`. If tip doesn't match, mark task as failed with diagnostic notes pointing to the unexpected commit.

**Files to investigate:**
- `src/main/agent-manager/completion.ts` (retry path)
- `src/main/agent-manager/worktree.ts` (worktree + branch creation)

---

### F-6 · P1 · Agents don't update tests when they change tested code

**Evidence:** 4 confirmed incidents where agent shipped to review with tests broken:

| Task | Change | Broken test |
|---|---|---|
| T-101 | `<span role="button">` → `<button>` | `closest('[role="button"]')` queries |
| T-79 | placeholder `"Name"` → `"e.g. bde"` | `getByPlaceholderText('Name')` |
| T-119 | Widened `<Input>` API | (no tests existed; not broken but spec said "add tests") |
| T-120 | Widened `<Textarea>` with `resize` prop | Variable name shadowed function — esbuild transform error |

All caught at pre-push (~40s test run). I had to fix tests manually.

**Proposed fix (scope: 1 task):**
1. In `prompt-composer.ts`, append to every prompt: "After making code changes, search for tests that reference the symbols you changed (selectors, placeholder text, function names). Update them. Run `npm run typecheck` and `npm test` in your worktree before considering done."
2. Add a **test-touched check**: before transitioning to `review`, run `git diff --name-only branch...main`. For every changed source file, check if a corresponding `__tests__/<name>.test.tsx` exists and was *also* modified or created. If not, append a warning to the task notes ("⚠ no test changes detected"). Doesn't block, but flags for human review.

**Files to investigate:**
- `src/main/agent-manager/prompt-composer.ts`
- `src/main/agent-manager/completion.ts` (transition to review)

---

### F-7 · P1 · Pre-push `node-gyp rebuild` flakes intermittently

**Evidence:** Several push attempts failed with:
```
error opening './Release/.deps/Release/obj.target/sqlite3/gen/sqlite3/sqlite3.o.d.raw': No such file or directory
make: *** [Release/obj.target/sqlite3/gen/sqlite3/sqlite3.o] Error 1
```

Cleared with `rm -rf node_modules/better-sqlite3/{build,.deps} && node-gyp rebuild`. ~1 in 8 push attempts hit this.

**Suspected root cause:** Concurrent test runs from rapid pushes corrupt the `.deps` cache.

**Proposed fix (scope: 1 task):**
1. The rebuild in `.husky/pre-push` should be idempotent. Either:
   - Always `rm -rf .deps` before rebuild (safe but slower), OR
   - Skip rebuild entirely when the `.node` artifact's mtime is newer than any `.cc/.h` source file in `node_modules/better-sqlite3/src/`.
2. Even better: cache the rebuilt `.node` file by `(node version, electron version, package version)` triple in `~/.bde/native-cache/`. Skip rebuild when the cache key matches.

**Files to investigate:**
- `.husky/pre-push`
- `package.json` `posttest:main` script

---

### F-8 · P2 · Push hook serializes pipeline-agent throughput

**Evidence:** Each `git push origin main` triggers `typecheck + test:main + test:renderer + lint` (~60s). With WIP=2, my session was push-bound rather than agent-bound for the second half of the run. Throughput plateaued at ~18 tasks/hour on push, while agents finished ~2x faster than that.

**Proposed fix (scope: 1 task):**
1. Add a **batch-ship UI** to Code Review Station: "Ship N selected" → cherry-picks all → single push. (My `/tmp/ship_batch.py` proves the pattern works.)
2. Or relax pre-push for pipeline-agent CSS-only commits: the auto-merge policy can opt out of the full suite if `git diff --name-only` shows only `.css` files changed.

**Files to investigate:**
- `src/renderer/src/components/code-review/ReviewActionsBar.tsx` (Ship It button)
- `src/main/handlers/code-review.ts` (Ship It IPC handler)
- `src/main/agent-manager/auto-merge-policy.ts`

---

### F-9 · P2 · Specs need a "no exploration" enforcement

**Evidence:** Several agents spent 8+ turns running git commands (`git log`, `git status`, `git ls-remote`, `git diff HEAD`, `git log --grep`) before making any edit. The spec said "change X to Y in file Z" — exploration was not needed.

**Proposed fix (scope: 1 task):**
1. In `prompt-composer.ts` or `prompt-pipeline.ts`, prepend to every spec:
   > "TRUST THE SPEC. Don't run `git status`, `git log`, `git diff`, `git ls-remote`, or any reconnaissance commands unless the spec explicitly asks you to. Just open the listed files, make the listed changes, and commit. Use `Bash` only for `npm run typecheck`, `npm test`, or to run a verification command from the spec."
2. Consider a `disallowedTools` SDK option for pipeline agents: deny `Bash` calls matching `^git (log|status|ls-remote|diff|reflog)`.

**Files to investigate:**
- `src/main/agent-manager/prompt-pipeline.ts`
- `src/main/agent-manager/sdk-adapter.ts` (SDK options)

---

### F-10 · P2 · Audit accuracy → downstream confusion

**Evidence:** My audit said T-116's hex drift was in `WorkbenchCopilot.css:132`. Wrong — the actual drift was 8 occurrences in `TaskWorkbench.css` + `DependencyPicker.css`, none in `WorkbenchCopilot.css`. The agent's scratchpad helped it find the right file, but it spent turns doing so. Same with T-78 (CSS line referenced wasn't where the rule actually was).

**Proposed fix (scope: process change, not BDE code):**
1. Audit specs (the kind I generated) should include a **verification step** in the audit script: for every `file:line` reference in the report, grep that line for the cited symbol and only emit the finding if it matches.
2. The `/audit` command itself should run a final pass that grep-verifies each finding's location before writing the report.

**Files to investigate:**
- `~/.claude/commands/audit` (or wherever the slash command is defined)

---

### F-11 · P2 · Worktree hooks suppress legit notifications

**Evidence:** Every Bash output had `<system-reminder>` warnings about TaskCreate/TaskUpdate that were noise — they fired even when I was clearly mid-flow on the user's task. Not a BDE issue but worth noting since it added cognitive load.

**Proposed fix:** N/A for BDE — but if you have a `Stop` hook in `~/.claude/settings.json`, consider adding a guard that suppresses these reminders when the conversation has used a tool in the last N seconds.

---

### F-12 · P2 · No way to "skip remaining retries" from the UI

**Evidence:** Several tasks were stuck at retry_count=2 doing the same fruitless thing each time. There was no way for me to say "stop retrying this and let me handle it" without dropping into SQLite.

**Proposed fix (scope: 1 task):**
1. Add a "Mark Failed" button to tasks in `queued`/`active` status in the Sprint Pipeline UI — sets `status='failed'` and prevents further retries.
2. Add a "Force Done" button (with confirmation) for cases where I've manually shipped the work and just need to update status.

**Files to investigate:**
- `src/renderer/src/components/sprint/TaskDetailDrawer.tsx`
- `src/renderer/src/components/sprint/TaskPill.tsx`
- `src/main/handlers/sprint-local.ts` (need a `forceFailTask` IPC handler)

---

## Open questions

These are things I observed but couldn't root-cause with the time I had. A new session should investigate:

1. **Why does the agent's `git diff main..agent/<branch>` sometimes show files unrelated to the task?** Concrete example: `agent/convert-pipelineheader-stat-chips-from-s-ce2fd16c`'s tip was `f5bd632c fix(planner): change .modal-select:focus to :focus-visible`. Two completely different tasks. Are agent branches getting reset to whatever HEAD is when the worktree is recreated?

2. **Why do some commits auto-merge to local `main` without my `ship_task.py` involvement, and others stay on agent branches?** I saw both behaviors, no obvious pattern. Looking at `auto-merge-policy.ts` would help — under what conditions does it fire?

3. **Why does Vite dev server seemingly cause file modifications in the main repo when the source is changed in a worktree?** Or is it not Vite at all? Adding strace/inotify-style logging to the main repo path while running an agent in its worktree would identify the writer process.

4. **Why does T-118 (and a few others) show as "failed" with retry_count=3 but the work IS in the codebase?** Possibly a race between the no_commits detector and the auto-merge path.

5. **Is the SDK actually respecting `pathToClaudeCodeExecutable` in BDE's current spawn config?** It's the documented escape hatch for the F-1 PATH issue but I never confirmed BDE is using it.

---

## What worked well — preserve these

1. **Streaming completions via Monitor** — being notified on every agent completion let me react in real-time without polling. Critical for this kind of operational work.
2. **`safeHandle` IPC error patterns** — every IPC failure I encountered was logged usefully. Made debugging fast.
3. **Auto-merge policy** — when it fired correctly, it reduced ship overhead by ~50% (skipped my cherry-pick step).
4. **Task-level dependency graph** — when T-119 (Input primitive) shipped, six dependent tasks auto-unblocked. Zero manual coordination needed.
5. **Worktree-per-task isolation (when it works)** — when not leaking, complete isolation was clean.
6. **The pre-push hook itself** — caught 4 real test breaks before they reached origin. Slow but correct.

---

## Suggested follow-up tasks (ready to queue)

If you want to immediately turn this report into pipeline work, these are sized as proper specs:

| # | Title | Epic | Priority |
|---|---|---|---|
| 1 | Fix packaged BDE.app PATH lookup for fnm-managed Node (F-1) | Packaging | P0 |
| 2 | Investigate + plug agent edit leak into main checkout (F-2) | Agent Manager | P0 |
| 3 | Auto-mark tasks done when matching commit lands on main (F-3) | Agent Manager | P0 |
| 4 | Make `maxTurns` spec-aware (default 30, multi-file 50, large 75) (F-4) | Agent Manager | P1 |
| 5 | Reset agent branches cleanly on retry; verify branch tip on completion (F-5) | Agent Manager | P1 |
| 6 | Add "tests touched?" warning before transitioning to review (F-6) | Agent Manager | P1 |
| 7 | Cache `node-gyp rebuild` artifacts; skip when source unchanged (F-7) | Build | P1 |
| 8 | Add batch-ship UI to Code Review Station (F-8) | Code Review | P2 |
| 9 | Add "no exploration" preamble to pipeline agent prompts (F-9) | Agent Manager | P2 |
| 10 | Add audit-verifier step that grep-checks each finding's location (F-10) | Slash command | P2 |
| 11 | Add "Mark Failed" + "Force Done" UI controls on stuck tasks (F-12) | UI | P2 |
| 12 | Add `git status` log line + cwd assert at agent start (defense for F-2) | Agent Manager | P2 |

---

## Closing note

The audit work shipped. The **infrastructure to ship it** revealed real gaps but none were unrecoverable — every blocker had a workaround I could find within minutes. The pipeline is **70% production-ready** for unsupervised operation today. Fixing F-1 + F-2 + F-3 + F-4 alone would push that to ~90%.

The most important thing this session demonstrated: **BDE can in fact ship its own audit work end-to-end via the agent pipeline.** That's the dogfooding test passing. The rough edges are real but every one of them is fixable.

— Session ran 2026-04-17 ~07:30–11:05 PDT
