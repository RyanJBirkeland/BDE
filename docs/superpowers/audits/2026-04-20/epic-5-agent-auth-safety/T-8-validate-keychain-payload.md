# T-8 · Validate keychain payload at the parse boundary

**Severity:** P1 · **Audit lens:** type-safety

## Context

`src/main/auth-guard.ts:63` does:

```ts
const oauth = JSON.parse(stdout.trim()) as KeychainPayload
```

`stdout` is user/OS-controlled (reads from the macOS Keychain via `security find-generic-password`). The parsed value is `unknown`; casting directly to `KeychainPayload` means every downstream access (`oauth.expiresAt`, `parseInt(...)`) runs against a structurally unverified value. A malformed keychain entry produces `NaN` or undefined access paths the type system claims can't happen.

## Files to Change

- `src/main/auth-guard.ts` (line 63 — replace cast with zod parse)
- `src/main/auth-guard.test.ts` (existing or new — cover the invalid-payload path)

## Implementation

1. Near the top of `auth-guard.ts`, add a zod schema for the keychain payload:

```ts
import { z } from 'zod'

const KeychainPayloadSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  expiresAt: z.union([z.number(), z.string()]).optional(),
  // ...any other fields the existing KeychainPayload type declares
})

export type KeychainPayload = z.infer<typeof KeychainPayloadSchema>
```

Match the existing `KeychainPayload` TypeScript type field-for-field. If fields are unclear, read every access like `oauth.x` downstream and add them to the schema.

2. Replace the cast with a parse:

```ts
const parseResult = KeychainPayloadSchema.safeParse(JSON.parse(stdout.trim()))
if (!parseResult.success) {
  logger.warn(`Keychain payload malformed: ${parseResult.error.message}`)
  return { ok: false, reason: 'malformed-keychain-payload' }
}
const oauth = parseResult.data
```

Use `safeParse` so a malformed payload returns a typed failure result rather than throwing. The existing return-shape of `readToken` should accept `{ ok: false, reason: string }` — if it returns a different shape, match it.

3. Remove the `as KeychainPayload` cast. Keep the existing `KeychainPayload` type as a `z.infer` re-export so downstream consumers don't break.

4. In `auth-guard.test.ts`, add a case that feeds `security` a malformed JSON string (`'not json'` and `'{"accessToken":123}'` — wrong type) and asserts `readToken` returns `{ ok: false, reason: 'malformed-keychain-payload' }` without throwing.

## How to Test

```bash
npm run typecheck
npm run test:main -- auth-guard
npm run lint
```

Manual: temporarily corrupt a test keychain entry (or mock `security` to return garbage) and confirm FLEET logs a warning and proceeds with a clean auth-failure path.

## Acceptance

- `KeychainPayload` is a `z.infer` of the schema.
- `readToken` uses `safeParse` and returns a typed failure on malformed input.
- No `as KeychainPayload` cast remains in `auth-guard.ts`.
- Test covers malformed JSON and malformed field types.
- Full suite green.
