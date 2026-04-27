## ADDED Requirements

### Requirement: operational-checks-service has unit tests for all five check functions
`src/main/services/__tests__/operational-checks-service.test.ts` SHALL exist and cover each exported check function for both pass and fail conditions.

#### Scenario: validateAuthStatus returns pass when token is valid
- **WHEN** `checkAuthStatus` mock returns a valid token
- **THEN** `validateAuthStatus` returns `{ status: 'pass' }`

#### Scenario: validateAuthStatus returns fail when no token found
- **WHEN** `checkAuthStatus` mock returns null
- **THEN** `validateAuthStatus` returns `{ status: 'fail', message: ... }`

#### Scenario: validateRepoPath returns pass when path exists
- **WHEN** `getRepoPath` mock returns a valid path string
- **THEN** `validateRepoPath` returns `{ status: 'pass', path: ... }`

#### Scenario: validateRepoPath returns fail when no repos configured
- **WHEN** `getRepoPath` mock returns null or undefined
- **THEN** `validateRepoPath` returns `{ status: 'fail', message: ... }`

#### Scenario: runOperationalChecks aggregates individual check results
- **WHEN** `runOperationalChecks` is called with mocked dependencies where one check passes and one fails
- **THEN** the returned result includes both check outcomes; the overall status reflects the worst individual status

#### Scenario: runOperationalChecks returns all-pass when all checks pass
- **WHEN** all mocked dependencies return success values
- **THEN** `runOperationalChecks` returns a result where every check has `status: 'pass'` or `status: 'warn'`

---

### Requirement: promoteAdhocAgent has unit tests covering the happy path and error branches
`src/main/services/__tests__/adhoc-promotion-service.test.ts` SHALL exist and cover `promoteAdhocAgent`.

#### Scenario: Happy path creates a review sprint task and returns ok: true
- **WHEN** `execFileAsync` mock returns a valid git log output (at least one commit), and `createReviewTaskFromAdhoc` mock resolves successfully
- **THEN** `promoteAdhocAgent` resolves with `{ ok: true }` and `createReviewTaskFromAdhoc` is called once

#### Scenario: Returns ok: false with reason when no commits exist in the worktree
- **WHEN** `execFileAsync` mock returns empty git log output (zero commits)
- **THEN** `promoteAdhocAgent` resolves with `{ ok: false, reason: ... }` and `createReviewTaskFromAdhoc` is NOT called

#### Scenario: Returns ok: false with reason when worktree path does not exist
- **WHEN** the agent's `worktreePath` is null or the path does not exist on disk
- **THEN** `promoteAdhocAgent` resolves with `{ ok: false, reason: ... }` without calling `createReviewTaskFromAdhoc`

#### Scenario: Propagates or wraps createReviewTaskFromAdhoc failure
- **WHEN** `createReviewTaskFromAdhoc` rejects with an error
- **THEN** `promoteAdhocAgent` resolves with `{ ok: false, reason: ... }` — it does not let the error propagate unhandled
