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

### Profile Matrix

| Check | Feature | Bug Fix | Refactor | Test | Performance | UX | Audit | Infra |
|-------|---------|---------|----------|------|-------------|-----|-------|-------|
| `spec-present` | required (50) | required (50) | required (30) | advisory (20) | required (50) | required (50) | advisory (20) | advisory (20) |
| `spec-structure` | required (2) | required (2) | advisory (1) | skip | required (2) | required (2) | skip | skip |
| `clarity` | required | required | required | advisory | required | required | advisory | advisory |
| `scope` | required | required | advisory | skip | required | required | skip | skip |
| `filesExist` | required | required | advisory | skip | advisory | advisory | skip | skip |

Numbers in parentheses are thresholds — `spec-present` threshold is min character count, `spec-structure` threshold is min heading count.

### Operational Checks (Unchanged)

Auth, Repo Path, Git Clean, No Conflict, and Agent Slots remain identical across all types. These validate the runtime environment, not spec quality.

## Override Flow

When the user clicks **Queue Now** and advisory checks have failures:

1. Existing confirmation dialog appears
2. Dialog lists each overridden check with its status and message
3. User confirms to queue anyway, or cancels to revise

This reuses the existing `useConfirm` pattern — no new UI components needed.

**canQueue logic change:**
- Current: `allTier1Pass && !tier3HasFails`
- New: `allRequiredTier1Pass && !tier3HasFails` (advisory failures don't block, but trigger confirmation)

## Data Model: `spec_type` Column

### Migration

Add to `sprint_tasks` table:

```sql
ALTER TABLE sprint_tasks ADD COLUMN spec_type TEXT;
```

Nullable, defaults to null for existing tasks. Valid values: `feature`, `bugfix`, `refactor`, `test`, `performance`, `ux`, `audit`, `infra`.

### Downstream Uses

- Task Pipeline can show type badges on task pills
- Agent manager could adjust prompt strategy per type
- Filtering/reporting by task type

## Files to Change

### Shared Layer
- **`src/shared/spec-validation.ts`** — Define `SpecType` union, `ValidationProfile` interface, `VALIDATION_PROFILES` map, `getValidationProfile(type)` function. Update `validateStructural()` to accept optional `specType` param and apply profile thresholds.

### Main Process
- **`src/main/db.ts`** — Add migration (next version) for `spec_type TEXT` column on `sprint_tasks`.
- **`src/main/data/sprint-queries.ts`** — Map `spec_type` field in CRUD operations (camelCase ↔ snake_case).
- **`src/main/spec-semantic-check.ts`** — Accept `specType` param in `checkSpecSemantic()`. Skip checks marked `skip` in profile. Pass `specType` context to AI prompt so it grades contextually.
- **`src/main/handlers/workbench.ts`** — Thread `specType` through `workbench:checkSpec` handler.

### Renderer
- **`src/renderer/src/stores/taskWorkbench.ts`** — Add `specType: SpecType | null` to store state. Set when user clicks a spec type button.
- **`src/renderer/src/hooks/useReadinessChecks.ts`** — Accept `specType` from store, pass to `computeStructuralChecks()`. Apply profile to determine check status (required fail → `fail`, advisory fail → `warn`, skip → omit).
- **`src/renderer/src/components/task-workbench/WorkbenchActions.tsx`** — Update `canQueue` to distinguish required vs advisory failures. Advisory failures don't disable the button but trigger confirmation dialog.
- **`src/renderer/src/components/task-workbench/WorkbenchForm.tsx`** — Pass `specType` to semantic check IPC call. Update confirmation dialog to list overridden advisory checks. Include `spec_type` in task creation payload.
- **`src/renderer/src/components/task-workbench/SpecEditor.tsx`** — Wire type button clicks to store's `setSpecType()`.

### Tests
- **`src/renderer/src/hooks/__tests__/useReadinessChecks.test.ts`** — Test profile-aware structural checks for each type.
- **`src/renderer/src/components/task-workbench/__tests__/WorkbenchActions.test.tsx`** — Test advisory vs required button state logic.
- **`src/shared/__tests__/spec-validation.test.ts`** — Test `getValidationProfile()`, `validateStructural()` with spec types.

## Out of Scope

- Changing operational check logic per type (auth, repo path, git clean stay universal)
- Custom user-defined profiles
- Retroactively assigning `spec_type` to existing tasks
- Agent prompt adjustments based on `spec_type` (future work)
