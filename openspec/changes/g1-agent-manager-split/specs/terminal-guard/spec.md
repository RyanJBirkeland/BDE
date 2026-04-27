## ADDED Requirements

### Requirement: TerminalGuard owns the terminal-call idempotency map
`TerminalGuard` SHALL be a class in `src/main/agent-manager/terminal-guard.ts` that is the single owner of the `taskId → Promise<void>` map used to deduplicate concurrent `onTaskTerminal` calls for the same task. `AgentManagerImpl` SHALL hold one `TerminalGuard` instance and SHALL NOT declare the `_terminalCalled` map directly.

#### Scenario: First terminal call executes the handler
- **WHEN** `terminalGuard.guardedCall(taskId, fn)` is invoked for a task with no in-flight call
- **THEN** `fn()` is executed and the returned promise is stored in the guard map for the duration of the call

#### Scenario: Duplicate concurrent terminal call receives same promise
- **WHEN** `terminalGuard.guardedCall(taskId, fn)` is called a second time while the first call for the same `taskId` is still in-flight
- **THEN** the second caller receives the same in-flight promise without invoking `fn` a second time

#### Scenario: Guard entry cleaned up after completion
- **WHEN** the in-flight promise for `taskId` resolves or rejects
- **THEN** the guard map entry for `taskId` is deleted in a `finally` block so subsequent calls for the same task can execute

#### Scenario: Independent tasks do not interfere
- **WHEN** `guardedCall` is invoked concurrently for two different task IDs
- **THEN** both calls proceed independently and their guard entries are independent

### Requirement: TerminalGuard exposes a single guardedCall method
`TerminalGuard` SHALL expose exactly one public method: `guardedCall(taskId: string, fn: () => Promise<void>): Promise<void>`. It SHALL NOT expose the internal map.

#### Scenario: guardedCall signature matches usage in onTaskTerminal
- **WHEN** `AgentManagerImpl.onTaskTerminal` delegates to `TerminalGuard`
- **THEN** the call reads `return this.terminalGuard.guardedCall(taskId, () => handleTaskTerminal(...))`

#### Scenario: TerminalGuard internal map not accessible from tests
- **WHEN** a test needs to verify the idempotency behavior
- **THEN** the test calls `guardedCall` twice for the same taskId and observes that only one terminal handler execution occurs, rather than accessing the internal map directly
