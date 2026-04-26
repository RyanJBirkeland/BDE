## ADDED Requirements

### Requirement: validateAuthStatus is tested for all auth states
The test suite SHALL verify `validateAuthStatus` returns the correct status and message for every auth state branch.

#### Scenario: token not found returns fail
- **WHEN** `checkAuthStatus()` returns `{ tokenFound: false }`
- **THEN** the result is `{ status: 'fail' }` and the message contains `'claude login'`

#### Scenario: token expired returns fail
- **WHEN** `checkAuthStatus()` returns `{ tokenFound: true, tokenExpired: true }`
- **THEN** the result is `{ status: 'fail' }` and the message contains `'expired'`

#### Scenario: token expiring within one hour returns warn
- **WHEN** `checkAuthStatus()` returns `{ tokenFound: true, tokenExpired: false, expiresAt: <now + 30 minutes> }`
- **THEN** the result is `{ status: 'warn' }` and the message contains `'expires in'`

#### Scenario: valid token with no expiry returns pass
- **WHEN** `checkAuthStatus()` returns `{ tokenFound: true, tokenExpired: false }`
- **THEN** the result is `{ status: 'pass' }`

### Requirement: validateRepoPath is tested for configured and unconfigured repos
The test suite SHALL verify `validateRepoPath` returns `fail` when no path is configured and `pass` with the path when one is.

#### Scenario: unconfigured repo returns fail
- **WHEN** `getRepoPath(repo)` returns `undefined`
- **THEN** the result is `{ status: 'fail' }`

#### Scenario: configured repo returns pass with path
- **WHEN** `getRepoPath(repo)` returns `'/projects/bde'`
- **THEN** the result is `{ status: 'pass', path: '/projects/bde' }`

### Requirement: validateGitCleanStatus covers all four branches including git-error silent-warn
The test suite SHALL exercise every branch of `validateGitCleanStatus`, with explicit coverage of the error-catch path that silently degrades to `warn`.

#### Scenario: undefined repoPath returns warn without calling execFileAsync
- **WHEN** `repoPath` argument is `undefined`
- **THEN** the result is `{ status: 'warn' }` and the message contains `'not configured'`
- **THEN** `execFileAsync` is not called

#### Scenario: clean working directory returns pass
- **WHEN** `execFileAsync` resolves with `{ stdout: '' }`
- **THEN** the result is `{ status: 'pass' }`

#### Scenario: uncommitted changes return warn
- **WHEN** `execFileAsync` resolves with `{ stdout: ' M src/foo.ts\n' }`
- **THEN** the result is `{ status: 'warn' }` and the message contains `'Uncommitted'`

#### Scenario: git command throws returns warn with error message
- **WHEN** `execFileAsync` throws with message `'not a git repository'`
- **THEN** the result is `{ status: 'warn' }` and the message contains `'Unable to check'`

### Requirement: validateNoTaskConflicts is tested for all conflict states
The test suite SHALL verify `validateNoTaskConflicts` returns the correct status for zero, active, queued-only, and error scenarios.

#### Scenario: no tasks for repo returns pass
- **WHEN** `listTasks()` returns an empty array
- **THEN** the result is `{ status: 'pass' }`

#### Scenario: active tasks present returns fail
- **WHEN** `listTasks()` returns tasks including one with `status: 'active'` for the repo
- **THEN** the result is `{ status: 'fail' }` and the message contains `'active'`

#### Scenario: only queued tasks returns warn
- **WHEN** `listTasks()` returns tasks including one with `status: 'queued'` for the repo, none active
- **THEN** the result is `{ status: 'warn' }` and the message contains `'queued'`

#### Scenario: listTasks throws returns warn
- **WHEN** `listTasks()` throws
- **THEN** the result is `{ status: 'warn' }` and the message contains `'Error checking'`

### Requirement: assessAgentSlotCapacity is tested for all capacity states
The test suite SHALL verify `assessAgentSlotCapacity` returns the correct status when the agent manager is unavailable, has slots, or is fully occupied.

#### Scenario: undefined agent manager returns warn with zero counts
- **WHEN** `am` argument is `undefined`
- **THEN** the result is `{ status: 'warn', available: 0, max: 0 }`

#### Scenario: slots available returns pass
- **WHEN** `am.getStatus()` returns `{ concurrency: { maxSlots: 2, activeCount: 1 } }`
- **THEN** the result is `{ status: 'pass', available: 1, max: 2 }`

#### Scenario: all slots occupied returns warn
- **WHEN** `am.getStatus()` returns `{ concurrency: { maxSlots: 2, activeCount: 2 } }`
- **THEN** the result is `{ status: 'warn', available: 0, max: 2 }`

### Requirement: runOperationalChecks composes all sub-checks into a combined result
The test suite SHALL verify that `runOperationalChecks` returns a result with the correct shape from all five sub-checks.

#### Scenario: happy path returns all-pass result
- **WHEN** all dependencies return valid/clean values
- **THEN** the result contains `auth`, `repoPath`, `gitClean`, `noConflict`, and `slotsAvailable` keys
- **THEN** each key has a `status` and `message` field
