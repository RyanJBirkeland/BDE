# Extract Dev Playground HTML sanitization into a shared module

## Problem

Dev Playground HTML is broadcast to the renderer via two paths:

1. `src/main/handlers/playground-handlers.ts:55-70` — the manual `playground:show` IPC handler reads the file with `readFile()` and broadcasts the **raw** HTML. There is no DOMPurify call.
2. `src/main/agent-manager/run-agent.ts:136-137` — the auto-detect path used by pipeline agents calls `purify.sanitize(rawHtml)` before broadcasting.

Both paths broadcast on the same `agent:event` channel and the renderer iframe uses `sandbox="allow-scripts"`. An `allow-scripts` iframe + unsanitized payload is exactly the threat model DOMPurify exists to defeat. This is a real XSS vector. Bravo Architectural Engineer flagged it as CRITICAL.

## Solution

Create `src/main/playground-sanitize.ts` exporting one function:

```ts
export function sanitizePlaygroundHtml(rawHtml: string): string
```

The function uses DOMPurify (already a dependency — see `run-agent.ts` for the existing import pattern) to strip `<script>` tags, event handlers (`onclick`, `onerror`, etc.), and `javascript:` URLs. Use the same DOMPurify configuration that `run-agent.ts` currently uses inline.

Then call this helper from BOTH broadcast paths:

- `playground-handlers.ts:55` — wrap the `readFile` result before assigning to the event payload
- `run-agent.ts:136-137` — replace the inline `purify.sanitize` call with `sanitizePlaygroundHtml`

## Files to Change

- `src/main/playground-sanitize.ts` — NEW file, ~15 lines
- `src/main/handlers/playground-handlers.ts` — import the helper, sanitize before broadcast
- `src/main/agent-manager/run-agent.ts` — replace the inline DOMPurify call with the helper

## How to Test

1. Add `src/main/__tests__/playground-sanitize.test.ts` with at least three assertions:
   - `sanitizePlaygroundHtml('<script>alert(1)</script>')` returns a string with no `<script` substring
   - `sanitizePlaygroundHtml('<a href="javascript:alert(1)">x</a>')` returns a string with no `javascript:` substring
   - `sanitizePlaygroundHtml('<button onclick="x()">y</button>')` returns a string with no `onclick=` substring
2. `npm run test:main` — new test must pass
3. `npm run typecheck`, `npm test`, `npm run lint` — must all pass
4. `grep -n "purify.sanitize\|readFile.*html" src/main/` — confirm both call sites now go through `sanitizePlaygroundHtml`

## Out of Scope

- Changing the iframe sandbox attributes in the renderer
- Adding new playground features
- Modifying the `playground:show` IPC contract or arguments
