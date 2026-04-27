## ADDED Requirements

### Requirement: Named millisecond-duration constants in shared/time.ts
`src/shared/time.ts` SHALL export `MS_PER_DAY` and `MS_PER_HOUR` as named constants. No data-layer module SHALL contain inline millisecond arithmetic expressions for day or hour durations.

#### Scenario: MS_PER_DAY exported from shared/time.ts
- **WHEN** `import { MS_PER_DAY } from '../../shared/time'` is added to a data module
- **THEN** the value is `86400000` (24 * 60 * 60 * 1000)

#### Scenario: MS_PER_HOUR exported from shared/time.ts
- **WHEN** `import { MS_PER_HOUR } from '../../shared/time'` is added to a data module
- **THEN** the value is `3600000` (60 * 60 * 1000)

### Requirement: sprint-maintenance uses MS_PER_DAY
`sprint-maintenance.ts` SHALL compute the snapshot retention cutoff using `MS_PER_DAY` rather than the inline literal `86400000`.

#### Scenario: Retention cutoff uses named constant
- **WHEN** `pruneDiffSnapshots` is called with a retentionDays argument
- **THEN** the cutoff timestamp is computed as `Date.now() - retentionDays * MS_PER_DAY`
- **THEN** no inline `86400000` literal remains in the module

### Requirement: event-queries uses MS_PER_DAY
`event-queries.ts` SHALL compute the event retention cutoff using `MS_PER_DAY`.

#### Scenario: Event cutoff uses named constant
- **WHEN** the event retention query runs
- **THEN** the inline `24 * 60 * 60 * 1000` expression is replaced by `MS_PER_DAY`

### Requirement: task-changes uses MS_PER_DAY
`task-changes.ts` SHALL compute its audit-record cutoff using `MS_PER_DAY` instead of `86400000`.

#### Scenario: Audit cutoff uses named constant
- **WHEN** `pruneTaskChanges` computes the cutoff date
- **THEN** the expression uses `MS_PER_DAY` not an inline literal

### Requirement: sprint-agent-queries uses MS_PER_HOUR
`sprint-agent-queries.ts` SHALL compute the one-hour-ago lookback using `MS_PER_HOUR` rather than the inline expression `60 * 60 * 1000`.

#### Scenario: Agent health query lookback uses named constant
- **WHEN** the health-check query computes `oneHourAgo`
- **THEN** it is expressed as `Date.now() - MS_PER_HOUR`
- **THEN** no inline `60 * 60 * 1000` literal remains in the module

### Requirement: No magic millisecond literals in data layer
After this change, a grep of `src/main/data/` for the literals `86400000`, `3600000`, `24 * 60 * 60`, and `60 * 60 * 1000` SHALL return zero matches in non-test files.

#### Scenario: Grep returns zero matches
- **WHEN** `grep -rn "86400000\|3600000\|24 \* 60 \* 60\|60 \* 60 \* 1000" src/main/data/` runs against non-test files
- **THEN** the output is empty
