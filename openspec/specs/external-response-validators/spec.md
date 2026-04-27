## ADDED Requirements

### Requirement: OAuth refresh response is validated before use
`env-utils.ts` SHALL validate the result of `await response.json()` with an `isRefreshResponse` type guard before assigning to `RefreshResponse`. If the guard fails, the function SHALL throw a descriptive error identifying which fields were missing or wrong-typed.

#### Scenario: Valid refresh response is used
- **WHEN** the OAuth endpoint returns a response with `access_token` and `refresh_token` as strings
- **THEN** `isRefreshResponse` returns true and the token refresh completes normally

#### Scenario: Invalid refresh response throws
- **WHEN** the OAuth endpoint returns a response body that is missing `access_token`
- **THEN** `isRefreshResponse` returns false; a descriptive error is thrown; the caller receives an auth failure

---

### Requirement: Paginated GitHub API responses are validated per caller's type
`github-fetch.ts` SHALL expose a `validate` parameter on its paginated fetch helpers. Callers that access specific fields MUST supply an `isT(item: unknown): item is T` guard. Items failing the guard SHALL be logged and excluded from the result; an all-items-invalid result SHALL throw rather than return an empty array silently.

#### Scenario: All items pass validation
- **WHEN** the GitHub API returns an array where every item satisfies the caller-supplied guard
- **THEN** the full typed array is returned to the caller

#### Scenario: Partial validation failure filters invalid items
- **WHEN** one item in the response fails the guard
- **THEN** a warning is logged with the item index; the remaining valid items are returned

#### Scenario: All items fail validation throws
- **WHEN** every item in the response fails the guard (e.g. unexpected API error response shape)
- **THEN** an error is thrown identifying the endpoint and the failure reason

---

### Requirement: agent-message-classifier uses type guards instead of as-casts
`agent-message-classifier.ts` SHALL replace `msg.type as string | undefined`, `msg.message as Record<string, unknown>`, and `block as Record<string, unknown>` with type-narrowing guard functions (`isSdkMessage`, `isContentBlock`). The `contentBlock.input` field SHALL be validated for shape before being assigned to `AgentEvent.input`.

#### Scenario: Well-formed SDK message is classified correctly
- **WHEN** the classifier receives a valid SDK wire message with a known `type`
- **THEN** it returns the correct `AgentEvent` classification with all fields populated

#### Scenario: Malformed SDK message is handled gracefully
- **WHEN** the classifier receives a message where `type` is undefined or `content` is missing
- **THEN** a type guard returns false; the message is classified as `unknown` or skipped; no runtime crash occurs
