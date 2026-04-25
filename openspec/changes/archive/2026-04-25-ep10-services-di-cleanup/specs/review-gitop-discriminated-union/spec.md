## ADDED Requirements

### Requirement: Review git-op plan is a discriminated union
The system SHALL represent the review git-op plan as a TypeScript discriminated union type. The executor SHALL use an exhaustive switch so adding a new variant without handling it produces a compile error.

#### Scenario: Unhandled variant causes TypeScript error
- **WHEN** a new `ReviewGitOp` variant is added to the union
- **THEN** `tsc` reports an error at the exhaustive switch until the variant is handled

### Requirement: Sprint mutations use constructor-injected repository
The system SHALL NOT capture `getSharedSprintTaskRepository()` at module load time in `sprint-mutations.ts`. The repository SHALL be passed as a constructor or factory parameter.

#### Scenario: Repo available before mutations used
- **WHEN** `createSprintMutations({ repo })` is called with a fully-initialized repository
- **THEN** all mutations operate on that repository instance, not a stale module-load capture
