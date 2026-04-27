## Why

BDE's services, data layer, and pollers pass the full `SprintTask` type (43 fields) at almost every call site, even when callers only need 3–5 fields. This leaks unnecessary coupling across module boundaries and makes interfaces harder to understand. Separately, the data layer still contains inline magic literals — timeouts, limits, and status strings — scattered across modules rather than named constants, in violation of Clean Code's "no magic numbers" rule.

## What Changes

- Replace `SprintTask` parameter/return types with the narrower view types (`SprintTaskCore`, `SprintTaskSpec`, `SprintTaskExecution`, `SprintTaskPR`) at the 10–15 highest-value call sites in services, pollers, and the agent manager
- Extract inline magic numbers and string literals from `sprint-task-crud.ts`, `sprint-queue-ops.ts`, `sprint-pr-ops.ts`, and `sprint-maintenance.ts` into named constants
- Rename two to three data-layer identifiers that use noise words (`Data`, `Info`, `Manager`) or fail the "reveals intent" test from the audit's Phase H4 findings

## Capabilities

### New Capabilities
- `sprint-task-type-narrowing`: narrow view types enforced at data and service layer call boundaries — functions that read/write a subset of task fields declare that subset explicitly via `SprintTaskCore | SprintTaskSpec | SprintTaskExecution | SprintTaskPR`
- `data-layer-named-constants`: all magic literals in the sprint data modules collected into named, documented constants — no inline numbers or bare status strings in data layer logic

### Modified Capabilities
- `service-layer-di-contracts`: narrow view types now flow across the service-layer contract boundaries where applicable (return-type narrowing does not change runtime behavior but tightens the contract)

## Impact

- `src/shared/types/task-types.ts` — source of the four view types; no changes needed here
- `src/main/data/sprint-task-crud.ts`, `sprint-queue-ops.ts`, `sprint-pr-ops.ts`, `sprint-maintenance.ts` — return types and parameter types narrowed; magic literals extracted
- `src/main/services/sprint-service.ts`, `sprint-use-cases.ts` — return types narrowed where functions only produce/consume a subset of fields
- `src/main/agent-manager/drain-loop.ts`, `watchdog-loop.ts`, `task-claimer.ts` — parameter types narrowed in functions that operate on status/claim fields only
- `src/main/sprint-pr-poller.ts` — already returns `SprintTaskPR[]` in places; complete the narrowing
- No runtime behavior changes; type narrowing is purely a TypeScript contract tightening. Tests must still pass, `npm run typecheck` must be green.
