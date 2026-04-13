# CSS Audit Remediation Phase 12 — Design Spec

## Goal

Remediate CSS architecture findings from the 2026-04-10 post-refactor audit. This epic targets two categories: (1) hardcoded spacing values that should use `--bde-space-*` design tokens, and (2) dead CSS and unjustified `!important` declarations.

This work is orthogonal to the existing CSS System Consolidation plan (`2026-04-08-css-system-consolidation.md`), which covers `--neon-*` → `--bde-*` namespace merging and neon effect removal. No overlap.

## Context

The CSS refactor (phases 10–11) achieved excellent co-location (79 CSS files matched to components) and 100% color tokenization. The post-refactor audit found that **spacing tokenization lags behind**: hundreds of hardcoded pixel values (`gap: 8px`, `padding: 12px`, etc.) across ~80 CSS files that should use the `--bde-space-*` token scale. Additionally, 3 dead selectors, 2 unused `@keyframes`, and 12 unjustified `!important` declarations remain.

## Token Mapping

The `--bde-space-*` scale defined in `src/renderer/src/assets/tokens.css`:

| Raw value | Token                |
| --------- | -------------------- |
| `4px`     | `var(--bde-space-1)` |
| `8px`     | `var(--bde-space-2)` |
| `12px`    | `var(--bde-space-3)` |
| `16px`    | `var(--bde-space-4)` |
| `20px`    | `var(--bde-space-5)` |
| `24px`    | `var(--bde-space-6)` |
| `32px`    | `var(--bde-space-8)` |

### Replacement Rules

- **Only replace** `gap`, `padding`, and `margin` properties (including `-top`, `-right`, `-bottom`, `-left` variants)
- **Tokenize each value independently** within shorthands. `padding: 8px 10px` → `padding: var(--bde-space-2) 10px`. If a value has an exact token match, replace it regardless of whether sibling values also match.

### Exclusions — values that stay as raw pixels

- `0`, `0px`, `1px`, `2px`, `3px` — below the token scale
- Values with no exact token match (e.g., `6px`, `10px`, `14px`) — leave as-is
- Negative values (e.g., `margin-top: -4px`) — leave as-is
- Values inside `calc()` expressions — leave as-is
- Non-spacing properties (`width`, `height`, `font-size`, `border-radius`, `top`, `left`, `right`, `bottom`, `border-width`) — do not touch

## Epic Structure

5 tasks, all independent (no dependencies). All can run in parallel.

---

### Task 1a: Spacing tokens — IDE + diff components

**Scope:** 14 CSS files.

**Files:**

- `src/renderer/src/components/ide/QuickOpenPalette.css`
- `src/renderer/src/components/ide/EditorPane.css`
- `src/renderer/src/components/ide/EditorTabBar.css`
- `src/renderer/src/components/ide/FileSidebar.css`
- `src/renderer/src/components/ide/EditorBreadcrumb.css`
- `src/renderer/src/components/ide/FileTree.css`
- `src/renderer/src/components/ide/FileTreeNode.css`
- `src/renderer/src/components/ide/EditorToolbar.css`
- `src/renderer/src/components/ide/TerminalPanel.css`
- `src/renderer/src/components/diff/DiffViewer.css`
- `src/renderer/src/components/diff/DiffCommentWidget.css`
- `src/renderer/src/components/diff/PlainDiffContent.css`
- `src/renderer/src/components/diff/DiffCommentComposer.css`
- `src/renderer/src/components/diff/DiffFileList.css`

**Action:** Replace hardcoded `gap`, `padding`, and `margin` pixel values with `var(--bde-space-*)` tokens per the mapping table. Respect all exclusions.

**How to Test:**

1. Grep for `(gap|padding|margin).*\b(4|8|12|16|20|24|32)px` in the file set — should return zero matches
2. `npm run typecheck && npm test && npm run lint` — must pass

**Out of Scope:** Non-spacing properties, values without token matches, `calc()` expressions.

---

### Task 1b: Spacing tokens — sprint + review + planner + workbench components

**Scope:** 23 CSS files.

**Files:**

- `src/renderer/src/components/sprint/PipelineOverlays.css`
- `src/renderer/src/components/sprint/TaskDetailDrawer.css`
- `src/renderer/src/components/sprint/PipelineBacklog.css`
- `src/renderer/src/components/sprint/PipelineHeader.css`
- `src/renderer/src/components/sprint/TaskPill.css`
- `src/renderer/src/components/sprint/TaskRow.css`
- `src/renderer/src/components/sprint/SprintPipeline.css`
- `src/renderer/src/components/sprint/PipelineStage.css`
- `src/renderer/src/components/code-review/ConversationTab.css`
- `src/renderer/src/components/code-review/ReviewActions.css`
- `src/renderer/src/components/code-review/ChangesTab.css`
- `src/renderer/src/components/code-review/ReviewQueue.css`
- `src/renderer/src/components/code-review/ReviewDetail.css`
- `src/renderer/src/components/planner/EpicDetail.css`
- `src/renderer/src/components/planner/EpicList.css`
- `src/renderer/src/components/planner/CreateEpicModal.css`
- `src/renderer/src/components/task-workbench/WorkbenchCopilot.css`
- `src/renderer/src/components/task-workbench/DependencyPicker.css`
- `src/renderer/src/components/task-workbench/WorkbenchForm.css`
- `src/renderer/src/components/task-workbench/ValidationChecks.css`
- `src/renderer/src/components/task-workbench/TaskWorkbench.css`
- `src/renderer/src/components/task-workbench/WorkbenchActions.css`
- `src/renderer/src/components/task-workbench/SpecEditor.css`

**Action:** Same replacement rules as Task 1a.

**How to Test:** Same grep verification + build gate as Task 1a.

**Out of Scope:** Same as Task 1a.

---

### Task 1c: Spacing tokens — agents + dashboard + settings + layout + git-tree + panels

**Scope:** 33 CSS files.

**Files:**

- `src/renderer/src/components/agents/LaunchpadGrid.css`
- `src/renderer/src/components/agents/PlaygroundModal.css`
- `src/renderer/src/components/agents/AgentConsole.css`
- `src/renderer/src/components/agents/ConsoleSearchBar.css`
- `src/renderer/src/components/agents/ConsoleHeader.css`
- `src/renderer/src/components/agents/CommandBar.css`
- `src/renderer/src/components/agents/AgentList.css`
- `src/renderer/src/components/agents/CollapsibleBlock.css`
- `src/renderer/src/components/agents/ConsoleLine.css`
- `src/renderer/src/components/dashboard/CenterColumn.css`
- `src/renderer/src/components/dashboard/ActivitySection.css`
- `src/renderer/src/components/dashboard/StatusRail.css`
- `src/renderer/src/components/settings/MemorySection.css`
- `src/renderer/src/components/settings/RepositoriesSection.css`
- `src/renderer/src/components/settings/CostSection.css`
- `src/renderer/src/components/settings/SettingsCard.css`
- `src/renderer/src/components/settings/ConnectionsSection.css`
- `src/renderer/src/components/settings/AboutSection.css`
- `src/renderer/src/components/settings/AppearanceSection.css`
- `src/renderer/src/components/settings/SettingsSidebar.css`
- `src/renderer/src/components/layout/UnifiedHeader.css`
- `src/renderer/src/components/layout/NeonSidebar.css`
- `src/renderer/src/components/layout/NotificationBell.css`
- `src/renderer/src/components/layout/TearoffShell.css`
- `src/renderer/src/components/layout/CommandPalette.css`
- `src/renderer/src/components/layout/ToastContainer.css`
- `src/renderer/src/components/git-tree/InlineDiffDrawer.css`
- `src/renderer/src/components/git-tree/FileTreeSection.css`
- `src/renderer/src/components/git-tree/GitFileRow.css`
- `src/renderer/src/components/git-tree/BranchSelector.css`
- `src/renderer/src/components/panels/PanelLeaf.css`
- `src/renderer/src/components/help/FeatureGuideModal.css`
- `src/renderer/src/components/settings/SettingsPageHeader.css`

**Action:** Same replacement rules as Task 1a.

**How to Test:** Same grep verification + build gate as Task 1a.

**Out of Scope:** Same as Task 1a.

---

### Task 1d: Spacing tokens — design-system + views + assets

**Scope:** 22 CSS files.

**Files:**

- `src/renderer/src/assets/design-system/neon-badge.css`
- `src/renderer/src/assets/design-system/button.css`
- `src/renderer/src/assets/design-system/utilities.css`
- `src/renderer/src/assets/design-system/badge.css`
- `src/renderer/src/assets/design-system/neon-card.css`
- `src/renderer/src/assets/design-system/card.css`
- `src/renderer/src/assets/design-system/input.css`
- `src/renderer/src/assets/design-system/mini-chart.css`
- `src/renderer/src/assets/design-system/panel.css`
- `src/renderer/src/assets/cost.css`
- `src/renderer/src/assets/memory.css`
- `src/renderer/src/assets/terminal.css`
- `src/renderer/src/assets/onboarding.css`
- `src/renderer/src/assets/command-palette.css`
- `src/renderer/src/assets/toasts.css`
- `src/renderer/src/views/DashboardView.css`
- `src/renderer/src/views/PlannerView.css`
- `src/renderer/src/views/GitTreeView.css`
- `src/renderer/src/views/IDEView.css`
- `src/renderer/src/views/AgentsView.css`
- `src/renderer/src/views/SettingsView.css`
- `src/renderer/src/App.css`

**Action:** Same replacement rules as Task 1a.

**How to Test:** Same grep verification + build gate as Task 1a.

**Out of Scope:** Same as Task 1a.

---

### Task 2: Dead CSS + !important cleanup

**Scope:** 3 dead selectors, 2 unused `@keyframes`, 12 unjustified `!important` declarations.

**Dead selectors to remove:**

- `.playground-modal__view-btn--active` — `src/renderer/src/components/agents/PlaygroundModal.css:10`
- `.pipeline-stage__dot--active` — `src/renderer/src/components/sprint/PipelineStage.css:53` and `src/renderer/src/components/sprint/PipelineOverlays.css:820` (reduced-motion override for same dead class)
- `.agent-pill--running` — `src/renderer/src/components/agents/PlaygroundModal.css:226`

**Unused @keyframes to remove (both copies are unreferenced):**

- `@keyframes bde-slide-up-fade` — `src/renderer/src/assets/reset.css:80`
- `@keyframes toast-slide-in` — remove from both `src/renderer/src/assets/toasts.css:84` and `src/renderer/src/components/layout/ToastContainer.css:84` (neither is referenced by any `animation` property)

**!important to resolve (remove or refactor via increased specificity):**

- `src/renderer/src/components/agents/PlaygroundModal.css:11-13` — 3 instances (background, color, border-color)
- `src/renderer/src/components/sprint/PipelineOverlays.css:1195` — 1 instance (opacity)
- `src/renderer/src/components/diff/PlainDiffContent.css:125,211` — 2 instances (background)
- `src/renderer/src/components/layout/UnifiedHeader.css:357` — 1 instance (min-width: revert)
- `src/renderer/src/assets/cost.css:284` — 1 instance (text-align)
- `src/renderer/src/components/settings/CostSection.css:288` — 1 instance (text-align)
- `src/renderer/src/views/IDEView.css:17,20` — 2 instances (scrollbar width/height)
- `src/renderer/src/views/AgentsView.css:73` — 1 instance (min-width)

**Keep justified (do not touch):** All 5 instances in `src/renderer/src/assets/design-system/utilities.css` (reduced motion overrides).

**How to Test:**

1. Grep for each dead selector and `@keyframes` name — should return zero matches
2. Grep for `!important` across all CSS in `src/renderer/` — should return exactly 5 matches (all in `utilities.css`)
3. `npm run typecheck && npm test && npm run lint` — must pass

**Out of Scope:** Spacing token adoption (covered by Tasks 1a–1d). Neon effect removal (covered by CSS consolidation plan).

## Verification

All tasks use the same verification gate:

1. **Pre-flight count**: Grep for target patterns in the task's file set, record baseline
2. **Post-flight count**: Re-grep — confirm zero remaining violations
3. **Build gate**: `npm run typecheck && npm test && npm run lint` — must pass with zero errors

## Out of Scope

- Token namespace consolidation (`--neon-*` → `--bde-*`) — covered by `2026-04-08-css-system-consolidation.md`
- Neon effect removal (glows, glass blur, scanlines, particles) — same plan
- Clean Code decomposition (function size, file splitting) — separate epic
- CSS module migration — not planned
- New token definitions — use existing `--bde-space-*` scale only
