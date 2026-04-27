## Context

All eight changes are surgically scoped to their source files. No shared abstractions are introduced and no cross-cutting refactors are required. The two callers of `decryptSetting` (`settings.ts` and `webhook-queries.ts`) are the only downstream files that need updating as a result of the T-48 signature change — every other fix is self-contained.

Tests follow established codebase patterns: vitest + `vi.mock` for Electron and Node built-ins, `vi.hoisted` for mock factories, and `vi.spyOn` for per-test overrides of module-level mocks.

## Goals / Non-Goals

**Goals:**
- Every fix eliminates the identified vulnerability without introducing new ones.
- Each fix is independently reviewable and independently deployable.
- All changes leave the existing test suite green.
- Each modified module gains at least one new test that would have caught the original finding.

**Non-Goals:**
- Achieving 100% branch coverage of modified files.
- Refactoring code beyond what is required to implement the fix.
- Adding UI error surfaces for `EncryptionUnavailableError` beyond what already exists in the webhook form's generic error handler.

## Decisions

### Decision 1: `decryptSetting` returns `string | undefined`, not `string | null`

`undefined` is the TypeScript idiom for "absent value" when no explicit null contract exists. The existing callers (`settings.ts`, `webhook-queries.ts`) already use `| null` for their own return types, so both will convert `undefined` to `null` at the call site — the choice does not leak outward. Using `undefined` makes the intent ("nothing to return") clearer than `null` ("deliberate empty value").

**Alternative considered:** Return `null`. Rejected — `null` implies a deliberate empty result; `undefined` implies absence due to failure, which is more accurate here.

### Decision 2: `EncryptionUnavailableError` is defined inline in `webhook-queries.ts`, not in `secure-storage.ts`

The error represents a policy decision at the storage layer ("we refuse to store this without encryption"), not a generic encryption capability signal. Defining it in `webhook-queries.ts` keeps the policy co-located with the enforcement point. If a future caller needs the same policy, the class can be promoted to `secure-storage.ts` at that time.

**Alternative considered:** Define in `secure-storage.ts` and export. Rejected — premature promotion; only one caller currently needs it.

### Decision 3: `getOAuthToken()` re-stats on every call, not every N calls

The TTL exists to avoid disk I/O on every agent spawn during a burst. A single `lstatSync` call is cheap (it does not read file content); the cost is negligible compared to the permission-bypass window it closes. Introducing a separate "permission TTL" shorter than the token TTL would add complexity with no meaningful benefit.

**Alternative considered:** Check permissions only when the TTL expires (existing behaviour). Rejected — the audit finding is specifically about the window between TTL refresh and permission change.

### Decision 4: `validateWebhookUrl()` uses `net.isIPv4()` / `net.isIPv6()` from Node's built-in `net` module

Node's `net` module is already available in the main process and has no additional cost. The `net.isIPv4(hostname)` function handles all valid IPv4 representations that the WHATWG URL parser would produce (dotted decimal only — the parser normalises octal/decimal/hex before `parsed.hostname` is populated). The regex bypass vectors (`0177.0.0.1`, `2130706433`) rely on the fact that the WHATWG URL parser does NOT normalise these to dotted-decimal for hostname-type URLs — they are treated as opaque hostnames and the regex matches `177` and `2130706433` as valid octets/integers. Using `net.isIPv4()` on the raw `parsed.hostname` string closes the numeric-literal bypass cleanly.

**Alternative considered:** Add more cases to the existing regex. Rejected — regex-based IP validation is brittle; the bugs exist because the regex approach is fundamentally incomplete.

### Decision 5: `generateAndWrite()` in `token-store.ts` returns `string` from the re-read path on EEXIST

The simplest correct fix is: when `writeExclusive` returns `false` (EEXIST), attempt `readFile` + `isWellFormedToken`. If valid, return that token. If not valid or unreadable, fall through to `overwriteWithMode`. This avoids changing the return type of `generateAndWrite` and keeps the function's contract ("returns the token that is now on disk") unchanged.

**Alternative considered:** Restructure `readOrCreateToken` to not call `generateAndWrite` at all in the corrupt-file path, handling the EEXIST race in the caller. Rejected — more invasive refactor for a narrow race condition.

### Decision 6: `allowedHosts` / `allowedOriginsFor` extend, not replace

The IPv6 additions are purely additive — existing IPv4 loopback entries remain. This is the minimal change to close the gap without risking regressions for clients already connected via IPv4.

### Decision 7: T-28 adds tests to `parseBearerToken` describe block with short token strings

The `parseBearerToken` function is the canonical place to document the whitespace-trim contract because it is the function that implements it. The existing `checkBearerAuth` tests at lines 72–75 use the 64-char production-length token; the new `parseBearerToken` tests use `"token123"` (8 chars) to make the trim behaviour visually obvious to any reader of the test.

## Risks / Trade-offs

- **T-48 signature change propagates to two callers.** `settings.ts` and `webhook-queries.ts` both call `decryptSetting`. Both are in this epic's scope and are updated atomically. No other callers exist (confirmed by grep). Risk: low.

- **T-36 breaks webhook creation on systems without `safeStorage`.** Any environment where `isEncryptionAvailable()` returns `false` (headless CI, non-macOS) will now get an error when creating a webhook with a secret. This is the intended behaviour — the alternative (silently storing the plaintext) is worse. Risk: acceptable. Mitigation: the webhook form's existing error handler surfaces the message to the user.

- **T-24 adds an `lstatSync` call on every `getOAuthToken()` invocation.** `lstatSync` is a blocking syscall. During a burst of agent spawns this is called once per spawn attempt. Measured cost on macOS is <1ms per call; total overhead is negligible relative to spawn latency (~200ms). Risk: negligible.

- **T-20 `.strict()` may reject future keychain payloads** if the Claude SDK adds new fields to the keychain entry. In that case the credential-store will treat the entry as absent, falling back to the file-based token. The correct fix is then to update the schema — not to revert to `.passthrough()`. Risk: low; Claude SDK keychain schema is stable.
