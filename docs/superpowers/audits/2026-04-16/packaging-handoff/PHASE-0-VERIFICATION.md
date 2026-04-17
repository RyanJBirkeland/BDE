# Phase 0 Verification Memo

**Date:** 2026-04-16
**Branch:** `audit/packaging-handoff-2026-04-16`
**Method:** Code inspection on branch HEAD. Verifications that require a packaged DMG run are flagged as such — a follow-up smoke test on the next built DMG should close them.

## Summary

| ID   | Gates                          | Result      |
|------|--------------------------------|-------------|
| V0.1 | T4.1 (CSP `wasm-unsafe-eval`)  | not-needed  |
| V0.2 | T4.4 (mic/cam/bluetooth plist) | confirmed   |
| V0.3 | T4.4 (NSAppleEvents plist)     | not-needed  |
| V0.4 | T3.4 / T3.6 scope              | partial     |
| V0.5 | T1.3 `asarUnpack` line-item    | not-needed  |
| V0.6 | T2.2 pre-spawn re-check        | partial     |

---

## V0.1 — CSP `wasm-unsafe-eval` requirement for Monaco

**Gates:** T4.1 (`src/main/bootstrap.ts` CSP edit — F-t3-prod-paths-1).
**Result:** **not-needed**

**Evidence:**
- `src/` has zero matches for `\.wasm` or `WebAssembly`.
- `package-lock.json` contains zero `.wasm` references.
- Monaco editor v0.55.1 (`package.json:52`) is pure JavaScript; workers (`worker-src 'self' blob:`) are JS-only.
- Monaco is loaded via Vite-bundled ESM (`EditorPane.tsx:10`: `import('monaco-editor')`), not a CDN, so no external WASM fetch is possible.

**Recommendation:**
- **Do not** execute T4.1 on this evidence alone.
- Before the next release, run a packaged-DMG smoke test: open IDE view, open a `.ts` file, exercise syntax highlight + Cmd+P + Cmd+F, watch DevTools console for CSP violations. If any violation appears, revisit and add `wasm-unsafe-eval` to the prod `script-src`.

---

## V0.2 — mic/cam/bluetooth plist keys describe real features

**Gates:** T4.4 (`electron-builder.yml mac.extendInfo` — F-t1-builder-2).
**Result:** **confirmed (no usage)**

**Evidence:**
- `grep -r "desktopCapturer|getUserMedia|AudioContext|navigator.mediaDevices|navigator.bluetooth"` across `src/` returns zero matches.
- `electron-builder.yml` contains **no** `NSMicrophoneUsageDescription`, `NSCameraUsageDescription`, `NSAudioCaptureUsageDescription`, or `NSBluetoothAlwaysUsageDescription` keys.
- The audit's claim that these keys exist in the **built** Info.plist is plausible — Electron's default `Info.plist` template auto-populates them.

**Fix path (different from PLAN.md T4.4):**
- Nothing to remove from `electron-builder.yml` — the keys aren't there.
- To suppress the Electron-default keys in the built Info.plist, add explicit null overrides under `mac.extendInfo`:
  ```yaml
  mac:
    extendInfo:
      NSMicrophoneUsageDescription: null
      NSCameraUsageDescription: null
      NSBluetoothAlwaysUsageDescription: null
      NSAudioCaptureUsageDescription: null
  ```
  Or accept the default keys as harmless dead metadata (they're merely descriptions shown in TCC prompts — if BDE never triggers the underlying API, no prompt ever appears).

**Recommendation:** Low priority. Fold into T1.3 (same file) if done. Otherwise defer — there is no security or functional impact.

---

## V0.3 — `NSAppleEventsUsageDescription` for spawned `gh` CLI

**Gates:** T4.4 (`electron-builder.yml mac.extendInfo` — F-t2-gatekeeper-4).
**Result:** **not-needed**

**Evidence:**
- `grep` across `src/` for `osascript|AppleScript|tell application|NSAppleScript` returns zero matches.
- All `gh` invocations use `execFileAsync('gh', [...])` (direct process spawn, not Apple Events). Call sites: `src/main/services/review-pr-service.ts:59`, `src/main/handlers/repo-discovery.ts:109`, `src/main/handlers/auth-handlers.ts:20,24`, `src/main/agent-manager/pr-operations.ts:99,152`.
- `gh` itself accesses macOS Keychain via `security(1)`, not Apple Events.
- The finding's own confidence is Medium with the caveat "only relevant if spawned tools use Apple Events."

**Recommendation:** Do **not** add `NSAppleEventsUsageDescription`. Skip the T4.4 line-item for this key.

---

## V0.4 — Two-layer onboarding flow behavior

**Gates:** T3.4 (onboarding test coverage) / T3.6 (welcome tour) — F-t2-onboarding-1.
**Result:** **partial (confusing, not broken)**

**Evidence (code inspection, `src/renderer/src/App.tsx:201-214`):**
1. First launch: `onboarding.completed` setting is falsy → `useOnboardingCheck()` returns `true` → `OnboardingWizard` renders. On completion it writes `onboarding.completed = 'true'` and reloads.
2. Post-wizard (and every subsequent launch): `showOnboarding` is `false` → falls through to `if (!ready) return <Onboarding />`.
3. `Onboarding.tsx:113-248` re-runs Claude CLI + token + git + repos checks on every launch; calls `onReady()` (local state) only when all required checks pass.

**Behavior confirmed:**
- Does **not** infinite-loop.
- Does **not** trap users in the wizard (it only runs once).
- **Does** present two different UIs back-to-back on first launch (wizard with its own step checks, then `Onboarding` with overlapping checks).
- **Does** block every-launch re-entry on the `Onboarding` check screen if any required check fails — this is the real blocker and is captured separately as F-t2-onboarding-2 ("Continue Anyway" trap).

**Recommendation:**
- **T3.6 (WelcomeTour)** — proceed as a separate small task. Do not fold into a full consolidation.
- **F-t2-onboarding-1 consolidation** — downgrade to cosmetic/maintainability. Not ship-blocking. Defer to Phase 6.
- **T1.4 (Critical)** — the real onboarding blocker is the "Continue Anyway" disabled-when-failed trap. Keep as Phase 1 ship-blocker.

---

## V0.5 — `asarUnpack` auto-detection robustness

**Gates:** T1.3 `asarUnpack` line-item (F-t1-builder-3, F-t1-native-2).
**Result:** **not-needed (for shipping)**

**Evidence:**
- F-t1-builder-3's own evidence: "The app.asar (162M) is built with automatic unpacking of native modules (better-sqlite3: 21M, node-pty: 2.8M, @anthropic-ai/claude-agent-sdk: 49M totaling 89M unpacked)." Auto-detection currently works and produces a correct bundle.
- The recommendation is defensive ("future builds may fail silently if asarUnpack rules change").

**Recommendation:**
- **Skip** the explicit `asarUnpack` block from T1.3 as a shipping requirement.
- **Optional** defensive-hardening pass in a later cleanup wave — one-line yml addition, low risk, low reward.

---

## V0.6 — OAuth token expiry race window

**Gates:** T2.2 pre-spawn validation line-item (F-t3-credentials-9).
**Result:** **partial (narrow race, asymmetric coverage)**

**Evidence:**
- `checkOAuthToken` (`src/main/agent-manager/oauth-checker.ts`) caches success for 5min, failure for 30s, and proactively refreshes from Keychain if the token file is >45min old (Claude tokens expire at ~60min).
- **Adhoc spawn path already re-refreshes:** `src/main/adhoc-agent.ts:93` calls `refreshOAuthTokenFromKeychain()` before every adhoc spawn.
- **Mid-stream auth-error recovery exists:** `src/main/agent-manager/message-consumer.ts:29-44` calls `invalidateOAuthToken()` + `refreshOAuthTokenFromKeychain()` on auth failure.
- **Pipeline spawn path does not re-refresh:** `run-agent.ts` → `spawn-and-wire.ts` → `spawnWithTimeout` goes straight from drain-loop's cached token check to the SDK/CLI spawn, across a window that includes `validateTaskForRun` + `assembleRunContext` (can include `git fetch`) + spawn setup. Realistically 2-20s per task, but up to 5min possible under the drain-loop cache.

**Recommendation:**
- The race is real but the proactive 45-min refresh in `checkOAuthToken` covers the common case.
- **Minor fix:** mirror the adhoc pattern — add a `refreshOAuthTokenFromKeychain()` call in `spawn-and-wire.ts` immediately before `spawnWithTimeout`. One-liner, matches existing pattern, closes the gap.
- Keep within T2.2 but treat as a defensive addition, not a critical refactor.

---

## Impact on Phases 1–4

Updates to apply to PLAN.md conditional items:

| PLAN item                                     | Adjustment                                                              |
|-----------------------------------------------|-------------------------------------------------------------------------|
| T1.3 — explicit `asarUnpack` block            | **Drop** from shipping scope. Optional defensive hardening.             |
| T3.4 — onboarding test coverage               | Proceed as written. No scope change.                                    |
| T3.6 — consolidation fork                     | **Do not fold** into a full rewrite. Keep as standalone WelcomeTour.    |
| T4.1 — CSP `wasm-unsafe-eval`                 | **Skip** unless packaged-DMG smoke test finds a CSP violation.          |
| T4.4 — plist extendInfo overrides             | Drop `NSAppleEventsUsageDescription`. Mic/cam/bluetooth suppression is low-priority cosmetic; not critical. |
| T2.2 — pre-spawn token re-check               | Keep, but as a one-liner mirroring adhoc. Not a critical refactor driver. |

## Remaining work that needs a built DMG

- V0.1 confirmation: packaged IDE smoke test for CSP violations.
- General post-build validation on a clean arm64 Mac to confirm better-sqlite3 + node-pty load correctly (covers V0.5 in practice).

Queue these as a smoke-test pass once Phase 1 T1.2 (native rebuild pipeline) has landed and a fresh DMG exists.
