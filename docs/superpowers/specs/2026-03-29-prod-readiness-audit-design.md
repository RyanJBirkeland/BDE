# BDE Production Readiness Audit — Design Spec

**Date:** 2026-03-29
**Status:** Draft

---

## 1. Goal

Systematically audit BDE's six highest-risk features through three specialized personas, synthesize findings, and queue remediation tasks for the agent pipeline. Output: a clean, prioritized backlog of prod-readiness fixes with full specs, queued and ready for automated execution.

## 2. Scope

### Features (6)

| #   | Feature         | Risk Profile                                                                    |
| --- | --------------- | ------------------------------------------------------------------------------- |
| 1   | Agent Manager   | Auth, worktree escape, env leaks, spawn races, retry logic                      |
| 2   | Queue API       | Auth bypass, CORS, injection, SSE token, claim races, WIP enforcement           |
| 3   | Sprint Pipeline | Dependency manipulation, status bypass, transition guards, poller edge cases    |
| 4   | IDE             | Path traversal, symlink, sandbox, file watcher races, binary detection          |
| 5   | PR Station      | GitHub proxy scope, token exposure, cache staleness, merge UX                   |
| 6   | Data Layer      | SQL injection, backup path, migration safety, WAL corruption, concurrent access |

### Personas (3)

| Persona                  | Lens        | Focus Areas                                                                                                                                     |
| ------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Red Team**             | Adversarial | Injection, auth bypass, token leaks, sandbox escape, CORS, path traversal, privilege escalation, environment variable exposure                  |
| **Reliability Engineer** | Defensive   | Race conditions, error swallowing, missing validation, uncaught promises, edge cases, data corruption paths, test coverage gaps, resource leaks |
| **UX QA**                | User-facing | Broken flows, missing error/loading/empty states, dead UI, misleading feedback, accessibility gaps, recovery guidance                           |

### Out of Scope

- Shell & Layout, Dashboard, Source Control, Task Workbench (lower risk — second wave)
- Renderer sandbox re-enablement (SEC-1) — multi-sprint architectural change
- Design system unification (ARCH-4) — architectural decision, not audit finding
- Writing fixes — this phase is audit only

## 3. Phase 1: Audit (18 Agents)

### 3.1 Batching

Agents run in 3 batches of 6 (respecting ~6 concurrent agent limit):

| Batch | Feature A                              | Feature B                         |
| ----- | -------------------------------------- | --------------------------------- |
| **1** | Agent Manager (Red, Reliability, UX)   | Queue API (Red, Reliability, UX)  |
| **2** | Sprint Pipeline (Red, Reliability, UX) | IDE (Red, Reliability, UX)        |
| **3** | PR Station (Red, Reliability, UX)      | Data Layer (Red, Reliability, UX) |

Each batch must complete before the next starts (findings from earlier batches may inform later ones, and we avoid rate limits).

### 3.2 Agent Inputs

Each agent receives:

1. **Feature-scoped file list** (see Section 7)
2. **Persona-specific prompt** with instructions on what to look for and what to ignore
3. **Output template** (see Section 3.3)
4. **Reference to existing audit** — `docs/superpowers/audits/synthesis-final-report.md` — agents must cross-reference and note which existing findings are fixed, still open, or newly discovered
5. **CLAUDE.md context** — agents run with `settingSources: ['user', 'project', 'local']`

### 3.3 Output Format

Each agent writes to `docs/superpowers/audits/prod-audit/{feature}-{persona}.md`:

```markdown
# {Feature} — {Persona} Audit

**Date:** 2026-03-29
**Scope:** {file count} files in {feature}
**Persona:** {Red Team | Reliability Engineer | UX QA}

## Cross-Reference with March 28 Audit

### Previously Reported — Now Fixed

- {ID}: {description} — verified fixed in {commit/PR}

### Previously Reported — Still Open

- {ID}: {description} — still present at {file:line}

### New Findings

(See below)

## Findings

### {FEAT-PERSONA-N}: {Title}

- **Severity:** critical | high | medium | low
- **Effort:** S (< 1hr) | M (1-4hr) | L (4hr+)
- **File(s):** {exact paths with line numbers}
- **Description:** {what's wrong and why it matters}
- **Evidence:** {code snippet or reproduction steps}
- **Recommendation:** {specific fix approach — not vague, include function names and patterns}

## Summary

| Severity | Count |
| -------- | ----- |
| Critical | N     |
| High     | N     |
| Medium   | N     |
| Low      | N     |

**Total findings:** N
**Previously reported (fixed):** N
**Previously reported (still open):** N
**New findings:** N
```

### 3.4 Persona-Specific Instructions

#### Red Team

You are a security auditor performing a penetration-test-style code review. Your goal is to find every exploitable vulnerability.

**Look for:**

- Injection vectors (SQL, command, path, HTML/JS)
- Authentication/authorization bypass
- Token/credential exposure (env vars, logs, IPC, error messages)
- Sandbox escapes and privilege escalation
- CORS misconfigurations
- Race conditions that create security windows
- Unsafe deserialization or eval patterns
- Missing input validation at trust boundaries (IPC, HTTP, file system)

**Ignore:**

- Code style, naming, documentation
- Performance optimizations
- UX issues that don't have security implications
- Test coverage (unless missing tests mask a security issue)

#### Reliability Engineer

You are a reliability engineer reviewing code for production readiness. Your goal is to find every path that leads to data loss, crashes, or silent failures.

**Look for:**

- Unhandled promise rejections and uncaught exceptions
- Race conditions (TOCTOU, concurrent writes, stale reads)
- Error swallowing (empty catch blocks, ignored return values)
- Missing validation at module boundaries
- Resource leaks (file handles, timers, listeners, DB connections)
- Edge cases (empty arrays, null/undefined, MAX_INT, unicode, very long strings)
- Data corruption paths (partial writes, missing transactions)
- Retry logic that amplifies failures
- Missing or incorrect cleanup on shutdown
- Test coverage gaps for critical paths

**Ignore:**

- Security vulnerabilities (Red Team covers this)
- UI/UX issues
- Code style beyond what affects reliability

#### UX QA

You are a QA engineer focused on user experience. Your goal is to find every broken flow, missing feedback, and confusing interaction.

**Look for:**

- Dead UI elements (buttons that do nothing, unreachable states)
- Missing loading states (skeleton, spinner, or text)
- Missing error states (what does the user see when things fail?)
- Missing empty states (what does the user see with no data?)
- Misleading feedback (success messages on failure, stale data displayed as current)
- Broken navigation flows (clicking edit leads to blank form, etc.)
- Accessibility gaps (missing ARIA, keyboard traps, no focus management)
- Inconsistent behavior (two merge buttons, duplicate controls)
- Recovery guidance (can the user fix the problem from the error state?)

**Ignore:**

- Visual design, color choices, spacing
- Security vulnerabilities
- Internal code quality that doesn't affect UX

## 4. Phase 2: Synthesis (1 Agent)

After all 18 audits complete, a synthesis agent:

1. Reads all 18 findings docs from `docs/superpowers/audits/prod-audit/`
2. **Deduplicates** — same issue flagged by multiple personas OR across overlapping feature scopes gets one entry with all sources cited
3. **Cross-references** against March 28 audit synthesis — marks what's been fixed, what's still open, what's new
4. **Prioritizes** using severity × effort matrix
5. **Groups** by feature × severity bucket (for Phase 3 task creation)

Output: `docs/superpowers/audits/prod-audit/synthesis.md`

```markdown
# Production Readiness Audit — Synthesis

**Date:** 2026-03-29
**Sources:** 18 audit reports (6 features × 3 personas)

## Executive Summary

{2-3 paragraph overview}

## Delta from March 28 Audit

### Fixed Since Last Audit

- {list}

### Still Open from Last Audit

- {list}

### New Findings

- {list}

## Findings by Feature × Severity

### Agent Manager

#### Critical/High

| ID | Title | Severity | Effort | Sources | File(s) |

#### Medium

| ID | Title | Severity | Effort | Sources | File(s) |

#### Low

| ID | Title | Severity | Effort | Sources | File(s) |

### Queue API

{same structure}

### Sprint Pipeline

{same structure}

### IDE

{same structure}

### PR Station

{same structure}

### Data Layer

{same structure}

## Remediation Task Map

| Task         | Feature       | Severity Bucket | Finding IDs        | Est. Effort | Dependencies |
| ------------ | ------------- | --------------- | ------------------ | ----------- | ------------ |
| {task title} | Agent Manager | Critical/High   | AM-RED-1, AM-REL-3 | M           | none         |
| {task title} | Agent Manager | Medium          | AM-UX-2, AM-REL-5  | S           | above        |
| ...          | ...           | ...             | ...                | ...         | ...          |
```

## 5. Phase 3: Task Creation & Queuing

### 5.1 Task Granularity

One task per **feature × severity bucket**:

| Feature         | Critical/High | Medium | Low    |
| --------------- | ------------- | ------ | ------ |
| Agent Manager   | 1 task        | 1 task | 1 task |
| Queue API       | 1 task        | 1 task | 1 task |
| Sprint Pipeline | 1 task        | 1 task | 1 task |
| IDE             | 1 task        | 1 task | 1 task |
| PR Station      | 1 task        | 1 task | 1 task |
| Data Layer      | 1 task        | 1 task | 1 task |

**Maximum 18 tasks** (some cells may be empty if no findings at that severity).

### 5.2 Task Spec Template

Each task created via `sprint:create` IPC with status `queued`:

```markdown
## Overview

Fix {severity} issues in {feature} identified by production readiness audit.

## Findings to Address

### {ID}: {Title}

- **File(s):** {paths with line numbers}
- **Problem:** {description}
- **Fix:** {concrete approach — function names, patterns, code snippets}
- **Test:** {what test to write or update to verify}

### {ID}: {Title}

...

## Acceptance Criteria

- [ ] All listed findings addressed
- [ ] Existing tests still pass (`npm test` + `npm run test:main`)
- [ ] New tests written for each fix
- [ ] `npm run typecheck` passes
- [ ] No new lint warnings

## Files in Scope

{explicit file list from audit findings}
```

### 5.3 Dependency Wiring

- **Critical/High tasks** — no dependencies, queued immediately
- **Medium tasks** — `soft` dependency on the Critical/High task for the same feature
- **Low tasks** — `soft` dependency on the Medium task for the same feature

This ensures priority ordering while allowing Medium/Low tasks to proceed even if the higher-severity task fails.

### 5.4 Execution

Phase 3 is executed by a **Task Creation Agent** (20th agent) that:

1. Reads `docs/superpowers/audits/prod-audit/synthesis.md`
2. Parses the Remediation Task Map table
3. For each row, creates a sprint task via `sprint:create` IPC with status `queued`, a full spec (per Section 5.2 template), and dependency wiring (per Section 5.3)
4. Reports the created task IDs and dependency graph

This agent runs after the synthesis agent completes. It needs access to the BDE main process IPC (run from within the Electron app context or via Queue API at `localhost:18790`).

### 5.5 Task Naming Convention

`audit-{feature}-{severity}` — e.g., `audit-agent-manager-critical`, `audit-queue-api-medium`

## 6. Execution Flow

```
1. Dispatch Batch 1 (6 agents) → wait for completion
2. Dispatch Batch 2 (6 agents) → wait for completion
3. Dispatch Batch 3 (6 agents) → wait for completion
4. Dispatch Synthesis agent (19th) → wait for completion
5. Dispatch Task Creation agent (20th) → reads synthesis, creates sprint tasks via Queue API, sets status: queued
6. Agent pipeline picks up remediation tasks automatically
```

## 7. Feature File Scopes

### 7.1 Agent Manager (18 source + 17 test files)

**Source:**

- `src/main/agent-manager/index.ts`
- `src/main/agent-manager/types.ts`
- `src/main/agent-manager/concurrency.ts`
- `src/main/agent-manager/dependency-helpers.ts`
- `src/main/agent-manager/dependency-index.ts`
- `src/main/agent-manager/fast-fail.ts`
- `src/main/agent-manager/watchdog.ts`
- `src/main/agent-manager/worktree.ts`
- `src/main/agent-manager/resolve-dependents.ts`
- `src/main/agent-manager/completion.ts`
- `src/main/agent-manager/orphan-recovery.ts`
- `src/main/agent-manager/prompt-composer.ts`
- `src/main/agent-manager/run-agent.ts`
- `src/main/agent-manager/sdk-adapter.ts`
- `src/main/agent-event-mapper.ts`
- `src/main/services/task-terminal-service.ts`
- `src/main/env-utils.ts`
- `src/main/sdk-streaming.ts`

**Tests:**

- `src/main/agent-manager/__tests__/concurrency.test.ts`
- `src/main/agent-manager/__tests__/dependency-helpers.test.ts`
- `src/main/agent-manager/__tests__/dependency-index.test.ts`
- `src/main/agent-manager/__tests__/fast-fail.test.ts`
- `src/main/agent-manager/__tests__/index.test.ts`
- `src/main/agent-manager/__tests__/index-extracted.test.ts`
- `src/main/agent-manager/__tests__/index-methods.test.ts`
- `src/main/agent-manager/__tests__/orphan-recovery.test.ts`
- `src/main/agent-manager/__tests__/prompt-composer.test.ts`
- `src/main/agent-manager/__tests__/run-agent.test.ts`
- `src/main/agent-manager/__tests__/run-agent-playground.test.ts`
- `src/main/agent-manager/__tests__/sdk-adapter.test.ts`
- `src/main/agent-manager/__tests__/sdk-adapter-sdk-path.test.ts`
- `src/main/agent-manager/__tests__/watchdog.test.ts`
- `src/main/agent-manager/__tests__/worktree.test.ts`
- `src/main/agent-manager/__tests__/completion.test.ts`
- `src/main/agent-manager/__tests__/resolve-dependents.test.ts`

### 7.2 Queue API (9 source + 6 test files)

**Source:**

- `src/main/queue-api/index.ts`
- `src/main/queue-api/agent-handlers.ts`
- `src/main/queue-api/event-handlers.ts`
- `src/main/queue-api/field-mapper.ts`
- `src/main/queue-api/server.ts`
- `src/main/queue-api/sse-broadcaster.ts`
- `src/main/queue-api/task-handlers.ts`
- `src/main/queue-api/router.ts`
- `src/main/queue-api/helpers.ts`

**Tests:**

- `src/main/queue-api/__tests__/sse-broadcaster.test.ts`
- `src/main/queue-api/__tests__/field-mapper.test.ts`
- `src/main/queue-api/__tests__/queue-api.test.ts`
- `src/main/__tests__/integration/queue-api-auth.test.ts`
- `src/main/__tests__/integration/queue-api-integration.test.ts`
- `src/main/__tests__/integration/queue-api-sse.test.ts`

### 7.3 Sprint Pipeline (15 source + 14 test files)

**Source:**

- `src/main/handlers/sprint-local.ts`
- `src/main/sprint-pr-poller.ts`
- `src/shared/sanitize-depends-on.ts`
- `src/renderer/src/components/sprint/SprintPipeline.tsx`
- `src/renderer/src/components/sprint/PipelineStage.tsx`
- `src/renderer/src/components/sprint/PipelineBacklog.tsx`
- `src/renderer/src/components/sprint/TaskPill.tsx`
- `src/renderer/src/components/sprint/TaskDetailDrawer.tsx`
- `src/renderer/src/components/sprint/SpecPanel.tsx`
- `src/renderer/src/components/sprint/DoneHistoryPanel.tsx`
- `src/renderer/src/components/sprint/ConflictDrawer.tsx`
- `src/renderer/src/components/sprint/HealthCheckDrawer.tsx`
- `src/renderer/src/components/sprint/TicketEditor.tsx`
- `src/renderer/src/components/sprint/CircuitPipeline.tsx`
- `src/renderer/src/stores/sprintTasks.ts`

**Tests:**

- `src/main/handlers/__tests__/sprint-local.test.ts`
- `src/main/handlers/__tests__/sprint-listeners.test.ts`
- `src/main/__tests__/sprint.test.ts`
- `src/main/__tests__/sprint-pr-poller.test.ts`
- `src/main/__tests__/integration/sprint-ipc.test.ts`
- `src/renderer/src/components/sprint/__tests__/PipelineBacklog.test.tsx`
- `src/renderer/src/components/sprint/__tests__/SpecPanel.test.tsx`
- `src/renderer/src/components/sprint/__tests__/PipelineStage.test.tsx`
- `src/renderer/src/components/sprint/__tests__/DoneHistoryPanel.test.tsx`
- `src/renderer/src/components/sprint/__tests__/SprintPipeline.test.tsx`
- `src/renderer/src/components/sprint/__tests__/TaskDetailDrawer.test.tsx`
- `src/renderer/src/components/sprint/__tests__/TaskPill.test.tsx`
- `src/renderer/src/stores/__tests__/sprintTasks.test.ts`
- `src/renderer/src/stores/__tests__/sprintTasks-map-removal.test.ts`

### 7.4 IDE (13 source + 9 test files)

**Source:**

- `src/renderer/src/views/IDEView.tsx`
- `src/renderer/src/stores/ide.ts`
- `src/main/handlers/ide-fs-handlers.ts`
- `src/renderer/src/components/ide/EditorPane.tsx`
- `src/renderer/src/components/ide/EditorTabBar.tsx`
- `src/renderer/src/components/ide/FileContextMenu.tsx`
- `src/renderer/src/components/ide/FileTree.tsx`
- `src/renderer/src/components/ide/FileTreeNode.tsx`
- `src/renderer/src/components/ide/FileSidebar.tsx`
- `src/renderer/src/components/ide/IDEEmptyState.tsx`
- `src/renderer/src/components/ide/TerminalPanel.tsx`
- `src/renderer/src/components/ide/UnsavedDialog.tsx`
- `src/renderer/src/components/ide/file-tree-constants.ts`

**Tests:**

- `src/renderer/src/components/ide/__tests__/EditorPane.test.tsx`
- `src/renderer/src/components/ide/__tests__/EditorTabBar.test.tsx`
- `src/renderer/src/components/ide/__tests__/FileContextMenu.test.tsx`
- `src/renderer/src/components/ide/__tests__/FileSidebar.test.tsx`
- `src/renderer/src/components/ide/__tests__/FileTree.test.tsx`
- `src/renderer/src/components/ide/__tests__/IDEEmptyState.test.tsx`
- `src/renderer/src/components/ide/__tests__/UnsavedDialog.test.tsx`
- `src/renderer/src/stores/__tests__/ide.test.ts`
- `src/main/__tests__/ide-fs-handlers.test.ts`

### 7.5 PR Station (20 source + 17 test files)

**Source:**

- `src/renderer/src/lib/github-api.ts`
- `src/renderer/src/lib/github-cache.ts`
- `src/renderer/src/stores/pendingReview.ts`
- `src/main/handlers/git-handlers.ts`
- `src/main/pr-poller.ts`
- `src/renderer/src/components/pr-station/PRStationList.tsx`
- `src/renderer/src/components/pr-station/PRStationDetail.tsx`
- `src/renderer/src/components/pr-station/PRStationDiff.tsx`
- `src/renderer/src/components/pr-station/PRStationFilters.tsx`
- `src/renderer/src/components/pr-station/PRStationChecks.tsx`
- `src/renderer/src/components/pr-station/PRStationReviews.tsx`
- `src/renderer/src/components/pr-station/PRStationConversation.tsx`
- `src/renderer/src/components/pr-station/PRStationConflictBanner.tsx`
- `src/renderer/src/components/pr-station/MergeButton.tsx`
- `src/renderer/src/components/pr-station/CloseButton.tsx`
- `src/renderer/src/components/pr-station/ReviewSubmitDialog.tsx`
- `src/renderer/src/components/diff/DiffViewer.tsx`
- `src/renderer/src/components/diff/DiffCommentWidget.tsx`
- `src/renderer/src/components/diff/DiffCommentComposer.tsx`
- `src/renderer/src/components/diff/DiffSizeWarning.tsx`

**Tests:**

- `src/renderer/src/components/pr-station/__tests__/PRStationList.test.tsx`
- `src/renderer/src/components/pr-station/__tests__/PRStationDetail.test.tsx`
- `src/renderer/src/components/pr-station/__tests__/PRStationDiff.test.tsx`
- `src/renderer/src/components/pr-station/__tests__/PRStationFilters.test.tsx`
- `src/renderer/src/components/pr-station/__tests__/PRStationChecks.test.tsx`
- `src/renderer/src/components/pr-station/__tests__/PRStationReviews.test.tsx`
- `src/renderer/src/components/pr-station/__tests__/PRStationConversation.test.tsx`
- `src/renderer/src/components/pr-station/__tests__/PRStationConflictBanner.test.tsx`
- `src/renderer/src/components/pr-station/__tests__/MergeButton.test.tsx`
- `src/renderer/src/components/pr-station/__tests__/ReviewSubmitDialog.test.tsx`
- `src/renderer/src/components/diff/__tests__/DiffViewer.test.tsx`
- `src/renderer/src/components/diff/__tests__/DiffCommentWidget.test.tsx`
- `src/renderer/src/components/diff/__tests__/DiffCommentComposer.test.tsx`
- `src/renderer/src/components/diff/__tests__/DiffSizeWarning.test.tsx`
- `src/renderer/src/lib/__tests__/github-api.test.ts`
- `src/renderer/src/stores/__tests__/pendingReview.test.ts`
- `src/main/handlers/__tests__/git-handlers.test.ts`

### 7.6 Data Layer (10 source + 9 test files)

**Source:**

- `src/main/db.ts`
- `src/main/auth-guard.ts`
- `src/main/data/sprint-queries.ts`
- `src/main/data/sprint-task-repository.ts`
- `src/main/data/agent-queries.ts`
- `src/main/data/cost-queries.ts`
- `src/main/data/event-queries.ts`
- `src/main/data/settings-queries.ts`
- `src/main/data/task-changes.ts`
- `src/main/data/supabase-import.ts`

**Tests:**

- `src/main/__tests__/db.test.ts`
- `src/main/data/__tests__/sprint-queries.test.ts`
- `src/main/data/__tests__/agent-queries.test.ts`
- `src/main/data/__tests__/cost-queries.test.ts`
- `src/main/data/__tests__/event-queries.test.ts`
- `src/main/data/__tests__/settings-queries.test.ts`
- `src/main/data/__tests__/task-changes.test.ts`
- `src/main/data/__tests__/migration-v15.test.ts`
- `src/main/handlers/__tests__/auth-handlers.test.ts`

## 8. Success Criteria

1. All 18 audit reports written with structured findings
2. Synthesis doc produced with deduplicated, prioritized findings
3. Sprint tasks created and queued via `sprint:create` IPC
4. Dependencies wired: critical → medium → low per feature
5. Agent pipeline begins executing remediation tasks automatically
6. All remediation tasks include concrete fix approaches and test expectations

## 9. Risk Mitigation

- **Agent rate limits:** Batches of 6 with wait between batches
- **Stale findings:** Agents cross-reference existing March 28 audit to avoid duplicate work
- **Scope creep:** Agents have explicit "ignore" lists per persona
- **Task quality:** Task specs include exact file paths, code snippets, and test expectations (not vague descriptions)
- **Dependency conflicts:** Soft deps only — Medium/Low tasks proceed even if higher-severity task fails
