# Three-Layer Regression Testing Strategy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a 3-layer defense (unit, integration, E2E) for regression testing, pass the 68% CI coverage gate, and fix all broken/stale tests.

**Architecture:** Four phases executed sequentially. Phase 0 fixes broken tests (immediate CI relief). Phase 1 closes unit test gaps in the lowest-coverage areas to pass the 68% gate. Phase 2 adds integration tests at process boundaries (IPC, agent pipeline, Queue API, DB). Phase 3 overhauls the E2E suite with correct mappings and critical user journeys.

**Tech Stack:** Vitest (unit/integration), Playwright + electron-playwright-helpers (E2E), v8 coverage provider, jsdom (renderer), Node.js (main process)

**Current Coverage (as of e59fe9c):** 65.07% stmts / 67.00% lines / 61.96% funcs / 58.79% branches
**CI Gate:** 68% stmts / 68% lines / 65% funcs / 60% branches — ALL FAILING
**Test Counts:** 1627 renderer tests (127 files, 2 failing), main process tests (55 files, 5 failing — 13 individual failures)

---

## File Structure

### Phase 0 — Fix Broken Tests (modify existing files)

```
src/main/handlers/__tests__/sprint-local.test.ts     # Fix BDE_AGENTS_INDEX mock (3 readLog failures)
src/main/handlers/__tests__/workbench.test.ts         # Fix child_process mock (2 failures)
src/main/agent-manager/__tests__/resolve-dependents.test.ts  # Fix 3 dependency resolution failures
src/main/data/__tests__/sprint-queries.test.ts        # Fix 4 field mismatch failures
src/renderer/src/components/agents/__tests__/ChatRenderer.test.tsx  # Fix playground event pairing test
src/renderer/src/components/agents/__tests__/PlaygroundIntegration.test.tsx  # Fix integration test
e2e/navigation.spec.ts                                # Update shortcut mapping Cmd+1-9
e2e/sessions.spec.ts -> e2e/agents.spec.ts            # Rename + fix selectors
e2e/command-palette.spec.ts                            # Fix .sessions-chat reference
e2e/spawn-agent.spec.ts                                # Merge into agents.spec.ts
```

### Phase 1 — Unit Test Gaps (new + modify test files)

```
src/renderer/src/components/terminal/__tests__/
  AgentOutputTab.test.tsx                              # NEW
  FindBar.test.tsx                                     # NEW
  TerminalPane.test.tsx                                # NEW
  ShellPicker.test.tsx                                 # NEW

src/renderer/src/components/ide/__tests__/
  FileSidebar.test.tsx                                 # NEW
  FileContextMenu.test.tsx                             # NEW
  UnsavedDialog.test.tsx                               # NEW
  IDEEmptyState.test.tsx                               # NEW

src/renderer/src/components/task-workbench/__tests__/
  WorkbenchForm.test.tsx                               # NEW
  WorkbenchCopilot.test.tsx                            # NEW
  WorkbenchActions.test.tsx                            # NEW

src/renderer/src/components/agents/__tests__/
  SteerInput.test.tsx                                  # NEW
  ThinkingBlock.test.tsx                               # NEW
  ChatBubble.test.tsx                                  # NEW
  ToolCallBlock.test.tsx                               # NEW

src/renderer/src/components/panels/__tests__/
  PanelDropOverlay.test.tsx                            # EXTEND existing

src/renderer/src/components/settings/__tests__/
  AppearanceSection.test.tsx                           # EXTEND existing

src/renderer/src/components/dashboard/__tests__/
  ActiveTasksCard.test.tsx                             # NEW
  RecentCompletionsCard.test.tsx                       # NEW

src/renderer/src/components/git-tree/__tests__/
  FileTreeSection.test.tsx                             # EXTEND existing

```

### Phase 2 — Integration Tests (new files)

```
src/main/__tests__/integration/
  ipc-registration.test.ts                             # NEW - channel completeness
  sprint-ipc.test.ts                                   # NEW - sprint CRUD via handlers
  agent-completion-pipeline.test.ts                    # NEW - complete -> push -> PR -> done
  queue-api-auth.test.ts                               # NEW - ?token= path
  queue-api-sse.test.ts                                # NEW - event delivery
  ide-path-traversal.test.ts                           # NEW - security: ../../ rejection
  db-crud.test.ts                                      # NEW - real SQLite CRUD cycle
```

### Phase 3 — E2E Overhaul (new + modify spec files)

```
e2e/
  helpers/
    seed-data.ts                                       # NEW - test task seeding
    mock-git-repo.ts                                   # NEW - temp git repo
  dashboard.spec.ts                                    # NEW
  ide.spec.ts                                          # NEW
  source-control.spec.ts                               # NEW
  agents.spec.ts                                       # REWRITTEN (from sessions.spec.ts)
  navigation.spec.ts                                   # REWRITTEN
  sprint.spec.ts                                       # EXTEND
  pr-station.spec.ts                                   # EXTEND
  settings.spec.ts                                     # EXTEND
  cost.spec.ts                                         # EXTEND
```

---

## Phase 0: Fix Broken Tests

> Priority: CRITICAL. These must be fixed before any other work — broken tests erode trust in the suite and block CI.

### Task 1: Fix sprint-local.test.ts — Missing BDE_AGENTS_INDEX Mock

**Files:**

- Modify: `src/main/handlers/__tests__/sprint-local.test.ts` (line ~57)

- [ ] **Step 1: Read the current paths mock to understand the shape**

Run: `grep -n 'vi.mock.*paths' src/main/handlers/__tests__/sprint-local.test.ts`
Read surrounding context to see what exports are mocked.

- [ ] **Step 2: Add the missing BDE_AGENTS_INDEX export**

In `sprint-local.test.ts`, find the `vi.mock('../../paths', ...)` block (around line 57-60) and add `BDE_AGENTS_INDEX`:

```typescript
vi.mock('../../paths', () => ({
  getSpecsRoot: vi.fn().mockReturnValue('/tmp/specs'),
  BDE_AGENTS_INDEX: '/tmp/agents-index.json'
}))
```

- [ ] **Step 3: Run the previously failing tests**

Run: `npm run test:main -- --reporter=verbose src/main/handlers/__tests__/sprint-local.test.ts 2>&1 | tail -30`
Expected: All tests PASS (the 4 that were failing due to missing mock export)

- [ ] **Step 4: Commit**

```bash
git add src/main/handlers/__tests__/sprint-local.test.ts
git commit -m "fix(tests): add missing BDE_AGENTS_INDEX to paths mock in sprint-local tests"
```

---

### Task 2: Fix workbench.test.ts — child_process Mock

**Files:**

- Modify: `src/main/handlers/__tests__/workbench.test.ts` (lines ~24-56)

- [ ] **Step 1: Read the current test file and the workbench handler to understand the spawn flow**

Read: `src/main/handlers/__tests__/workbench.test.ts`
Read: `src/main/handlers/workbench.ts` (specifically `runClaudePrint()` helper)

Understand how `runClaudePrint()` uses `spawn` (not `execFile`) to pipe prompts via stdin.

- [ ] **Step 2: Fix the child_process mock to handle spawn-based flow**

The current mock uses `execFile` callback pattern, but the handler uses `spawn` with stdin piping. Update the mock to properly simulate the spawn interface:

```typescript
vi.mock('child_process', () => {
  const { EventEmitter } = require('events')
  const { Readable, Writable } = require('stream')

  return {
    spawn: vi.fn(() => {
      const proc = new EventEmitter()
      proc.stdout = new Readable({
        read() {
          this.push('{"result":"ok"}')
          this.push(null)
        }
      })
      proc.stderr = new Readable({
        read() {
          this.push(null)
        }
      })
      proc.stdin = new Writable({
        write(_chunk: any, _enc: any, cb: any) {
          cb()
        }
      })
      proc.pid = 12345
      setTimeout(() => proc.emit('close', 0), 10)
      return proc
    }),
    execFile: vi.fn(),
    execFileSync: vi.fn()
  }
})
```

Adjust the mock output to match what the handler expects (read the handler to determine exact output format).

- [ ] **Step 3: Run the previously failing tests**

Run: `npm run test:main -- --reporter=verbose src/main/handlers/__tests__/workbench.test.ts 2>&1 | tail -30`
Expected: All tests PASS

- [ ] **Step 4: Run the full main test suite to verify no regressions**

Run: `npm run test:main 2>&1 | tail -10`
Expected: All main tests PASS (0 failures)

- [ ] **Step 5: Commit**

```bash
git add src/main/handlers/__tests__/workbench.test.ts
git commit -m "fix(tests): update child_process mock to handle spawn-based flow in workbench tests"
```

---

### Task 2b: Fix Remaining Main Process Test Failures

**Files:**

- Modify: `src/main/agent-manager/__tests__/resolve-dependents.test.ts` (3 failures)
- Modify: `src/main/data/__tests__/sprint-queries.test.ts` (4 failures)

These tests were already failing before the recent merges. The resolve-dependents tests fail on dependency resolution logic, and sprint-queries tests fail on field shape mismatches (likely `depends_on` field handling).

- [ ] **Step 1: Read failing tests and identify root causes**

Run: `npm run test:main -- --reporter=verbose src/main/agent-manager/__tests__/resolve-dependents.test.ts 2>&1 | tail -40`
Run: `npm run test:main -- --reporter=verbose src/main/data/__tests__/sprint-queries.test.ts 2>&1 | tail -40`

Read the error messages to understand what expectations are failing and why.

- [ ] **Step 2: Fix resolve-dependents.test.ts**

The 3 failures are: "keeps dependent blocked when hard dep fails", "keeps dependent blocked when hard dep is cancelled", "fan-in: does not unblock when only some deps are satisfied". Read the test expectations and the source at `src/main/agent-manager/resolve-dependents.ts` to understand if the tests or the implementation changed.

- [ ] **Step 3: Fix sprint-queries.test.ts**

The 4 failures are: getTask, updateTask, claimTask, releaseTask. Read the mock setup and compare against the actual query function signatures — likely the return shape changed (e.g., `depends_on` added to select results).

- [ ] **Step 4: Run full main test suite**

Run: `npm run test:main 2>&1 | tail -10`
Expected: 0 failures

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/__tests__/resolve-dependents.test.ts \
        src/main/data/__tests__/sprint-queries.test.ts
git commit -m "fix(tests): fix resolve-dependents and sprint-queries test failures"
```

---

### Task 2c: Fix Renderer Test Failures — ChatRenderer + PlaygroundIntegration

**Files:**

- Modify: `src/renderer/src/components/agents/__tests__/ChatRenderer.test.tsx`
- Modify: `src/renderer/src/components/agents/__tests__/PlaygroundIntegration.test.tsx`

These 2 test files (7 test failures total) were introduced in recent merges (#376-#378) and have failing assertions.

- [ ] **Step 1: Read failing tests and identify root causes**

Run: `npm test -- --reporter=verbose src/renderer/src/components/agents/__tests__/ChatRenderer.test.tsx 2>&1 | tail -30`
Run: `npm test -- --reporter=verbose src/renderer/src/components/agents/__tests__/PlaygroundIntegration.test.tsx 2>&1 | tail -30`

- [ ] **Step 2: Fix ChatRenderer test**

The new playground event pairing test likely expects `pairEvents()` to filter playground events, but the implementation may not match. Read both the test and `ChatRenderer.tsx` pairEvents function.

- [ ] **Step 3: Fix PlaygroundIntegration test**

Read the test and the components it exercises. Fix mock setup or assertions to match current implementation.

- [ ] **Step 4: Run renderer tests**

Run: `npm test 2>&1 | tail -10`
Expected: 0 failures, all 1627+ tests pass

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/agents/__tests__/ChatRenderer.test.tsx \
        src/renderer/src/components/agents/__tests__/PlaygroundIntegration.test.tsx
git commit -m "fix(tests): fix ChatRenderer and PlaygroundIntegration test failures"
```

---

### Task 3: Fix E2E navigation.spec.ts — Update Shortcut Mapping

**Files:**

- Modify: `e2e/navigation.spec.ts`

The E2E tests assert old shortcut mapping (Cmd+1=Agents, Cmd+2=Terminal, Cmd+3=Sprint, ...). The actual mapping in `App.tsx` (`VIEW_SHORTCUT_MAP`) is:

```
Cmd+1 -> dashboard    Cmd+4 -> sprint       Cmd+7 -> memory
Cmd+2 -> agents       Cmd+5 -> pr-station   Cmd+8 -> cost
Cmd+3 -> ide          Cmd+6 -> git          Cmd+9 -> settings
```

- [ ] **Step 1: Identify CSS selectors for each view**

Read each view file to find root CSS class names. Build the selector mapping:

| Shortcut | View           | CSS Selector to verify                             |
| -------- | -------------- | -------------------------------------------------- |
| Cmd+1    | Dashboard      | Check DashboardView for root class or card classes |
| Cmd+2    | Agents         | `.agents-view`                                     |
| Cmd+3    | IDE            | `.ide-view`                                        |
| Cmd+4    | Sprint         | `.sprint-center`                                   |
| Cmd+5    | PR Station     | `.pr-station__view-title`                          |
| Cmd+6    | Source Control | Check GitTreeView for root class                   |
| Cmd+7    | Memory         | `.memory-view`                                     |
| Cmd+8    | Cost           | `.cost-view` or `.cost-panel`                      |
| Cmd+9    | Settings       | `.settings-view`                                   |

Verify each selector by reading the view file: `grep -n 'className' src/renderer/src/views/DashboardView.tsx` etc.

- [ ] **Step 2: Rewrite the individual shortcut tests**

Update each `test('Cmd+N -> X view')` to use the correct mapping and verified selector. Add tests for Cmd+8 and Cmd+9 which were previously missing.

- [ ] **Step 3: Rewrite the sequential cycle test**

Update the "Navigate through all views in order" test to cycle through all 9 views with correct selectors.

- [ ] **Step 4: Update command palette navigation tests within this file**

The command palette tests that reference `Meta+3` for Sprint should now use `Meta+4`. Update accordingly.

- [ ] **Step 5: Commit**

```bash
git add e2e/navigation.spec.ts
git commit -m "fix(e2e): update navigation tests to match current Cmd+1-9 shortcut mapping"
```

---

### Task 4: Fix E2E sessions.spec.ts -> agents.spec.ts + command-palette.spec.ts

**Files:**

- Rename: `e2e/sessions.spec.ts` -> `e2e/agents.spec.ts`
- Modify: `e2e/command-palette.spec.ts`
- Merge into agents.spec.ts: `e2e/spawn-agent.spec.ts`

- [ ] **Step 1: Rename sessions.spec.ts to agents.spec.ts**

```bash
git mv e2e/sessions.spec.ts e2e/agents.spec.ts
```

- [ ] **Step 2: Read the current AgentsView to identify correct CSS selectors**

Read: `src/renderer/src/views/AgentsView.tsx`
Find the root class name (`.agents-view`) and child selectors for sidebar, agent list, filter input, spawn button.

- [ ] **Step 3: Rewrite agents.spec.ts with correct selectors**

Replace all `.sessions-chat` references with the correct AgentsView selectors. Update test descriptions from "Sessions" to "Agents". The default view is now Dashboard, NOT Agents — so tests need to navigate to Agents first via Cmd+2.

- [ ] **Step 4: Merge spawn-agent.spec.ts content into agents.spec.ts**

Read `e2e/spawn-agent.spec.ts`. Move the SpawnModal tests into `agents.spec.ts` as an additional `test.describe` block. Delete the standalone file.

```bash
git rm e2e/spawn-agent.spec.ts
```

- [ ] **Step 5: Fix command-palette.spec.ts**

Replace `.sessions-chat` reference at line 9 with `.app-shell` or the Dashboard selector. The test expects the app to load to a default view before opening the palette — use Dashboard selector since that is now the default.

- [ ] **Step 6: Commit**

```bash
git add e2e/agents.spec.ts e2e/command-palette.spec.ts
git commit -m "fix(e2e): rename sessions to agents, fix stale selectors, merge spawn-agent tests"
```

---

## Phase 1: Unit Test Gaps

> Priority: HIGH. These close the gap from 65% -> 68%+ to pass CI. Ordered by coverage impact (biggest gaps first).
>
> **Branch coverage note:** Branches are the tightest threshold (58.62% vs 60% gate). Every test file MUST include conditional branch tests — error states, empty data, disabled states, loading states — not just "renders correctly" happy paths. Run `npm run test:coverage` after Task 8 to check branch progress and course-correct if needed.

### Task 5: Terminal Components — AgentOutputTab, FindBar, TerminalPane, ShellPicker

**Files:**

- Create: `src/renderer/src/components/terminal/__tests__/AgentOutputTab.test.tsx`
- Create: `src/renderer/src/components/terminal/__tests__/FindBar.test.tsx`
- Create: `src/renderer/src/components/terminal/__tests__/TerminalPane.test.tsx`
- Create: `src/renderer/src/components/terminal/__tests__/ShellPicker.test.tsx`

These 4 components are at 0% coverage. TerminalPane is the largest and most impactful.

- [ ] **Step 1: Read each component to understand props and behavior**

Read:

- `src/renderer/src/components/terminal/AgentOutputTab.tsx`
- `src/renderer/src/components/terminal/FindBar.tsx`
- `src/renderer/src/components/terminal/TerminalPane.tsx`
- `src/renderer/src/components/terminal/ShellPicker.tsx`

Also read existing terminal tests for patterns:

- `src/renderer/src/components/terminal/__tests__/TerminalContent.test.tsx`
- `src/renderer/src/components/terminal/__tests__/TerminalTabBar.test.tsx`

- [ ] **Step 2: Write AgentOutputTab tests**

Test: renders with agent event data, displays event types correctly, handles empty events.
Follow the ChatRenderer test pattern — mock child components if they do DOM measurement.

- [ ] **Step 3: Run test to verify it passes**

Run: `npm test -- --reporter=verbose src/renderer/src/components/terminal/__tests__/AgentOutputTab.test.tsx`
Expected: PASS

- [ ] **Step 4: Write FindBar tests**

Test: renders search input, calls onSearch callback on input change, toggles visibility, highlights match count.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --reporter=verbose src/renderer/src/components/terminal/__tests__/FindBar.test.tsx`
Expected: PASS

- [ ] **Step 6: Write TerminalPane tests**

This is the largest component. Mock `xterm` and `xterm-addon-fit`. Test: renders terminal container, calls onData callback, handles resize, displays shell output. Reference existing TerminalContent test for xterm mocking patterns.

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- --reporter=verbose src/renderer/src/components/terminal/__tests__/TerminalPane.test.tsx`
Expected: PASS

- [ ] **Step 8: Write ShellPicker tests**

Test: renders shell options, calls onSelect callback, highlights active shell.

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test -- --reporter=verbose src/renderer/src/components/terminal/__tests__/ShellPicker.test.tsx`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/components/terminal/__tests__/AgentOutputTab.test.tsx \
        src/renderer/src/components/terminal/__tests__/FindBar.test.tsx \
        src/renderer/src/components/terminal/__tests__/TerminalPane.test.tsx \
        src/renderer/src/components/terminal/__tests__/ShellPicker.test.tsx
git commit -m "test(terminal): add unit tests for AgentOutputTab, FindBar, TerminalPane, ShellPicker"
```

---

### Task 6: IDE Components — FileSidebar, FileContextMenu, UnsavedDialog, IDEEmptyState

**Files:**

- Create: `src/renderer/src/components/ide/__tests__/FileSidebar.test.tsx`
- Create: `src/renderer/src/components/ide/__tests__/FileContextMenu.test.tsx`
- Create: `src/renderer/src/components/ide/__tests__/UnsavedDialog.test.tsx`
- Create: `src/renderer/src/components/ide/__tests__/IDEEmptyState.test.tsx`

IDE components are at 51% overall. FileSidebar (17%) and FileContextMenu (0%) are the biggest gaps.

- [ ] **Step 1: Read each component**

Read:

- `src/renderer/src/components/ide/FileSidebar.tsx`
- `src/renderer/src/components/ide/FileContextMenu.tsx`
- `src/renderer/src/components/ide/UnsavedDialog.tsx`
- `src/renderer/src/components/ide/IDEEmptyState.tsx`

Also read existing IDE tests for patterns:

- `src/renderer/src/components/ide/__tests__/FileTree.test.tsx`

- [ ] **Step 2: Write FileSidebar tests**

Test: renders file tree when rootPath set, shows empty state when no root, calls openFile on file click, shows loading state. Mock `window.api.readDir` IPC call.

- [ ] **Step 3: Run test**

Run: `npm test -- --reporter=verbose src/renderer/src/components/ide/__tests__/FileSidebar.test.tsx`
Expected: PASS

- [ ] **Step 4: Write FileContextMenu tests**

Test: renders menu items (Rename, Delete, Copy Path, etc.), calls correct callbacks on click, positions at mouse coordinates.

- [ ] **Step 5: Run test**

Run: `npm test -- --reporter=verbose src/renderer/src/components/ide/__tests__/FileContextMenu.test.tsx`
Expected: PASS

- [ ] **Step 6: Write UnsavedDialog tests**

Test: renders with file name, Save/Discard/Cancel buttons, calls correct callback for each action, keyboard Escape triggers Cancel.

- [ ] **Step 7: Run test**

Run: `npm test -- --reporter=verbose src/renderer/src/components/ide/__tests__/UnsavedDialog.test.tsx`
Expected: PASS

- [ ] **Step 8: Write IDEEmptyState tests**

Test: renders "Open Folder" prompt, calls onOpenFolder callback on button click.

- [ ] **Step 9: Run test**

Run: `npm test -- --reporter=verbose src/renderer/src/components/ide/__tests__/IDEEmptyState.test.tsx`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/components/ide/__tests__/FileSidebar.test.tsx \
        src/renderer/src/components/ide/__tests__/FileContextMenu.test.tsx \
        src/renderer/src/components/ide/__tests__/UnsavedDialog.test.tsx \
        src/renderer/src/components/ide/__tests__/IDEEmptyState.test.tsx
git commit -m "test(ide): add unit tests for FileSidebar, FileContextMenu, UnsavedDialog, IDEEmptyState"
```

---

### Task 7: Task Workbench Components

**Files:**

- Create: `src/renderer/src/components/task-workbench/__tests__/` (directory — `mkdir -p` first)
- Create: `src/renderer/src/components/task-workbench/__tests__/WorkbenchForm.test.tsx`
- Create: `src/renderer/src/components/task-workbench/__tests__/WorkbenchCopilot.test.tsx`
- Create: `src/renderer/src/components/task-workbench/__tests__/WorkbenchActions.test.tsx`

All Task Workbench components are at 0%. Focus on the 3 with the most logic.

- [ ] **Step 1: Read each component and the taskWorkbench store**

Read:

- `src/renderer/src/components/task-workbench/WorkbenchForm.tsx`
- `src/renderer/src/components/task-workbench/WorkbenchCopilot.tsx`
- `src/renderer/src/components/task-workbench/WorkbenchActions.tsx`
- `src/renderer/src/components/task-workbench/TaskWorkbench.tsx` (parent)
- `src/renderer/src/stores/taskWorkbench.ts`

- [ ] **Step 2: Write WorkbenchForm tests**

Test: renders title/repo/spec fields, calls store setters on input change, validates required fields, shows template selector.

- [ ] **Step 3: Run test**

Run: `npm test -- --reporter=verbose src/renderer/src/components/task-workbench/__tests__/WorkbenchForm.test.tsx`
Expected: PASS

- [ ] **Step 4: Write WorkbenchCopilot tests**

Test: renders message list, shows input area, sends message on Enter, shows loading state during AI response. Mock `window.api.workbench.chat` IPC.

- [ ] **Step 5: Run test**

Run: `npm test -- --reporter=verbose src/renderer/src/components/task-workbench/__tests__/WorkbenchCopilot.test.tsx`
Expected: PASS

- [ ] **Step 6: Write WorkbenchActions tests**

Test: renders Queue/Save buttons, Queue button calls correct IPC, disabled state when form invalid.

- [ ] **Step 7: Run test**

Run: `npm test -- --reporter=verbose src/renderer/src/components/task-workbench/__tests__/WorkbenchActions.test.tsx`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/task-workbench/__tests__/
git commit -m "test(workbench): add unit tests for WorkbenchForm, WorkbenchCopilot, WorkbenchActions"
```

---

### Task 8: Agent Chat Sub-Components — SteerInput, ThinkingBlock, ChatBubble, ToolCallBlock

**Files:**

- Create: `src/renderer/src/components/agents/__tests__/SteerInput.test.tsx`
- Create: `src/renderer/src/components/agents/__tests__/ThinkingBlock.test.tsx`
- Create: `src/renderer/src/components/agents/__tests__/ChatBubble.test.tsx`
- Create: `src/renderer/src/components/agents/__tests__/ToolCallBlock.test.tsx`

All at 0-14% coverage. These are the building blocks of the ChatRenderer.

- [ ] **Step 1: Read each component**

Read:

- `src/renderer/src/components/agents/SteerInput.tsx`
- `src/renderer/src/components/agents/ThinkingBlock.tsx`
- `src/renderer/src/components/agents/ChatBubble.tsx`
- `src/renderer/src/components/agents/ToolCallBlock.tsx`

- [ ] **Step 2: Write ChatBubble tests**

Test: renders agent variant (left-aligned), renders user variant (right-aligned), renders error variant (red border), renders markdown content, shows timestamp when provided.

- [ ] **Step 3: Run test**

Run: `npm test -- --reporter=verbose src/renderer/src/components/agents/__tests__/ChatBubble.test.tsx`
Expected: PASS

- [ ] **Step 4: Write ThinkingBlock tests**

Test: renders collapsed with "THINKING" label + token count, expands on click to show thinking text, toggles back to collapsed.

- [ ] **Step 5: Run test**

Run: `npm test -- --reporter=verbose src/renderer/src/components/agents/__tests__/ThinkingBlock.test.tsx`
Expected: PASS

- [ ] **Step 6: Write ToolCallBlock tests**

Test: renders collapsed with tool name + summary, shows success/fail badge when result present, expands to show input JSON, shows output JSON when paired.

- [ ] **Step 7: Run test**

Run: `npm test -- --reporter=verbose src/renderer/src/components/agents/__tests__/ToolCallBlock.test.tsx`
Expected: PASS

- [ ] **Step 8: Write SteerInput tests**

Test: renders textarea + send button, Enter sends message and clears input, Shift+Enter inserts newline, send button disabled when empty.

- [ ] **Step 9: Run test**

Run: `npm test -- --reporter=verbose src/renderer/src/components/agents/__tests__/SteerInput.test.tsx`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/components/agents/__tests__/ChatBubble.test.tsx \
        src/renderer/src/components/agents/__tests__/ThinkingBlock.test.tsx \
        src/renderer/src/components/agents/__tests__/ToolCallBlock.test.tsx \
        src/renderer/src/components/agents/__tests__/SteerInput.test.tsx
git commit -m "test(agents): add unit tests for ChatBubble, ThinkingBlock, ToolCallBlock, SteerInput"
```

---

### Task 9: Remaining Unit Gaps — PanelDropOverlay, AppearanceSection, Dashboard Cards, FileTreeSection

**Files:**

- Extend: `src/renderer/src/components/panels/__tests__/PanelDropOverlay.test.tsx`
- Extend: `src/renderer/src/components/settings/__tests__/AppearanceSection.test.tsx`
- Create: `src/renderer/src/components/dashboard/__tests__/` (directory — `mkdir -p` first)
- Create: `src/renderer/src/components/dashboard/__tests__/ActiveTasksCard.test.tsx`
- Create: `src/renderer/src/components/dashboard/__tests__/RecentCompletionsCard.test.tsx`
- Extend: `src/renderer/src/components/git-tree/__tests__/FileTreeSection.test.tsx`

- [ ] **Step 1: Read each component and its existing test**

Read all 5 source files and any existing test files.

- [ ] **Step 2: Extend PanelDropOverlay tests**

Current coverage: 24%. Add tests for: drop zone detection (top/bottom/left/right/center), drag-over highlight, drop callback with correct zone, mouse position calculation.

- [ ] **Step 3: Run test**

Run: `npm test -- --reporter=verbose src/renderer/src/components/panels/__tests__/PanelDropOverlay.test.tsx`
Expected: PASS

- [ ] **Step 4: Extend AppearanceSection tests**

Current coverage: 4.76%. Add tests for: renders theme buttons (light/dark), renders accent swatches, clicking theme button calls settings IPC, clicking accent swatch updates store.

- [ ] **Step 5: Run test**

Run: `npm test -- --reporter=verbose src/renderer/src/components/settings/__tests__/AppearanceSection.test.tsx`
Expected: PASS

- [ ] **Step 6: Write ActiveTasksCard tests**

Test: renders card title, shows task count, shows "No active tasks" empty state, clicking card navigates to Sprint view.

- [ ] **Step 7: Write RecentCompletionsCard tests**

Test: renders card title, shows completion list, shows "No recent completions" empty state, formats timestamps correctly.

- [ ] **Step 8: Run both card tests**

Run: `npm test -- --reporter=verbose src/renderer/src/components/dashboard/__tests__/`
Expected: PASS

- [ ] **Step 9: Extend FileTreeSection tests**

Current coverage: 38.46%. Add tests for: renders staged/unstaged/untracked sections, calls stageFile/unstageFile callbacks, shows file count badges, empty sections not rendered.

- [ ] **Step 10: Run test**

Run: `npm test -- --reporter=verbose src/renderer/src/components/git-tree/__tests__/FileTreeSection.test.tsx`
Expected: PASS

- [ ] **Step 11: Run full coverage check**

Run: `npm run test:coverage 2>&1 | grep -E "Statements|Branches|Functions|Lines" | head -5`
Expected: All thresholds pass (68% stmts, 68% lines, 65% funcs, 60% branches)

- [ ] **Step 12: Commit**

```bash
git add src/renderer/src/components/panels/__tests__/PanelDropOverlay.test.tsx \
        src/renderer/src/components/settings/__tests__/AppearanceSection.test.tsx \
        src/renderer/src/components/dashboard/__tests__/ \
        src/renderer/src/components/git-tree/__tests__/FileTreeSection.test.tsx
git commit -m "test: close remaining unit test gaps -- panels, settings, dashboard, git-tree"
```

---

## Phase 2: Integration Tests

> Priority: MEDIUM. These test the contracts between subsystems. Run via `npm run test:main`.

### Task 10: IPC Channel Registration Completeness

**Files:**

- Create: `src/main/__tests__/integration/ipc-registration.test.ts`

One test that protects all 69+ IPC channels from registration typos.

- [ ] **Step 1: Read the IPC channel map and handler registration**

Read:

- `src/shared/ipc-channels.ts` -- all channel type definitions
- `src/main/index.ts` -- where handlers are registered via `ipcMain.handle()`

Understand how `safeHandle()` wraps each handler registration.

- [ ] **Step 2: Write the registration completeness test**

Mock `electron`'s `ipcMain` to capture all channels passed to `handle()` and `on()`. Import the main module to trigger all handler registrations. Verify every channel key from `IpcChannelMap` in `ipc-channels.ts` has a corresponding registered handler.

The exact implementation depends on how `src/main/index.ts` is structured. The test may need to mock more Electron APIs (BrowserWindow, app, etc.) to allow the module to load. Read `src/main/index.ts` carefully.

- [ ] **Step 3: Run test**

Run: `npm run test:main -- --reporter=verbose src/main/__tests__/integration/ipc-registration.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/__tests__/integration/ipc-registration.test.ts
git commit -m "test(integration): add IPC channel registration completeness check"
```

---

### Task 11: Sprint CRUD IPC Integration

**Files:**

- Create: `src/main/__tests__/integration/sprint-ipc.test.ts`

Test sprint handler create/list/update/delete through the actual handler functions (not mocked).

- [ ] **Step 1: Read the sprint-local handler to understand the handler functions**

Read: `src/main/handlers/sprint-local.ts`
Identify the exported `registerSprintLocalHandlers()` function and how it uses `safeHandle()`.

- [ ] **Step 2: Write integration test**

Mock Supabase client at the HTTP level (not the function level). Call handler functions directly with realistic arguments. Verify return shapes match what renderer stores expect.

Test cases:

- Create task -> returns task with ID
- List tasks -> returns array with created task
- Update task status -> returns updated task
- Delete task -> returns success
- Create task with dependencies -> auto-blocks if deps unsatisfied

- [ ] **Step 3: Run test**

Run: `npm run test:main -- --reporter=verbose src/main/__tests__/integration/sprint-ipc.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/__tests__/integration/sprint-ipc.test.ts
git commit -m "test(integration): add sprint CRUD IPC integration tests"
```

---

### Task 12: Agent Manager Completion Pipeline

**Files:**

- Create: `src/main/__tests__/integration/agent-completion-pipeline.test.ts`

Test: task completes -> resolveSuccess -> git add/commit/push -> open PR -> task status -> done.

- [ ] **Step 1: Read the completion handler and resolve flow**

Read:

- `src/main/agent-manager/completion.ts`
- `src/main/agent-manager/resolve-dependents.ts`
- `src/main/agent-manager/run-agent.ts`

- [ ] **Step 2: Write integration test**

Mock `child_process.execFile` (for git commands) and GitHub API (for PR creation) at a higher level than unit tests. Wire real completion handler with mocked git/GitHub. Verify the full chain: completion -> git operations -> PR -> status transition -> dependent unblock.

Test cases:

- Agent exits 0 with changes -> push + PR -> task done with pr_url
- Agent exits 0 with no changes -> task done, no PR
- Agent exits non-zero -> retry count check -> re-queue or permanent fail
- Agent completes -> blocked dependents unblocked

- [ ] **Step 3: Run test**

Run: `npm run test:main -- --reporter=verbose src/main/__tests__/integration/agent-completion-pipeline.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/__tests__/integration/agent-completion-pipeline.test.ts
git commit -m "test(integration): add agent completion pipeline tests -- push, PR, retry, unblock"
```

---

### Task 13: Queue API Auth + SSE Integration

**Files:**

- Create: `src/main/__tests__/integration/queue-api-auth.test.ts`
- Create: `src/main/__tests__/integration/queue-api-sse.test.ts`

- [ ] **Step 1: Read the Queue API auth helpers and SSE broadcaster**

Read:

- `src/main/queue-api/helpers.ts` -- auth logic (Bearer + ?token= paths)
- `src/main/queue-api/sse-broadcaster.ts`
- `src/main/queue-api/event-handlers.ts`
- Existing: `src/main/__tests__/integration/queue-api-integration.test.ts` for patterns

- [ ] **Step 2: Write auth integration test**

Test cases:

- `?token=correct` -> 200
- `?token=wrong` -> 403
- `?token=` (empty) -> 401
- Bearer header AND query param -> Bearer takes precedence

- [ ] **Step 3: Write SSE event delivery test**

Test: connect SSE client via HTTP, create/update task, verify SSE message received with correct payload shape. Use Node.js `http` module to connect to the SSE endpoint.

- [ ] **Step 4: Run tests**

Run: `npm run test:main -- --reporter=verbose src/main/__tests__/integration/queue-api-auth.test.ts src/main/__tests__/integration/queue-api-sse.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/__tests__/integration/queue-api-auth.test.ts \
        src/main/__tests__/integration/queue-api-sse.test.ts
git commit -m "test(integration): add Queue API auth and SSE event delivery tests"
```

---

### Task 14: IDE Path Traversal + DB CRUD Integration

**Files:**

- Create: `src/main/__tests__/integration/ide-path-traversal.test.ts`
- Create: `src/main/__tests__/integration/db-crud.test.ts`

- [ ] **Step 1: Read the IDE FS handler path validation**

Read: `src/main/handlers/ide-fs-handlers.ts` -- find `validateIdePath()` or equivalent path sanitization.

- [ ] **Step 2: Write path traversal security test**

```typescript
describe('IDE FS Path Traversal Prevention', () => {
  it('rejects ../../etc/passwd', async () => {
    /* ... */
  })
  it('rejects absolute paths outside watched root', async () => {
    /* ... */
  })
  it('allows valid paths within watched root', async () => {
    /* ... */
  })
  it('rejects symlink escape', async () => {
    /* ... */
  })
})
```

- [ ] **Step 3: Write DB CRUD integration test**

Use in-memory SQLite (`:memory:`). Run all migrations. Exercise CRUD on each table:

- `agent_runs`: insert -> select -> update status -> select
- `settings`: set -> get -> delete -> get (returns null)
- `agent_events`: insert -> query by agent_id -> verify ordering
- `cost_events`: insert -> aggregate query

- [ ] **Step 4: Run tests**

Run: `npm run test:main -- --reporter=verbose src/main/__tests__/integration/ide-path-traversal.test.ts src/main/__tests__/integration/db-crud.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/__tests__/integration/ide-path-traversal.test.ts \
        src/main/__tests__/integration/db-crud.test.ts
git commit -m "test(integration): add IDE path traversal security + DB CRUD integration tests"
```

---

## Phase 3: E2E Overhaul

> Priority: MEDIUM. These verify real user journeys through the full Electron app.
>
> **Prerequisite:** E2E tests require a built app. Run `npm run build` before any `npm run test:e2e` invocation. The build must be re-run if source files change between E2E test runs.

### Task 15: E2E Helpers — seed-data.ts + mock-git-repo.ts

**Files:**

- Create: `e2e/helpers/seed-data.ts`
- Create: `e2e/helpers/mock-git-repo.ts`

- [ ] **Step 1: Read the existing E2E fixture to understand the app context**

Read: `e2e/fixtures.ts`
Understand how `bde.window` exposes `evaluate()` for running code in the Electron context.

- [ ] **Step 2: Write seed-data.ts**

Helper to insert/delete test tasks via the Electron evaluate API. Functions:

- `seedTask(window, overrides?)` -- creates a task via `window.api.sprint.create()`, returns task ID
- `cleanupTask(window, taskId)` -- deletes a task via `window.api.sprint.delete()`

Adjust the IPC method names after reading the actual preload API surface at `src/preload/index.ts`.

- [ ] **Step 3: Write mock-git-repo.ts**

Helper to create a temp git repo with known state for IDE/Source Control tests. Functions:

- `createMockGitRepo()` -- returns `{ path, cleanup }`. Creates temp dir, runs `git init`, adds initial commit, creates staged + unstaged files.

Uses `child_process.execFileSync` with argument arrays (not `exec` with string interpolation) per BDE code quality guidelines.

- [ ] **Step 4: Commit**

```bash
git add e2e/helpers/
git commit -m "test(e2e): add seed-data and mock-git-repo helpers"
```

---

### Task 16: E2E — Dashboard + Sprint Journeys

**Files:**

- Create: `e2e/dashboard.spec.ts`
- Extend: `e2e/sprint.spec.ts`

- [ ] **Step 1: Write dashboard.spec.ts**

Test cases:

- App launches to Dashboard (default view)
- Dashboard shows 4 cards (ActiveTasks, RecentCompletions, CostSummary, OpenPRs)
- Each card has a title and content area

- [ ] **Step 2: Extend sprint.spec.ts with SpecDrawer test**

Test: Navigate to Sprint (Cmd+4), click a task title (seed one first via helper), verify SpecDrawer opens with task details.

- [ ] **Step 3: Extend sprint.spec.ts with dependency test**

Test: Seed two tasks, add task B as hard dependency of task A via IPC, verify task A shows "blocked" badge in Kanban.

- [ ] **Step 4: Commit**

```bash
git add e2e/dashboard.spec.ts e2e/sprint.spec.ts
git commit -m "test(e2e): add Dashboard smoke tests + Sprint SpecDrawer and dependency journeys"
```

---

### Task 17: E2E — IDE + Source Control Journeys

**Files:**

- Create: `e2e/ide.spec.ts`
- Create: `e2e/source-control.spec.ts`

Both use the `mock-git-repo.ts` helper for a temp repo with known git state.

- [ ] **Step 1: Write ide.spec.ts**

Test cases:

- Navigate to IDE (Cmd+3), open a folder (the mock repo), verify FileSidebar shows files
- Click a file in tree -> opens in editor tab
- Close tab with unsaved changes -> UnsavedDialog appears

- [ ] **Step 2: Write source-control.spec.ts**

Test cases:

- Navigate to Source Control (Cmd+6), set active repo to mock repo
- Staged and unstaged sections visible with correct file counts
- Click stage button -> file moves to staged section
- Type commit message -> commit button enabled

- [ ] **Step 3: Commit**

```bash
git add e2e/ide.spec.ts e2e/source-control.spec.ts
git commit -m "test(e2e): add IDE and Source Control user journey tests"
```

---

### Task 18: E2E — Agents + PR Station + Settings + Cost Extensions

**Files:**

- Extend: `e2e/agents.spec.ts` (from Task 4)
- Extend: `e2e/pr-station.spec.ts`
- Extend: `e2e/settings.spec.ts`
- Extend: `e2e/cost.spec.ts`

- [ ] **Step 1: Extend agents.spec.ts with spawn flow**

Test: Open SpawnModal, select repo from dropdown, fill task title, verify Spawn button is enabled. (Do not actually spawn -- that requires OAuth token.)

- [ ] **Step 2: Extend pr-station.spec.ts with filter test**

Test: Navigate to PR Station (Cmd+5), verify filter bar renders, click a repo chip (if PRs available), verify list updates.

- [ ] **Step 3: Extend settings.spec.ts with connections save**

Test: Navigate to Settings (Cmd+9), go to Connections tab, fill Supabase URL field, click Save, navigate away and back, verify URL persisted.

- [ ] **Step 4: Extend cost.spec.ts with export test**

Test: Navigate to Cost (Cmd+8), click Export CSV button, verify "Copied!" feedback appears.

- [ ] **Step 5: Commit**

```bash
git add e2e/agents.spec.ts e2e/pr-station.spec.ts e2e/settings.spec.ts e2e/cost.spec.ts
git commit -m "test(e2e): extend agents, PR station, settings, and cost E2E tests"
```

---

### Task 19: Final Verification — Full Suite Green

- [ ] **Step 1: Run full renderer test suite with coverage**

Run: `npm run test:coverage 2>&1 | tail -20`
Expected: ALL thresholds pass (68% stmts, 68% lines, 65% funcs, 60% branches)

- [ ] **Step 2: Run full main process tests**

Run: `npm run test:main 2>&1 | tail -10`
Expected: 0 failures

- [ ] **Step 3: Run full E2E suite**

Run: `npm run test:e2e 2>&1 | tail -20`
Expected: ALL specs pass

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Verify pre-push hook passes**

Run: `npm run typecheck && npm test`
Expected: PASS (this is what Husky runs on push)

- [ ] **Step 6: Commit any final adjustments and push**

```bash
git push origin <branch>
```
