# Spacing token adoption — sprint + review + planner + workbench components

## Problem

CSS files in the sprint pipeline, code review, planner, and task workbench components use hardcoded pixel values for `gap`, `padding`, and `margin` instead of the `--bde-space-*` design tokens.

## Solution

Replace every hardcoded spacing pixel value that has an exact token match. The token scale in `src/renderer/src/assets/tokens.css`:

| Raw    | Token                |
| ------ | -------------------- |
| `4px`  | `var(--bde-space-1)` |
| `8px`  | `var(--bde-space-2)` |
| `12px` | `var(--bde-space-3)` |
| `16px` | `var(--bde-space-4)` |
| `20px` | `var(--bde-space-5)` |
| `24px` | `var(--bde-space-6)` |
| `32px` | `var(--bde-space-8)` |

**Rules:**

- Only replace `gap`, `padding`, and `margin` properties (including `-top`/`-right`/`-bottom`/`-left` variants)
- Tokenize each value independently in shorthands: `padding: 8px 10px` → `padding: var(--bde-space-2) 10px`
- **Leave as-is:** `0`/`1px`/`2px`/`3px`, values without token match (`6px`, `10px`, `14px`), negative values, `calc()` internals, non-spacing properties (`width`, `height`, `font-size`, `border-radius`, `border-width`)

## Files to Change

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

## How to Test

1. Grep for remaining hardcoded tokenizable values — should return zero:
   ```bash
   grep -rnE '(gap|padding|margin)[^:]*:\s*[^;]*((?<![0-9])(4|8|12|16|20|24|32)px)' src/renderer/src/components/sprint/*.css src/renderer/src/components/code-review/*.css src/renderer/src/components/planner/*.css src/renderer/src/components/task-workbench/*.css
   ```
2. `npm run typecheck && npm test && npm run lint` — all must pass

## Out of Scope

- Non-spacing properties (`width`, `height`, `font-size`, `border-radius`)
- Values without exact token match (`6px`, `10px`, `14px`)
- Token namespace changes (`--neon-*` → `--bde-*`) — separate plan
- Adding new tokens to the scale
