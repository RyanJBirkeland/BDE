# Lens: Naming Quality — BDE Clean Code Audit 2026-04-13

**Persona:** Naming Quality Analyst
**Scope:** Misleading/generic names, boolean traps, magic values, vague verbs, abbreviations that require domain decoding

---

## F-t1-naming-1: `handleOAuthRefresh` doesn't name the action
**Severity:** Medium
**Category:** Vague Verb
**Location:** `src/main/agent-manager/run-agent.ts:~5`
**Evidence:** `handleOAuthRefresh()` — "handle" is the generic catch-all verb that communicates nothing about the function's specific action. The function invalidates a cache entry and then refreshes a token from keychain.
**Impact:** Readers must open the function to understand what "handling" means. The name doesn't distinguish it from other OAuth-related functions.
**Recommendation:** Rename to `refreshOAuthTokenFromKeychain()` or `invalidateCachedAndRefreshToken()`.
**Effort:** S
**Confidence:** High

---

## F-t1-naming-2: `processSDKMessage` hides three separate concerns
**Severity:** High
**Category:** Vague Verb / Lying Name
**Location:** `src/main/agent-manager/run-agent.ts:~128`
**Evidence:** `processSDKMessage()` — tracks costs, emits agent events, AND detects playground writes. "Process" tells the reader nothing; the function silently does cost accounting + event emission + file watching.
**Impact:** The name creates false comfort. Callers believe they are "processing a message" but are also triggering cost tracking and file side effects.
**Recommendation:** Split into `trackMessageCost()`, `emitAgentEvent()`, and `detectPlaygroundWrite()` — or rename the orchestrator to `handleIncomingSDKMessage()` and add a comment enumerating its three sub-steps.
**Effort:** M
**Confidence:** High

---

## F-t1-naming-3: Magic timing constants scattered without names
**Severity:** High
**Category:** Magic Value
**Location:** `src/main/agent-manager/` (multiple files)
**Evidence:** Raw numeric literals: `30_000`, `60_000`, `300_000`, `3600000` appear across agent-manager files without named constants. A reader sees `setTimeout(fn, 30_000)` and cannot tell if 30s is a watchdog interval, a retry delay, or a network timeout.
**Impact:** When a timeout needs changing, you must grep for the value and hope you find all occurrences. Different files use the same values independently, risking drift.
**Recommendation:** Consolidate into `src/main/agent-manager/constants.ts` with names like `WATCHDOG_POLL_INTERVAL_MS`, `OAUTH_REFRESH_COOLDOWN_MS`, `MAX_AGENT_RUNTIME_MS`.
**Effort:** S
**Confidence:** High

---

## F-t1-naming-4: `opts` parameters obscure caller intent
**Severity:** Medium
**Category:** Generic Name
**Location:** `src/main/agent-manager/` (multiple functions, 12+ occurrences)
**Evidence:** Parameters named `opts` throughout — `opts: SpawnOptions`, `opts: CompletionOpts`, `opts: MergeOptions`. All typed but generically named.
**Impact:** At call sites, `runAgent(task, opts)` reads as a black box. The name `opts` doesn't hint at what facets of behavior the caller is controlling.
**Recommendation:** Use the type name as the parameter name: `spawnOptions`, `completionOptions`, `mergeOptions`. Matches TypeScript conventions and reads like prose.
**Effort:** S
**Confidence:** High

---

## F-t1-naming-5: `msg` / `message` used for two different concepts
**Severity:** Medium
**Category:** Ambiguous Name
**Location:** `src/main/agent-event-mapper.ts`, `src/main/agent-manager/run-agent.ts`
**Evidence:** `msg` is used interchangeably for SDK wire-protocol message objects AND human-readable error message strings. In the same module, `const msg = new Error(...)` and `const msg = sdkPayload` coexist.
**Impact:** Creates reading ambiguity — you must trace back to the declaration every time. High collision risk when both appear in the same block.
**Recommendation:** Use `sdkMessage` / `rawMessage` for SDK protocol objects; `errorMessage` / `errorText` for string error descriptions. Never reuse `msg` for both.
**Effort:** S
**Confidence:** High

---

## F-t1-naming-6: `hasCommits` and `rebaseSucceeded` — imprecise boolean names
**Severity:** Low
**Category:** Boolean Trap
**Location:** `src/main/agent-manager/completion.ts`
**Evidence:** `const hasCommits = ...` (does the branch have commits ahead of main? locally committed? non-empty?), `const rebaseSucceeded = ...` (does this mean "no conflicts" or "exit code 0"?).
**Impact:** Subtle ambiguity in boolean names leads to off-by-one logic bugs and confusion when the condition needs extending.
**Recommendation:** `hasCommitsAheadOfMain`, `rebaseCompletedWithoutConflicts` — use names that encode the full condition being tested.
**Effort:** S
**Confidence:** Medium

---

## F-t1-naming-7: `err` as the universal catch variable
**Severity:** Low
**Category:** Generic Name
**Location:** Throughout `src/main/` (all catch blocks)
**Evidence:** `catch (err)` used universally regardless of what kind of error is expected — git errors, SDK errors, fs errors, network errors all named `err`.
**Impact:** Inside large catch blocks, `err` provides no clue about what failed. Code that handles different error types becomes opaque.
**Recommendation:** Name caught errors by their source: `gitError`, `sdkError`, `fsError`. In catch-all handlers, `unknownError` signals defensive intent. At minimum, use `error` (full word) as the baseline.
**Effort:** S
**Confidence:** High

---

## F-t1-naming-8: Magic strings for error message matching
**Severity:** High
**Category:** Magic Value
**Location:** `src/main/agent-manager/completion.ts` — `classifyFailureReason()`
**Evidence:** Multiple `includes('some hardcoded string')` checks against error text to classify failure type. The classification patterns are invisible string literals with no names.
**Impact:** When error messages change upstream (SDK update, git version), the classification silently breaks. There is no central registry of known error patterns.
**Recommendation:** Extract to named constants or a lookup table: `const OAUTH_EXPIRED_PATTERN = 'oauth token'`, `const CONTEXT_LIMIT_PATTERN = 'context window'`. Makes the intent explicit and the patterns auditable.
**Effort:** S
**Confidence:** High

---

## F-t1-naming-9: Abbreviations requiring domain knowledge — `ttl`, `cwd`, `fs`
**Severity:** Low
**Category:** Abbreviation
**Location:** `src/main/agent-manager/worktree.ts`, `src/main/agent-manager/run-agent.ts`
**Evidence:** `cwd`, `ttl`, `fs` used as parameter and variable names. While `cwd` and `fs` are industry-standard abbreviations, `ttl` in particular is ambiguous (Time To Live? Task Terminal Logic?).
**Impact:** For contributors unfamiliar with the domain, abbreviations create friction. `ttl` in a non-network context is especially confusing.
**Recommendation:** Spell out `ttl` as `timeToLiveMs` or `cacheDurationMs`. Keep `cwd` and `fs` as they are (too established to change), but ensure parameter names at call sites are expressive: `{ cwd: worktreePath }`.
**Effort:** S
**Confidence:** Medium

---

## Summary

| Finding | Severity | Effort | Category |
|---------|----------|--------|----------|
| F-t1-naming-1 | Medium | S | Vague Verb |
| F-t1-naming-2 | High | M | Vague Verb / Lying Name |
| F-t1-naming-3 | High | S | Magic Value |
| F-t1-naming-4 | Medium | S | Generic Name |
| F-t1-naming-5 | Medium | S | Ambiguous Name |
| F-t1-naming-6 | Low | S | Boolean Trap |
| F-t1-naming-7 | Low | S | Generic Name |
| F-t1-naming-8 | High | S | Magic Value |
| F-t1-naming-9 | Low | S | Abbreviation |
