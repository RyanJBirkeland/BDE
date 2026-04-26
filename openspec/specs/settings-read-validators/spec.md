## ADDED Requirements

### Requirement: Structured getSettingJson call sites supply validators
Every call to `getSettingJson<T>` that reads a structured (non-primitive) value SHALL pass a validator argument. Call sites in `src/main/index.ts` (repos, panel layout, maxConcurrent) and `src/main/lib/paths.ts` (active files) MUST be updated. The validator SHALL be an `(value: unknown) => value is T` type guard. On validation failure the function SHALL return `null` (same as key-not-found) and log a warning.

#### Scenario: Structured setting passes validator and is returned
- **WHEN** `getSettingJson('repos', isRepoArray)` reads a valid repos array
- **THEN** the typed `RepoConfig[]` value is returned

#### Scenario: Structured setting fails validator returns null
- **WHEN** `getSettingJson('repos', isRepoArray)` reads a malformed value (e.g. an object instead of an array)
- **THEN** a warning is logged with the key and a description of the failure; `null` is returned; the caller's fallback is used

#### Scenario: Primitive setting without validator continues to work
- **WHEN** `getSettingJson<string>('theme')` is called without a validator
- **THEN** the function behaves as before; no warning is emitted for primitive keys

---

### Requirement: QueueStats indexing validates row.status membership
`sprint-agent-queries.ts` SHALL check that `row.status` is a known key of `QueueStats` before indexing. Unknown status values SHALL be counted in an `unknown` overflow counter or skipped with a warning. Dashboard metrics MUST NOT be corrupted by unknown status values.

#### Scenario: Known status increments correct counter
- **WHEN** the query returns a row with `status: 'queued'`
- **THEN** `stats.queued` is incremented correctly

#### Scenario: Unknown status does not corrupt counts
- **WHEN** the query returns a row with `status: 'future_status'`
- **THEN** a warning is logged; `stats.queued`, `stats.active`, etc. are unaffected
