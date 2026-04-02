# BDE Production Readiness Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit BDE's 6 highest-risk features through 3 specialized personas, synthesize findings, and queue remediation tasks for automated execution.

**Architecture:** 20 agents total — 18 audit agents (3 batches of 6), 1 synthesis agent, 1 task creation agent. Each audit agent reads feature-scoped files through a persona-specific lens and writes a structured findings doc. Synthesis deduplicates and prioritizes. Task creation agent queues remediation work via Queue API.

**Tech Stack:** Claude Code Agent tool (subagent dispatch), BDE Queue API (localhost:18790), git

**Spec:** `docs/superpowers/specs/2026-03-29-prod-readiness-audit-design.md`

---

## Pre-Flight

- [ ] **Step 1: Create output directory**

```bash
mkdir -p docs/superpowers/audits/prod-audit
```

- [ ] **Step 2: Verify Queue API is running**

```bash
curl -s http://localhost:18790/queue/tasks?status=queued | head -5
```

If this fails, BDE must be running for Phase 3.

- [ ] **Step 3: Commit the output directory**

```bash
git add docs/superpowers/audits/prod-audit/.gitkeep
git commit -m "chore: create prod-audit output directory"
```

---

## Task 1: Batch 1 — Agent Manager + Queue API (6 agents)

Dispatch 6 agents in parallel. Each agent uses `isolation: "worktree"` and `subagent_type: "general-purpose"`.

**Files:**
- Create: `docs/superpowers/audits/prod-audit/agent-manager-red.md`
- Create: `docs/superpowers/audits/prod-audit/agent-manager-reliability.md`
- Create: `docs/superpowers/audits/prod-audit/agent-manager-ux.md`
- Create: `docs/superpowers/audits/prod-audit/queue-api-red.md`
- Create: `docs/superpowers/audits/prod-audit/queue-api-reliability.md`
- Create: `docs/superpowers/audits/prod-audit/queue-api-ux.md`

- [ ] **Step 1: Dispatch all 6 agents in a single message**

Use the Agent tool 6 times in one message. All agents run in background with `isolation: "worktree"`.

Each agent prompt follows this template (fill in {FEATURE}, {PERSONA}, {INSTRUCTIONS}, {FILE_LIST}):

```
You are a {PERSONA} auditing the {FEATURE} feature of BDE, an Electron desktop app.

## Your Task

Read every file in scope. Produce a structured findings report. Write it to:
docs/superpowers/audits/prod-audit/{feature}-{persona}.md

## Cross-Reference

Read docs/superpowers/audits/synthesis-final-report.md first. For each finding from the March 28 audit that touches your feature:
- If it's been fixed, note it in "Previously Reported — Now Fixed" with the evidence
- If it's still present, note it in "Previously Reported — Still Open"
- Your new findings go in the "Findings" section

## Persona Instructions

{INSTRUCTIONS from spec Section 3.4}

## Files in Scope

{FILE_LIST from spec Section 7.x}

Read EVERY file listed above. Do not skip files. For test files, check what IS tested and what ISN'T — coverage gaps are findings.

## Output Format

Use this exact template:

# {Feature} — {Persona} Audit

**Date:** 2026-03-29
**Scope:** {N} files in {feature}
**Persona:** {persona name}

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
|----------|-------|
| Critical | N |
| High | N |
| Medium | N |
| Low | N |

**Total findings:** N
**Previously reported (fixed):** N
**Previously reported (still open):** N
**New findings:** N

## Finding ID Prefixes

Use these prefixes for finding IDs:
- Agent Manager Red Team: AM-RED-{N}
- Agent Manager Reliability: AM-REL-{N}
- Agent Manager UX: AM-UX-{N}
- Queue API Red Team: QA-RED-{N}
- Queue API Reliability: QA-REL-{N}
- Queue API UX: QA-UX-{N}

## Quality Bar

- Every finding must have a specific file path and line number
- Every recommendation must name the function/pattern to use
- "Add validation" is not a recommendation. "Add zod schema validation in parseTaskInput() at helpers.ts:45" is.
- If you find nothing at a severity level, say "None found" — don't force findings
```

**Agent Manager — Source files for prompt:**
```
src/main/agent-manager/index.ts
src/main/agent-manager/types.ts
src/main/agent-manager/concurrency.ts
src/main/agent-manager/dependency-helpers.ts
src/main/agent-manager/dependency-index.ts
src/main/agent-manager/fast-fail.ts
src/main/agent-manager/watchdog.ts
src/main/agent-manager/worktree.ts
src/main/agent-manager/resolve-dependents.ts
src/main/agent-manager/completion.ts
src/main/agent-manager/orphan-recovery.ts
src/main/agent-manager/prompt-composer.ts
src/main/agent-manager/run-agent.ts
src/main/agent-manager/sdk-adapter.ts
src/main/agent-event-mapper.ts
src/main/services/task-terminal-service.ts
src/main/env-utils.ts
src/main/sdk-streaming.ts
```

**Agent Manager — Test files:**
```
src/main/agent-manager/__tests__/concurrency.test.ts
src/main/agent-manager/__tests__/dependency-helpers.test.ts
src/main/agent-manager/__tests__/dependency-index.test.ts
src/main/agent-manager/__tests__/fast-fail.test.ts
src/main/agent-manager/__tests__/index.test.ts
src/main/agent-manager/__tests__/index-extracted.test.ts
src/main/agent-manager/__tests__/index-methods.test.ts
src/main/agent-manager/__tests__/orphan-recovery.test.ts
src/main/agent-manager/__tests__/prompt-composer.test.ts
src/main/agent-manager/__tests__/run-agent.test.ts
src/main/agent-manager/__tests__/run-agent-playground.test.ts
src/main/agent-manager/__tests__/sdk-adapter.test.ts
src/main/agent-manager/__tests__/sdk-adapter-sdk-path.test.ts
src/main/agent-manager/__tests__/watchdog.test.ts
src/main/agent-manager/__tests__/worktree.test.ts
src/main/agent-manager/__tests__/completion.test.ts
src/main/agent-manager/__tests__/resolve-dependents.test.ts
```

**Queue API — Source files for prompt:**
```
src/main/queue-api/index.ts
src/main/queue-api/agent-handlers.ts
src/main/queue-api/event-handlers.ts
src/main/queue-api/field-mapper.ts
src/main/queue-api/server.ts
src/main/queue-api/sse-broadcaster.ts
src/main/queue-api/task-handlers.ts
src/main/queue-api/router.ts
src/main/queue-api/helpers.ts
```

**Queue API — Test files:**
```
src/main/queue-api/__tests__/sse-broadcaster.test.ts
src/main/queue-api/__tests__/field-mapper.test.ts
src/main/queue-api/__tests__/queue-api.test.ts
src/main/__tests__/integration/queue-api-auth.test.ts
src/main/__tests__/integration/queue-api-integration.test.ts
src/main/__tests__/integration/queue-api-sse.test.ts
```

- [ ] **Step 2: Wait for all 6 agents to complete**

Do not proceed to Task 2 until all 6 agents have returned their results.

- [ ] **Step 3: Verify all 6 output files exist**

```bash
ls -la docs/superpowers/audits/prod-audit/agent-manager-*.md docs/superpowers/audits/prod-audit/queue-api-*.md
```

Expected: 6 files.

- [ ] **Step 4: Commit Batch 1 results**

```bash
git add docs/superpowers/audits/prod-audit/agent-manager-*.md docs/superpowers/audits/prod-audit/queue-api-*.md
git commit -m "audit: batch 1 — Agent Manager + Queue API (6 reports)"
```

---

## Task 2: Batch 2 — Sprint Pipeline + IDE (6 agents)

Same dispatch pattern as Task 1.

**Files:**
- Create: `docs/superpowers/audits/prod-audit/sprint-pipeline-red.md`
- Create: `docs/superpowers/audits/prod-audit/sprint-pipeline-reliability.md`
- Create: `docs/superpowers/audits/prod-audit/sprint-pipeline-ux.md`
- Create: `docs/superpowers/audits/prod-audit/ide-red.md`
- Create: `docs/superpowers/audits/prod-audit/ide-reliability.md`
- Create: `docs/superpowers/audits/prod-audit/ide-ux.md`

- [ ] **Step 1: Dispatch all 6 agents in a single message**

Use same prompt template from Task 1. Fill in:

**Finding ID prefixes:**
- Sprint Pipeline Red Team: SP-RED-{N}
- Sprint Pipeline Reliability: SP-REL-{N}
- Sprint Pipeline UX: SP-UX-{N}
- IDE Red Team: IDE-RED-{N}
- IDE Reliability: IDE-REL-{N}
- IDE UX: IDE-UX-{N}

**Sprint Pipeline — Source files:**
```
src/main/handlers/sprint-local.ts
src/main/sprint-pr-poller.ts
src/shared/sanitize-depends-on.ts
src/renderer/src/components/sprint/SprintPipeline.tsx
src/renderer/src/components/sprint/PipelineStage.tsx
src/renderer/src/components/sprint/PipelineBacklog.tsx
src/renderer/src/components/sprint/TaskPill.tsx
src/renderer/src/components/sprint/TaskDetailDrawer.tsx
src/renderer/src/components/sprint/SpecPanel.tsx
src/renderer/src/components/sprint/DoneHistoryPanel.tsx
src/renderer/src/components/sprint/ConflictDrawer.tsx
src/renderer/src/components/sprint/HealthCheckDrawer.tsx
src/renderer/src/components/sprint/TicketEditor.tsx
src/renderer/src/components/sprint/CircuitPipeline.tsx
src/renderer/src/stores/sprintTasks.ts
```

**Sprint Pipeline — Test files:**
```
src/main/handlers/__tests__/sprint-local.test.ts
src/main/handlers/__tests__/sprint-listeners.test.ts
src/main/__tests__/sprint.test.ts
src/main/__tests__/sprint-pr-poller.test.ts
src/main/__tests__/integration/sprint-ipc.test.ts
src/renderer/src/components/sprint/__tests__/PipelineBacklog.test.tsx
src/renderer/src/components/sprint/__tests__/SpecPanel.test.tsx
src/renderer/src/components/sprint/__tests__/PipelineStage.test.tsx
src/renderer/src/components/sprint/__tests__/DoneHistoryPanel.test.tsx
src/renderer/src/components/sprint/__tests__/SprintPipeline.test.tsx
src/renderer/src/components/sprint/__tests__/TaskDetailDrawer.test.tsx
src/renderer/src/components/sprint/__tests__/TaskPill.test.tsx
src/renderer/src/stores/__tests__/sprintTasks.test.ts
src/renderer/src/stores/__tests__/sprintTasks-map-removal.test.ts
```

**IDE — Source files:**
```
src/renderer/src/views/IDEView.tsx
src/renderer/src/stores/ide.ts
src/main/handlers/ide-fs-handlers.ts
src/renderer/src/components/ide/EditorPane.tsx
src/renderer/src/components/ide/EditorTabBar.tsx
src/renderer/src/components/ide/FileContextMenu.tsx
src/renderer/src/components/ide/FileTree.tsx
src/renderer/src/components/ide/FileTreeNode.tsx
src/renderer/src/components/ide/FileSidebar.tsx
src/renderer/src/components/ide/IDEEmptyState.tsx
src/renderer/src/components/ide/TerminalPanel.tsx
src/renderer/src/components/ide/UnsavedDialog.tsx
src/renderer/src/components/ide/file-tree-constants.ts
```

**IDE — Test files:**
```
src/renderer/src/components/ide/__tests__/EditorPane.test.tsx
src/renderer/src/components/ide/__tests__/EditorTabBar.test.tsx
src/renderer/src/components/ide/__tests__/FileContextMenu.test.tsx
src/renderer/src/components/ide/__tests__/FileSidebar.test.tsx
src/renderer/src/components/ide/__tests__/FileTree.test.tsx
src/renderer/src/components/ide/__tests__/IDEEmptyState.test.tsx
src/renderer/src/components/ide/__tests__/UnsavedDialog.test.tsx
src/renderer/src/stores/__tests__/ide.test.ts
src/main/__tests__/ide-fs-handlers.test.ts
```

- [ ] **Step 2: Wait for all 6 agents to complete**

- [ ] **Step 3: Verify all 6 output files exist**

```bash
ls -la docs/superpowers/audits/prod-audit/sprint-pipeline-*.md docs/superpowers/audits/prod-audit/ide-*.md
```

- [ ] **Step 4: Commit Batch 2 results**

```bash
git add docs/superpowers/audits/prod-audit/sprint-pipeline-*.md docs/superpowers/audits/prod-audit/ide-*.md
git commit -m "audit: batch 2 — Sprint Pipeline + IDE (6 reports)"
```

---

## Task 3: Batch 3 — PR Station + Data Layer (6 agents)

Same dispatch pattern as Task 1.

**Files:**
- Create: `docs/superpowers/audits/prod-audit/pr-station-red.md`
- Create: `docs/superpowers/audits/prod-audit/pr-station-reliability.md`
- Create: `docs/superpowers/audits/prod-audit/pr-station-ux.md`
- Create: `docs/superpowers/audits/prod-audit/data-layer-red.md`
- Create: `docs/superpowers/audits/prod-audit/data-layer-reliability.md`
- Create: `docs/superpowers/audits/prod-audit/data-layer-ux.md`

- [ ] **Step 1: Dispatch all 6 agents in a single message**

**Finding ID prefixes:**
- PR Station Red Team: PR-RED-{N}
- PR Station Reliability: PR-REL-{N}
- PR Station UX: PR-UX-{N}
- Data Layer Red Team: DL-RED-{N}
- Data Layer Reliability: DL-REL-{N}
- Data Layer UX: DL-UX-{N}

**PR Station — Source files:**
```
src/renderer/src/lib/github-api.ts
src/renderer/src/lib/github-cache.ts
src/renderer/src/stores/pendingReview.ts
src/main/handlers/git-handlers.ts
src/main/pr-poller.ts
src/renderer/src/components/pr-station/PRStationList.tsx
src/renderer/src/components/pr-station/PRStationDetail.tsx
src/renderer/src/components/pr-station/PRStationDiff.tsx
src/renderer/src/components/pr-station/PRStationFilters.tsx
src/renderer/src/components/pr-station/PRStationChecks.tsx
src/renderer/src/components/pr-station/PRStationReviews.tsx
src/renderer/src/components/pr-station/PRStationConversation.tsx
src/renderer/src/components/pr-station/PRStationConflictBanner.tsx
src/renderer/src/components/pr-station/MergeButton.tsx
src/renderer/src/components/pr-station/CloseButton.tsx
src/renderer/src/components/pr-station/ReviewSubmitDialog.tsx
src/renderer/src/components/diff/DiffViewer.tsx
src/renderer/src/components/diff/DiffCommentWidget.tsx
src/renderer/src/components/diff/DiffCommentComposer.tsx
src/renderer/src/components/diff/DiffSizeWarning.tsx
```

**PR Station — Test files:**
```
src/renderer/src/components/pr-station/__tests__/PRStationList.test.tsx
src/renderer/src/components/pr-station/__tests__/PRStationDetail.test.tsx
src/renderer/src/components/pr-station/__tests__/PRStationDiff.test.tsx
src/renderer/src/components/pr-station/__tests__/PRStationFilters.test.tsx
src/renderer/src/components/pr-station/__tests__/PRStationChecks.test.tsx
src/renderer/src/components/pr-station/__tests__/PRStationReviews.test.tsx
src/renderer/src/components/pr-station/__tests__/PRStationConversation.test.tsx
src/renderer/src/components/pr-station/__tests__/PRStationConflictBanner.test.tsx
src/renderer/src/components/pr-station/__tests__/MergeButton.test.tsx
src/renderer/src/components/pr-station/__tests__/ReviewSubmitDialog.test.tsx
src/renderer/src/components/diff/__tests__/DiffViewer.test.tsx
src/renderer/src/components/diff/__tests__/DiffCommentWidget.test.tsx
src/renderer/src/components/diff/__tests__/DiffCommentComposer.test.tsx
src/renderer/src/components/diff/__tests__/DiffSizeWarning.test.tsx
src/renderer/src/lib/__tests__/github-api.test.ts
src/renderer/src/stores/__tests__/pendingReview.test.ts
src/main/handlers/__tests__/git-handlers.test.ts
```

**Data Layer — Source files:**
```
src/main/db.ts
src/main/auth-guard.ts
src/main/data/sprint-queries.ts
src/main/data/sprint-task-repository.ts
src/main/data/agent-queries.ts
src/main/data/cost-queries.ts
src/main/data/event-queries.ts
src/main/data/settings-queries.ts
src/main/data/task-changes.ts
src/main/data/supabase-import.ts
```

**Data Layer — Test files:**
```
src/main/__tests__/db.test.ts
src/main/data/__tests__/sprint-queries.test.ts
src/main/data/__tests__/agent-queries.test.ts
src/main/data/__tests__/cost-queries.test.ts
src/main/data/__tests__/event-queries.test.ts
src/main/data/__tests__/settings-queries.test.ts
src/main/data/__tests__/task-changes.test.ts
src/main/data/__tests__/migration-v15.test.ts
src/main/handlers/__tests__/auth-handlers.test.ts
```

- [ ] **Step 2: Wait for all 6 agents to complete**

- [ ] **Step 3: Verify all 6 output files exist**

```bash
ls -la docs/superpowers/audits/prod-audit/pr-station-*.md docs/superpowers/audits/prod-audit/data-layer-*.md
```

- [ ] **Step 4: Commit Batch 3 results**

```bash
git add docs/superpowers/audits/prod-audit/pr-station-*.md docs/superpowers/audits/prod-audit/data-layer-*.md
git commit -m "audit: batch 3 — PR Station + Data Layer (6 reports)"
```

---

## Task 4: Synthesis (1 agent)

**Files:**
- Create: `docs/superpowers/audits/prod-audit/synthesis.md`

- [ ] **Step 1: Dispatch synthesis agent**

```
You are a technical lead synthesizing 18 production readiness audit reports for BDE, an Electron desktop app.

## Your Task

Read all 18 audit reports in docs/superpowers/audits/prod-audit/ and produce a unified synthesis document. Write it to:
docs/superpowers/audits/prod-audit/synthesis.md

## Process

1. Read ALL 18 reports:
   - agent-manager-red.md, agent-manager-reliability.md, agent-manager-ux.md
   - queue-api-red.md, queue-api-reliability.md, queue-api-ux.md
   - sprint-pipeline-red.md, sprint-pipeline-reliability.md, sprint-pipeline-ux.md
   - ide-red.md, ide-reliability.md, ide-ux.md
   - pr-station-red.md, pr-station-reliability.md, pr-station-ux.md
   - data-layer-red.md, data-layer-reliability.md, data-layer-ux.md

2. Also read the previous audit: docs/superpowers/audits/synthesis-final-report.md

3. Deduplicate: If multiple reports flag the same issue (same file + same problem), merge into ONE entry citing all sources. This includes across features — sprint-queries.ts appears in both Sprint Pipeline and Data Layer scopes.

4. Cross-reference against March 28 audit: What's fixed? What's still open? What's new?

5. Prioritize using severity × effort:
   - Critical + S effort = fix immediately
   - Critical + L effort = plan carefully
   - Low + L effort = deprioritize or skip

6. Group findings into the Remediation Task Map (feature × severity bucket). Each row becomes a sprint task.

## Output Format

# Production Readiness Audit — Synthesis

**Date:** 2026-03-29
**Sources:** 18 audit reports (6 features × 3 personas)

## Executive Summary
{2-3 paragraph overview: how many findings total, severity breakdown, biggest risks, comparison to March 28 audit}

## Delta from March 28 Audit
### Fixed Since Last Audit
- {ID}: {description} — fixed in {evidence}
### Still Open from Last Audit
- {ID}: {description} — still at {file:line}
### New Findings
- {count} new findings across {features}

## Findings by Feature × Severity

### Agent Manager
#### Critical/High
| ID | Title | Severity | Effort | Sources | File(s) |
|---|---|---|---|---|---|
| {merged ID} | {title} | {sev} | {effort} | AM-RED-1, AM-REL-3 | {files} |

#### Medium
| ID | Title | Severity | Effort | Sources | File(s) |

#### Low
| ID | Title | Severity | Effort | Sources | File(s) |

{Repeat for: Queue API, Sprint Pipeline, IDE, PR Station, Data Layer}

## Remediation Task Map

This table maps directly to sprint tasks. One row = one task.

| Task Name | Feature | Severity Bucket | Finding IDs | Est. Effort | Depends On |
|-----------|---------|----------------|-------------|-------------|------------|
| audit-agent-manager-critical | Agent Manager | Critical/High | AM-RED-1, AM-REL-3 | M | none |
| audit-agent-manager-medium | Agent Manager | Medium | AM-UX-2, AM-REL-5 | S | audit-agent-manager-critical |
| audit-agent-manager-low | Agent Manager | Low | AM-UX-4 | S | audit-agent-manager-medium |
| ... | ... | ... | ... | ... | ... |

IMPORTANT: Only create rows where findings exist. If a feature has no Critical/High findings, omit that row.

## Quality Bar

- Every finding in the Remediation Task Map must trace back to a specific finding ID from the audit reports
- The "Depends On" column uses soft dependencies — task names, not IDs (IDs assigned at creation time)
- Est. Effort is the SUM of individual finding efforts in that bucket
```

- [ ] **Step 2: Wait for synthesis agent to complete**

- [ ] **Step 3: Verify synthesis output**

```bash
wc -l docs/superpowers/audits/prod-audit/synthesis.md
```

Should be substantial (200+ lines). Quick-check that it has the Remediation Task Map table.

```bash
grep -c "audit-" docs/superpowers/audits/prod-audit/synthesis.md
```

Should show multiple task name references.

- [ ] **Step 4: Commit synthesis**

```bash
git add docs/superpowers/audits/prod-audit/synthesis.md
git commit -m "audit: synthesis — deduplicated findings + remediation task map"
```

---

## Task 5: Create & Queue Remediation Tasks (1 agent or manual)

**Files:**
- Read: `docs/superpowers/audits/prod-audit/synthesis.md`

- [ ] **Step 1: Read the synthesis Remediation Task Map**

Parse the table to determine how many tasks to create and their dependencies.

- [ ] **Step 2: For each row in the Remediation Task Map, create a sprint task**

For each task, use the Queue API:

```bash
BDE_API_KEY=$(sqlite3 ~/.bde/bde.db "SELECT value FROM settings WHERE key='taskRunner.apiKey'" 2>/dev/null)

curl -s -X POST http://localhost:18790/queue/tasks \
  -H "Authorization: Bearer $BDE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "audit-{feature}-{severity}: Fix {severity} {feature} issues",
    "status": "queued",
    "priority": "{critical=1, medium=2, low=3}",
    "spec": "## Overview\nFix {severity} issues in {feature} identified by production readiness audit.\n\n## Findings to Address\n\n### {ID}: {Title}\n- **File(s):** {paths}\n- **Problem:** {description}\n- **Fix:** {recommendation}\n- **Test:** {what to test}\n\n## Acceptance Criteria\n- [ ] All listed findings addressed\n- [ ] Existing tests pass (npm test + npm run test:main)\n- [ ] New tests written for each fix\n- [ ] npm run typecheck passes\n- [ ] No new lint warnings\n\n## Files in Scope\n{file list from findings}"
  }'
```

Repeat for each row. Collect the returned task IDs.

- [ ] **Step 3: Wire dependencies**

For each medium-severity task, add a soft dependency on the critical/high task for the same feature:

```bash
curl -s -X PATCH "http://localhost:18790/queue/tasks/{MEDIUM_TASK_ID}/dependencies" \
  -H "Authorization: Bearer $BDE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "depends_on": [{"id": "{CRITICAL_TASK_ID}", "type": "soft"}]
  }'
```

For each low-severity task, add a soft dependency on the medium task for the same feature.

- [ ] **Step 4: Verify all tasks are queued**

```bash
curl -s "http://localhost:18790/queue/tasks?status=queued" \
  -H "Authorization: Bearer $BDE_API_KEY" | python3 -c "
import sys, json
tasks = json.load(sys.stdin)
print(f'Queued tasks: {len(tasks)}')
for t in tasks:
    print(f'  {t[\"id\"][:8]}  {t[\"title\"]}  deps={t.get(\"depends_on\", [])}')
"
```

- [ ] **Step 5: Commit all audit artifacts**

```bash
git add docs/superpowers/audits/prod-audit/
git commit -m "audit: complete — 18 reports + synthesis + remediation tasks queued"
```

---

## Post-Audit Verification

- [ ] **Step 1: Count total findings**

```bash
grep -c "^### " docs/superpowers/audits/prod-audit/agent-manager-*.md docs/superpowers/audits/prod-audit/queue-api-*.md docs/superpowers/audits/prod-audit/sprint-pipeline-*.md docs/superpowers/audits/prod-audit/ide-*.md docs/superpowers/audits/prod-audit/pr-station-*.md docs/superpowers/audits/prod-audit/data-layer-*.md
```

- [ ] **Step 2: Verify agent pipeline is picking up tasks**

```bash
curl -s "http://localhost:18790/queue/tasks?status=active" \
  -H "Authorization: Bearer $BDE_API_KEY" | python3 -c "
import sys, json
tasks = json.load(sys.stdin)
print(f'Active tasks: {len(tasks)}')
for t in tasks:
    print(f'  {t[\"title\"]}')
"
```

If BDE's agent manager is running, tasks should start getting claimed within 60 seconds.
