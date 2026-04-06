# BDE Multi-Persona Product Audit

**Date:** 2026-04-06
**Scope:** Prompting quality, agent behaviors, features, out-of-box experience, scale readiness
**Core Question:** Does BDE actually deliver amazing out-of-the-box agentic development at scale — without the user having to babysit or argue with the system?

---

## Panel & Grades

| Persona | Grade | Verdict |
|---------|-------|---------|
| **Prompt Engineer** | B+ | Prompts are battle-hardened but have structural gaps that hurt agent output quality |
| **Agent Reliability Engineer** | B+ | Solid defense-in-depth; remaining issues are edge cases, not architectural flaws |
| **Product Manager** | B+ | Core loop is strong but onboarding and failure feedback prevent "it just works" |
| **Senior Developer (User)** | B+ | Review Station is a killer feature; copilot and steering are the daily pain points |
| **DevOps / Scale Engineer** | B- | Built for 2-5 agents; memory and worktree serialization break at 20 |
| **UX Engineer** | B+ | Design system is genuinely good; status visibility and cognitive load need work |

**Overall: B+** — A well-engineered product with a clear value prop and strong core loop. The gaps are not architectural — they're refinement gaps that separate "good tool" from "indispensable tool."

---

## Executive Summary

BDE's core value proposition — spec → queue → autonomous agent → human review → merge — is **working and well-designed**. The Code Review Station is a genuine killer feature. The prompt system is battle-hardened from real operational learnings. The design system is coherent and themeable.

**What prevents BDE from being exceptional:**

1. **The copilot can't see code** — Every spec starts with code exploration, and the copilot can't help. This is the #1 daily friction.
2. **No guided first-task experience** — Users complete onboarding and land on an empty dashboard with zero guidance.
3. **Agents are black boxes while running** — No progress phases, no meaningful steering beyond `/stop`.
4. **Failure feedback doesn't close the loop** — Users know something failed but not how to fix their spec.
5. **Scale ceiling is ~8 agents** on a 16GB machine due to no memory caps on spawned processes.
6. **BDE-specific memory bleeds into non-BDE repos** — Agents working on Python projects get Zustand and IPC conventions injected.

---

## Priority 1: Critical (Directly Hurts Agent Output Quality)

These issues cause agents to produce worse work or cause users to waste time on every session.

### 1.1 Task content has no framing header in the prompt
- **Source:** Prompt Engineer
- **File:** `src/main/agent-manager/prompt-composer.ts` ~line 263
- **Problem:** Task content is appended as raw text (`prompt += '\n\n' + taskContent`) with no `## Task Specification` header. The agent sees a wall of system instructions followed by unmarked user content.
- **Impact:** Agents may start coding before fully parsing the spec, skip sections, or confuse spec content with system instructions.
- **Fix:** Wrap task content: `## Task Specification\n\nRead this entire specification before writing any code. Address every section.\n\n`

### 1.2 Copilot has no code access
- **Source:** Senior Developer, Product Manager
- **File:** `src/renderer/src/components/task-workbench/WorkbenchCopilot.tsx`
- **Problem:** The copilot is explicitly text-only. When drafting specs, users can't ask "which files handle the IPC bridge?" — they have to leave the workbench, search manually, and paste context.
- **Impact:** Specs written without codebase context reference wrong file paths, miss architectural constraints, and produce failing agent runs. This is the **#1 daily time-waster**.
- **Fix:** Create a "copilot-plus" personality with read-only file access (Read/Grep tools) for the target repo. The `workbench:researchRepo` IPC already exists — make it a first-class copilot capability.

### 1.3 Memory modules inject BDE-specific context into all repos
- **Source:** Prompt Engineer
- **File:** `src/main/agent-system/memory/index.ts`
- **Problem:** `getAllMemory()` always returns IPC conventions, BDE testing thresholds, and Electron architecture rules — even for agents working on Python projects or unrelated TypeScript repos.
- **Impact:** Wastes tokens and can actively mislead agents. A Python agent gets Zustand patterns injected.
- **Fix:** Make memory injection conditional on `targetRepo`. If repo !== BDE, skip BDE-specific conventions. Add a `repoName` parameter to `getAllMemory()`.

### 1.4 `maxRuntimeMs` never reaches the prompt
- **Source:** Prompt Engineer
- **File:** `src/main/agent-manager/run-agent.ts` ~line 258
- **Problem:** `buildAgentPrompt()` has a well-written `buildTimeLimitSection()` but `run-agent.ts` never passes `maxRuntimeMs` to it. Pipeline agents never see their time budget.
- **Impact:** Agents can't budget their time (the prompt says 70% implementation / 30% testing) because they don't know their limit. Watchdog kills them without warning.
- **Fix:** Add `maxRuntimeMs: task.max_runtime_ms ?? undefined` to the `buildAgentPrompt` call.

### 1.5 Coverage thresholds are inconsistent
- **Source:** Prompt Engineer
- **Files:** `memory/testing-patterns.ts` says 72/66/70/74, `CLAUDE.md` says 73/65/73/74, `skills/code-patterns.ts` repeats the memory numbers
- **Impact:** Agents target wrong thresholds, causing CI failures or unnecessary work.
- **Fix:** Single source of truth — have memory/skills say "run `npm run test:coverage` to verify CI thresholds" instead of hardcoding numbers.

---

## Priority 2: High (Significant UX/Workflow Friction)

### 2.1 No guided first-task experience
- **Source:** Product Manager, UX Engineer
- **Files:** `src/renderer/src/components/onboarding/steps/DoneStep.tsx`
- **Problem:** After onboarding, user lands on an empty dashboard. No sample task, no guided flow, no "try this."
- **Impact:** Time-to-first-PR is 20-40 minutes. A guided flow could cut this in half.
- **Fix:** On first launch, offer a "Create Sample Task" button that pre-populates the Workbench with an example spec for a safe, simple task.

### 2.2 No global health indicator
- **Source:** UX Engineer
- **File:** `src/renderer/src/components/layout/UnifiedHeader.tsx`
- **Problem:** "Is the agent manager running? How many agents are active? Did anything fail?" requires navigating to Dashboard or Pipeline.
- **Impact:** Users can't tell if the system is working without switching views.
- **Fix:** Add a compact health strip to the header: colored dots or micro-badges showing active/queued/failed counts.

### 2.3 Failed tasks are easy to miss
- **Source:** UX Engineer, Senior Developer
- **Files:** `src/renderer/src/components/dashboard/CenterColumn.tsx`, sidebar icons
- **Problem:** No persistent red badge on sidebar icons, no notification count. The "Attention" card disappears when there are no failures.
- **Fix:** Badge the Pipeline and Code Review sidebar icons with unread counts. Always show the Attention card (green "All clear" when empty).

### 2.4 Agent steering is too limited
- **Source:** Senior Developer
- **File:** `src/renderer/src/components/agents/CommandBar.tsx`
- **Problem:** Only 3 commands: `/stop`, `/retry`, `/focus`. No `/checkpoint`, `/test`, `/scope`, `/undo`.
- **Impact:** When an agent goes off-track, users can only kill it and retry — no course correction.
- **Fix:** Expand the `COMMANDS` array with `/checkpoint` (commit now), `/test` (run tests now), `/scope "files"` (narrow focus).

### 2.5 No test results tab in Code Review
- **Source:** Senior Developer
- **File:** `src/renderer/src/components/code-review/ReviewDetail.tsx`
- **Problem:** To verify tests passed, users scroll through conversation logs looking for `npm test` output buried among dozens of tool calls.
- **Fix:** Add a "Tests" tab that parses test runner output from agent events and displays structured results.

### 2.6 Failure feedback doesn't close the loop
- **Source:** Product Manager, Senior Developer
- **File:** `src/renderer/src/components/sprint/TaskDetailDrawer.tsx`
- **Problem:** Failed tasks show "failed" status but the actual failure reason (from agent conversation) requires navigating to Agents view. No guidance on how to improve the spec.
- **Fix:** Surface failure notes inline in the Pipeline drawer. Add spec quality hints: "Your spec was 42 words. Specs under 200 words have a 35% success rate."

### 2.7 Repo configuration requires manual entry
- **Source:** Product Manager
- **File:** `src/renderer/src/components/settings/RepositoriesSection.tsx`
- **Problem:** Adding a repo requires typing name, path, GitHub owner, and GitHub repo. No auto-detection from `git remote -v`.
- **Fix:** After folder browse, run `git remote get-url origin` to auto-populate GitHub owner/repo and infer name from basename.

---

## Priority 3: Medium (Scale, Reliability, Polish)

### 3.1 No memory cap on agent processes
- **Source:** DevOps/Scale Engineer
- **File:** `src/main/agent-manager/sdk-adapter.ts` ~line 96
- **Problem:** Each Claude CLI process can use 1-2GB RSS. At 20 agents, that's 20-40GB. A 16GB machine hits OOM at ~8.
- **Fix:** Spawn with `NODE_OPTIONS: '--max-old-space-size=1024'` in the env.

### 3.2 Worktree lock serializes all setup per repo
- **Source:** DevOps/Scale Engineer
- **File:** `src/main/agent-manager/worktree.ts`
- **Problem:** Lock is held during `git fetch` (network I/O, 30s timeout). With 10 tasks targeting one repo, setup is fully serialized.
- **Fix:** Hold lock only for `git worktree add` (fast). Run `git fetch` outside the lock.

### 3.3 `sleepSync` blocks Electron main thread
- **Source:** DevOps/Scale Engineer
- **File:** `src/main/data/sqlite-retry.ts` ~line 19
- **Problem:** `Atomics.wait` for synchronous sleep during SQLite retry blocks the entire Electron main thread. Under contention, UI can freeze for seconds.
- **Fix:** Use async sleep or move SQLite writes to a worker thread.

### 3.4 No global cost budget
- **Source:** DevOps/Scale Engineer
- **Problem:** Per-task `max_cost_usd` exists but no session-wide or daily spending limit. At scale, runaway sessions could burn hundreds of dollars.
- **Fix:** Add a `daily_cost_budget_usd` setting. Check aggregate cost in drain loop before spawning.

### 3.5 Watchdog kill + runAgent completion race
- **Source:** Reliability Engineer
- **File:** `src/main/agent-manager/index.ts` ~lines 609-637
- **Problem:** Watchdog deletes from `_activeAgents` and updates task status while `runAgent()` may still be processing the abort. Task state can briefly be inconsistent.
- **Fix:** Have watchdog set a `_pendingKills` flag rather than directly modifying `_activeAgents`. Let `runAgent()` observe the flag and handle its own cleanup.

### 3.6 `updateTask()` silently returns null on invalid transition
- **Source:** Reliability Engineer
- **File:** `src/main/data/sprint-queries.ts`
- **Problem:** Invalid transitions return `null` with a warning log, but callers treat `updateTask()` as fire-and-forget. Dependency resolution can run against incorrect state.
- **Fix:** Check return values in critical paths: `handleWatchdogVerdict()`, `resolveFailure()`.

### 3.7 No spawn failure circuit breaker
- **Source:** Reliability Engineer
- **File:** `src/main/agent-manager/index.ts`
- **Problem:** If Claude SDK/CLI is broken, every queued task is claimed, fails at spawn, and marked `error`. No pause mechanism.
- **Fix:** Track consecutive spawn failures. After 5, pause drain loop for 5 minutes with a user-visible notification.

### 3.8 No disk space monitoring
- **Source:** DevOps/Scale Engineer
- **File:** `src/main/agent-manager/worktree.ts`
- **Problem:** No check before `setupWorktree`. Full disk = cryptic git errors.
- **Fix:** `statfs` check before worktree creation. Refuse with clear error if < 5GB available.

---

## Priority 4: Polish & Strategic

### 4.1 Pipeline personality constraints are too thin
- **Source:** Prompt Engineer
- **File:** `src/main/agent-system/personality/pipeline-personality.ts`
- **Fix:** Add scope-bounding constraint: "If the spec lists ## Files to Change, restrict modifications to those files unless you document the reason."

### 4.2 Assistant personality lists capabilities as "constraints"
- **Source:** Prompt Engineer
- **File:** `src/main/agent-system/personality/assistant-personality.ts`
- **Fix:** Move capability statements to `roleFrame`. Add actual constraints: "Confirm before destructive changes", "Stay focused on user request."

### 4.3 Copilot/synthesizer constraints describe inability, not behavior
- **Source:** Prompt Engineer
- **Files:** `copilot-personality.ts`, `synthesizer-personality.ts`
- **Fix:** Replace "Cannot open URLs" with positive guidance: "Every spec section you suggest should be directly executable by a pipeline agent."

### 4.4 Agent console has no progress phases
- **Source:** UX Engineer
- **File:** `src/renderer/src/components/agents/AgentConsole.tsx`
- **Fix:** Derive phase labels from latest agent event type: "Writing code", "Running tests", "Committing."

### 4.5 Review queue has no urgency/freshness signaling
- **Source:** UX Engineer
- **File:** `src/renderer/src/components/code-review/ReviewQueue.tsx`
- **Fix:** Add relative time badges and freshness dots per queue item (currently only shown after selecting a task).

### 4.6 `--neon-text-dim` fails WCAG AA
- **Source:** UX Engineer
- **File:** `src/renderer/src/assets/neon.css` line 68
- **Fix:** Raise from `rgba(255,255,255,0.3)` to `rgba(255,255,255,0.45)` for ~3.5:1 contrast.

### 4.7 Task Workbench needs progressive disclosure
- **Source:** UX Engineer, Product Manager
- **File:** `src/renderer/src/components/task-workbench/WorkbenchForm.tsx`
- **Fix:** Group into "Essential" (title, repo, spec) and "Advanced" (collapsed by default). Reduces cognitive load from ~10 fields to ~3 for new users.

### 4.8 Agent Manager settings require restart
- **Source:** Product Manager
- **File:** `src/main/agent-manager/index.ts`
- **Fix:** Watch settings keys and update in-memory config on change. Remove restart requirement.

### 4.9 Diff disappears after merge
- **Source:** Senior Developer
- **File:** `src/main/agent-manager/completion.ts`
- **Fix:** In `resolveSuccess`, snapshot diff stats into a `review_diff_snapshot` field on the task before worktree cleanup.

### 4.10 No revision tracking
- **Source:** Senior Developer
- **File:** `src/renderer/src/components/code-review/ReviewActions.tsx`
- **Fix:** Store revision feedback text on the task record. Display previous requests when reviewing the next attempt.

### 4.11 `agent-system-guide.md` is outdated
- **Source:** Prompt Engineer
- **File:** `docs/agent-system-guide.md`
- **Fix:** Remove `useNativeSystem` toggle references and migration guide. The migration is complete.

### 4.12 `agent_events` table grows unbounded
- **Source:** DevOps/Scale Engineer
- **File:** `src/main/db.ts`
- **Fix:** Add startup pruning of events older than 7 days.

---

## Strategic Recommendations

### Positioning
BDE is best positioned as **"the missing infrastructure for Claude Code power users"** — developers who already use Claude Code daily and want to scale from 1 agent to 20. Trying to pitch to developers who've never used AI coding tools will fail because the Claude Code CLI + Anthropic subscription is a hard prerequisite.

### What Makes BDE Uniquely Valuable (vs. running Claude Code manually)
1. **Worktree isolation** — No branch conflicts between agents
2. **Dependency-aware pipeline** — Tasks auto-unblock in order
3. **Human-in-the-loop review gate** — Trust without risk
4. **Retry with context** — Failed agents don't repeat the same mistake
5. **Upstream context propagation** — Dependent tasks know what was already done

### Must-Haves for v1 Launch
1. Code-aware copilot (spec quality is the bottleneck)
2. Guided first-task experience (empty dashboard kills first impressions)
3. Global health indicator (users need to trust the system is working)
4. Failure → spec feedback loop (learning from failures is how users improve)
5. Memory repo-awareness (stop injecting BDE conventions into other repos)

### What to Build After v1
- Cross-task file conflict detection (before merge, not after)
- Post-completion agent interrogation (continue conversation after review)
- Team/multi-user support
- Custom user-defined agent personalities
- Plugin system for custom readiness checks

---

## Appendix: Files Referenced

| File | Issues |
|------|--------|
| `src/main/agent-manager/prompt-composer.ts` | 1.1, 1.4, 1.5, 4.1 |
| `src/main/agent-manager/run-agent.ts` | 1.4 |
| `src/main/agent-system/memory/index.ts` | 1.3 |
| `src/main/agent-system/personality/*.ts` | 4.1, 4.2, 4.3 |
| `src/renderer/src/components/task-workbench/WorkbenchCopilot.tsx` | 1.2 |
| `src/renderer/src/components/layout/UnifiedHeader.tsx` | 2.2 |
| `src/renderer/src/components/agents/CommandBar.tsx` | 2.4 |
| `src/renderer/src/components/code-review/ReviewDetail.tsx` | 2.5 |
| `src/renderer/src/components/sprint/TaskDetailDrawer.tsx` | 2.6 |
| `src/renderer/src/components/settings/RepositoriesSection.tsx` | 2.7 |
| `src/main/agent-manager/sdk-adapter.ts` | 3.1 |
| `src/main/agent-manager/worktree.ts` | 3.2, 3.8 |
| `src/main/data/sqlite-retry.ts` | 3.3 |
| `src/main/agent-manager/index.ts` | 3.5, 3.7 |
| `src/main/data/sprint-queries.ts` | 3.6 |
| `src/renderer/src/assets/neon.css` | 4.6 |
