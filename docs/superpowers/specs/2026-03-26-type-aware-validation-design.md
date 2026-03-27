# Type-Aware Spec Validation

## Problem

The Task Workbench validation system applies identical checks regardless of task type. A simple test task gets the same structural requirements (50+ chars, 2+ markdown headings) as a complex feature implementation. This blocks lightweight tasks unnecessarily and creates friction for power users.

## Solution

Profile-based validation where each spec type (Feature, Bug Fix, Refactor, Test, etc.) defines per-check behavior, plus a confirmation-dialog override for non-critical failures. Also persist `spec_type` on the task record for downstream use.

## Validation Profiles

### Check Behaviors

Each check in a profile has one of three behaviors:

- **required** — failure blocks queuing (current behavior for all checks)
- **advisory** — shows as warning; surfaces in confirmation dialog when user clicks Queue Now
- **skip** — check not evaluated at all

### Check ID Convention

Tier 1 (structural) and Tier 2 (semantic) check IDs use **kebab-case**: `spec-present`, `spec-structure`, `clarity`, `scope`, `files-exist`. The existing `WorkbenchForm.tsx` already registers the semantic file check as `files-exist` (kebab-case). Implementation must use this consistently — the profile matrix keys map to these IDs.

### Profile Matrix

| Check | Feature | Bug Fix | Refactor | Test | Performance | UX | Audit | Infra |
|-------|---------|---------|----------|------|-------------|-----|-------|-------|
| `spec-present` | required (50) | required (50) | required (30) | advisory (20) | required (50) | required (50) | advisory (20) | advisory (20) |
| `spec-structure` | required (2) | required (2) | advisory (1) | advisory (1) | required (2) | required (2) | advisory (1) | advisory (1) |
| `clarity` | required | required | required | advisory | required | required | advisory | advisory |
| `scope` | required | required | advisory | advisory | required | required | advisory | advisory |
| `files-exist` | required | required | advisory | skip | advisory | advisory | skip | skip |

Numbers in parentheses are thresholds — `spec-present` threshold is min character count, `spec-structure` threshold is min heading count.

**Note:** Performance and UX profiles are identical to Feature. They are defined as aliases in code (`VALIDATION_PROFILES['performance'] = VALIDATION_PROFILES['feature']`) to reduce duplication while keeping the type system complete.

### Default Profile (null specType)

When `specType` is null (existing tasks, or no type selected), fall back to the **Feature** profile. This preserves current behavior — all checks remain required with existing thresholds.

### Operational Checks (Unchanged)

Auth, Repo Path, Git Clean, No Conflict, and Agent Slots remain identical across all types. These validate the runtime environment, not spec quality.

## Override Flow

When the user clicks **Queue Now** and advisory checks have failures:

1. Existing `ConfirmModal` dialog appears (direct-render pattern already used in `WorkbenchForm.tsx` via `useState(showQueueConfirm)` — not the `useConfirm` hook)
2. Dialog body lists each overridden advisory check with its status icon and message, rendered as a formatted string with line breaks
3. User confirms to queue anyway, or cancels to revise

No new UI components needed. The `ConfirmModal` `message` prop accepts a string — build a multi-line string from the advisory check results.

### Button Logic Changes

**canQueue** (Queue Now button):
- Current: `allTier1Pass && !tier3HasFails`
- New: `allRequiredTier1Pass && !tier3HasFails` — only checks with `required` behavior in the active profile must pass. Advisory failures don't disable the button but trigger the confirmation dialog before submission.

**canLaunch** (Launch button):
- Current: `allTier1Pass && semanticNoFails && !tier3HasFails`
- New: `allRequiredTier1Pass && allRequiredSemanticPass && !tier3HasFails` — same profile-awareness for both Tier 1 and Tier 2 checks. Advisory semantic failures surface in confirmation dialog, not block Launch.

**canSave** (Save to Backlog): Unchanged — only requires title.

## Spec Type Selection

### Type Button Behavior

Clicking a template button (Feature, Bug Fix, Refactor, Test) sets BOTH:
1. The spec textarea content (existing template scaffold behavior)
2. The `specType` in the store (new)

`specType` is **sticky** — changing the spec text afterward does not reset it. The user must click a different type button to change it. This is intentional: the type represents the user's intent, not the content structure.

### Additional Types in UI

The 4 extra types (Performance, UX, Audit, Infra) are available in `sprint-spec.ts` templates but not shown as buttons in `SpecEditor.tsx`. For this phase, they remain available only via the "Generate Spec" AI flow (which passes `templateHint`). Adding UI buttons for them is out of scope — can be added later as a simple SpecEditor change.

## Data Model: `spec_type` Column

### Migration (v16)

Add to `sprint_tasks` table:

```sql
ALTER TABLE sprint_tasks ADD COLUMN spec_type TEXT;
```

Nullable, defaults to null for existing tasks. Valid values: `feature`, `bugfix`, `refactor`, `test`, `performance`, `ux`, `audit`, `infra`.

### Data Layer Changes

- **`src/shared/types.ts`** — Add `spec_type?: string | null` to the `SprintTask` interface.
- **`src/main/data/sprint-queries.ts`** — Add `'spec_type'` to `UPDATE_ALLOWLIST`. Include in `sanitizeTask()` camelCase mapping. Without the allowlist entry, `updateTask()` silently drops the field.
- **`src/main/queue-api/task-handlers.ts`** — Out of scope for this phase. External consumers (Life OS, claude-task-runner) don't need to set `spec_type` — it's a workbench concern. The field will be readable via GET since `sanitizeTask()` maps it, but PATCH/POST don't need explicit support yet.

### Downstream Uses

- Task Pipeline can show type badges on task pills
- Agent manager could adjust prompt strategy per type
- Filtering/reporting by task type

## Files to Change

### Shared Layer
- **`src/shared/spec-validation.ts`** — Define `SpecType` union, `CheckBehavior` type, `ValidationProfile` interface, `VALIDATION_PROFILES` map, `getValidationProfile(type)` function. Update `validateStructural()` to accept optional `specType` param and apply profile thresholds/behaviors.
- **`src/shared/types.ts`** — Add `spec_type?: string | null` to `SprintTask` interface.

### Main Process
- **`src/main/db.ts`** — Add migration v16 for `spec_type TEXT` column on `sprint_tasks`.
- **`src/main/data/sprint-queries.ts`** — Add `'spec_type'` to `UPDATE_ALLOWLIST`. Include in `sanitizeTask()` field mapping.
- **`src/main/spec-semantic-check.ts`** — Accept `specType` param in `checkSpecSemantic()`. Skip checks marked `skip` in profile. Include `specType` context in AI prompt so it grades contextually (e.g., "This is a test task — focus on whether test targets are clear, not on file paths").
- **`src/main/handlers/workbench.ts`** — Thread `specType` through `workbench:checkSpec` handler.

### Renderer
- **`src/renderer/src/stores/taskWorkbench.ts`** — Add `specType: SpecType | null` to store state and `setSpecType` action.
- **`src/renderer/src/hooks/useReadinessChecks.ts`** — Read `specType` from store, pass to `computeStructuralChecks()`. Apply profile to determine check behavior: required fail → `fail`, advisory fail → `warn`, skip → omit from results.
- **`src/renderer/src/components/task-workbench/WorkbenchActions.tsx`** — Update `canQueue` and `canLaunch` to distinguish required vs advisory failures using profile. Expose `hasAdvisoryFailures` boolean for confirmation dialog trigger.
- **`src/renderer/src/components/task-workbench/WorkbenchForm.tsx`** — Pass `specType` to semantic check IPC call. Update confirmation dialog to list overridden advisory checks as formatted message string. Include `spec_type` in task creation payload.
- **`src/renderer/src/components/task-workbench/SpecEditor.tsx`** — Wire type button clicks to both `setField('spec', template)` (existing) AND `setSpecType(type)` (new).

### Preload (if needed)
- **`src/preload/index.ts` / `src/preload/index.d.ts`** — Only needed if `workbench:checkSpec` IPC signature changes shape. Currently `checkSpec` takes `{ title, repo, spec }` — adding `specType` to this object is a payload change, not a channel signature change, so preload bridge does NOT need updating (it's a passthrough).

### Tests
- **`src/renderer/src/hooks/__tests__/useReadinessChecks.test.ts`** — Test profile-aware structural checks: Feature profile requires 50 chars + 2 headings; Test profile makes them advisory; null specType defaults to Feature.
- **`src/renderer/src/components/task-workbench/__tests__/WorkbenchActions.test.tsx`** — Test advisory vs required button state: advisory failures don't disable Queue Now, required failures do.
- **`src/shared/__tests__/spec-validation.test.ts`** — Test `getValidationProfile()` returns correct profile per type, null defaults to Feature, `validateStructural()` applies profile thresholds.

## Out of Scope

- Changing operational check logic per type (auth, repo path, git clean stay universal)
- Custom user-defined profiles
- Retroactively assigning `spec_type` to existing tasks
- Agent prompt adjustments based on `spec_type` (future work)
- Queue API support for `spec_type` in PATCH/POST (readable via GET only)
- UI buttons for Performance, UX, Audit, Infra types (available via AI generate only)
