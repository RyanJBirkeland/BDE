# Packaging & Handoff Audit Synthesis — 2026-04-16

**Scope:** Synthesis of 9 lens reports on BDE's macOS packaging, first-launch UX, and production runtime readiness.

---

## 1. Executive Summary

BDE's packaging foundation is **structurally sound but not distribution-ready**. The build pipeline correctly produces an arm64 DMG with properly-unpacked native modules, ASAR paths resolve cleanly in production, migrations are statically bundled via `import.meta.glob()`, the startup sequence is defensive (chmod 0o700 enforcement, migration version validation, graceful fallbacks), and the IPC surface has 100% handler coverage. The ASAR-paths lens found zero real issues and the bootstrap lens found only 1 medium and 14 informational items. The app does the hard things right.

However, the **distribution story collapses at the first-launch boundary**. The app ships unsigned with `identity: null`, `hardenedRuntime: false`, and `gatekeeperAssess: false` — a fresh Mac user gets a "developer cannot be verified" dialog with no workaround shown in-app, and the right-click→Open guidance is buried in the README. Compounding this, the onboarding UI has a critical "Continue Anyway" trap (button is disabled exactly when the user needs to override), two parallel onboarding layers confuse the path, and the OAuth token handling has at least three chances for silent spawn failure (missing token bypasses Keychain refresh, null tokens pass through to SDK/CLI, no pre-spawn re-check). The production build script also lacks `electron-rebuild`, creating latent ABI-141-vs-140 mismatch risk that only bites when the build machine's Node version drifts.

**Headline: 62 ranked findings, 4 critical, 11 high, 18 medium, 29 low; 8 quick wins (score ≥ 6.0, effort S).** Most shipping risk concentrates in three areas: (a) the Gatekeeper/signing story, (b) the credential/token handoff, and (c) a handful of bootstrap hardening items that are quick to fix.

---

## 2. Top 10 Ranked Actions

| Rank | ID | Title | Severity | Effort | Confidence | Score | Team/Lens |
|------|----|-------|----------|--------|-----------|-------|-----------|
| 1 | F-t3-credentials-3 | Null OAuth token passes through to spawn — silent CLI failure | Critical | M | High | 6.0 | T3/credentials |
| 2 | F-t1-native-1 | Production build script does not invoke electron-rebuild (ABI mismatch) | Critical | S | High | 12.0 | T1/native |
| 3 | F-t1-native-3 | Electron 39 ABI 140 vs system Node 141 mismatch at rebuild time | Critical | S | High | 12.0 | T1/native |
| 4 | F-t2-gatekeeper-1 | Unsigned app blocks on first launch with no in-app guidance | Critical | S | High | 12.0 | T2/gatekeeper |
| 5 | F-t2-onboarding-2 | "Continue Anyway" button disabled exactly when user needs to override | Critical | S | High | 12.0 | T2/onboarding |
| 6 | F-t3-ipc-surface-001 | Missing preload listener for `sprint:mutation` broadcast | Critical | S | High | 12.0 | T3/ipc-surface |
| 7 | F-t3-credentials-2 | OAuth file missing bypasses Keychain refresh fallback | High | S | High | 9.0 | T3/credentials |
| 8 | F-t1-builder-1 | Missing afterSign hook (scripts/after-sign.sh exists but unused) | High | S | High | 9.0 | T1/builder |
| 9 | F-t1-native-5 | node-pty rebuild targets system Node, not Electron | High | S | High | 9.0 | T1/native |
| 10 | F-t3-ipc-surface-002 | Missing preload listener for `agent-manager:circuit-breaker-open` | High | S | High | 9.0 | T3/ipc-surface |

**Scoring notes.** F-t3-credentials-3 rates Critical × High / M = 6.0 because the fix requires coordinated changes in `env-utils.ts` and both `spawn-sdk.ts` / `spawn-cli.ts`, but the per-site check itself is small. F-t1-native-1 and F-t1-native-3 are grouped in practice — both are solved by the same one-line package.json change. Ties above are broken by severity, then effort.

---

## 3. Cross-Cutting Themes

1. **Signing & Gatekeeper UX is the single biggest first-launch risk.** Appears in L1.1 (F-t1-builder-1, -2, -7, -9, -10), L2.3 (F-t2-gatekeeper-1, -3, -5, -8, -9), and is implied by L2.1 (no in-app guidance for why the scary dialog happened). The unsigned `identity: null` + `hardenedRuntime: false` + `gatekeeperAssess: false` triple disables three layers of macOS protection simultaneously, and the right-click→Open workaround lives only in the README. Fixing the documentation story (quick wins) is decoupled from actually signing (strategic, requires Apple Dev account) — treat as two separate initiatives.

2. **OAuth/credential handoff has redundant failure modes.** L2.1 (F-t2-onboarding-2, -4), L2.2 (F-t2-bootstrap-7), and L3.3 (F-t3-credentials-1, -2, -3, -4, -9, -11) all converge on the same underlying pattern: token state is checked in multiple places (auth-guard, oauth-checker, env-utils), each with subtly different behavior (throws vs returns null vs catches ENOENT), and none of them propagate an actionable "run: claude login" message consistently to the user. The Keychain refresh path is specifically bypassed when the token *file* is missing (the most common fresh-machine state). This deserves a unified credential-service redesign.

3. **Native module ABI correctness is implicit, not declared.** L1.2 (F-t1-native-1, -2, -3, -5) and L1.3 (F-t1-asar-paths-1 as a reference positive) highlight that the current build works by accident: electron-builder 26.8.1's auto-detection happens to unpack the right files and the build machine happens to have a Node version close enough to Electron's. Explicit `asarUnpack` directives + `electron-rebuild -v 39.8.6` in the package script are trivial to add and eliminate an entire class of "works on my machine" failures.

4. **Broadcast channels declared but not wired.** L3.1 (F-t3-ipc-surface-001, -002, -003) identified 3 of 18 broadcast channels with no preload listener. `sprint:mutation`, `agent-manager:circuit-breaker-open`, and `task-terminal:resolution-error` are all defined in `broadcast-channels.ts` and sent by the main process, but the renderer never subscribes — so the associated UX (fine-grained task updates, circuit-breaker warnings, terminal errors) never surfaces.

5. **Hidden failures that log-only-to-file.** L3.2 (F-t3-prod-paths-2) and L3.3 (F-t3-credentials-1, -4) share a pattern: error paths write to `~/.bde/bde.log` but don't broadcast to the renderer. For a packaged macOS app with no console window, this means support diagnostics live in a file end-users don't know exists. The `manager:warning` broadcast pattern already exists and should be the default for user-impacting errors.

---

## 4. Quick Wins

Findings with score ≥ 6.0 and effort S:

- **F-t1-native-1** (12.0) — Add `electron-rebuild -v 39.8.6` to the package script before `electron-builder`.
- **F-t1-native-3** (12.0) — Pass `-v 39.8.6` to electron-rebuild in `postinstall` and `predev`.
- **F-t2-gatekeeper-1** (12.0) — Add "Install from DMG" section to README with right-click→Open steps. Zero code change.
- **F-t2-onboarding-2** (12.0) — Remove or reword the "Continue Anyway" button so failed-checks state is not a dead-end.
- **F-t3-ipc-surface-001** (12.0) — Add `onSprintMutation` preload listener in `api-utilities.ts`.
- **F-t3-credentials-2** (9.0) — Catch ENOENT in oauth-checker and attempt Keychain refresh.
- **F-t1-builder-1** (9.0) — Add `afterSign: scripts/after-sign.sh` to `electron-builder.yml` mac section.
- **F-t1-native-5** (9.0) — Extend postinstall to also rebuild `node-pty` for Electron.
- **F-t3-ipc-surface-002** (9.0) — Add `onCircuitBreakerOpen` preload listener in `api-agents.ts`.
- **F-t3-ipc-surface-003** (9.0) — Add `onTaskTerminalError` preload listener in `api-utilities.ts`.
- **F-t2-gatekeeper-8** (6.0) — Add GitHub release-notes template mentioning Gatekeeper workaround.
- **F-t2-onboarding-5** (6.0) — Turn "Install Claude Code CLI" text into a link/copy-pasteable command.

---

## 5. Deferred / Out of Scope

- **F-t1-builder-7, F-t1-builder-9, F-t2-gatekeeper-5** (proper code signing + hardened runtime) — Requires Apple Developer Program membership (~$99/yr) and notarization pipeline. Strategic, not tactical; gate on decision to distribute beyond friends-and-family.
- **F-t1-builder-8** (ASAR size optimization by excluding locales) — Low severity, effort L; ship-blocking only on slow-network installs. Revisit if the DMG becomes a complaint.
- **F-t1-native-4** (Node ≥22.12.0 engine pin) — Paperwork; the failure mode is already caught by `vitest-global-setup.ts` rebuilding on version drift. Document in CLAUDE.md and move on.
- **F-t2-gatekeeper-6, F-t3-credentials-12** — Future sandbox / Keychain-hang concerns that don't affect current unsigned build. Park until signing is addressed.
- **F-t3-ipc-surface-004** (deprecated `agent:event` channel still emitted) — Works correctly via batching; purely cleanup. Defer to a future cleanup PR.
- **F-t2-onboarding-16** (RepoStep reuses Settings CSS classes) — Cosmetic coupling; not worth an extraction unless the Settings UI is refactored.
- **F-t2-bootstrap-11** (theoretical IPC race between emitStartupWarnings and React mount) — The lens author explicitly rates this as "unlikely in practice"; existing mitigations are sufficient.

---

## 6. Open Questions

Per `feedback_audit_false_positives.md` — lensed audit findings need code verification before implementing, because 5/10 prior top findings were false positives. The items below are the most likely candidates for "looks bad on paper, not actually a bug."

- **F-t1-builder-3 and F-t1-native-2** (missing explicit `asarUnpack`) — L1.3 (ASAR Paths lens) explicitly says *"No blocking issues for ASAR packaging"* and F-t1-native-6 confirms `app.asar.unpacked/` is populated correctly. The L1.1 and L1.2 recommendations are "belt and suspenders" against a theoretical future electron-builder regression. **Verify:** build a DMG with a clean `node_modules` and confirm unpacking still works before adding config that may interact oddly with auto-detection.
- **F-t3-prod-paths-1** (CSP missing `wasm-unsafe-eval` breaks Monaco) — Speculative. The auditor says "*may* require WASM" and recommends testing before adding the directive. Current `worker-src 'self' blob:` is already sufficient for most Monaco features. **Verify:** launch the packaged DMG, open IDE view, and exercise syntax highlighting + Cmd+P search before changing CSP.
- **F-t2-gatekeeper-4** (missing NSAppleEventsUsageDescription) — Lens admits "only relevant if spawned tools use Apple Events" and the confidence is Medium. `gh` doesn't appear to use Apple Events on macOS — it uses Keychain directly via `security`. **Verify:** check `gh auth login` behavior on a signed build before adding the plist key.
- **F-t2-onboarding-1** (two onboarding layers) — Design critique rather than a bug. The "fix" (unify the two systems) is an M-effort refactor that may destabilize a working flow. **Verify:** confirm on a fresh Mac that the flow actually breaks in practice, not just reads confusingly.
- **F-t1-builder-2** (missing entitlements for permission prompts) — Claims microphone/camera/Bluetooth prompts will be silently suppressed. BDE has no audio/camera/Bluetooth features that I'm aware of — the plist keys may be inherited from electron-builder defaults and are effectively dead. **Verify:** search for actual usage of these APIs before spending effort on entitlements.
- **F-t3-credentials-9** (token expires between precondition and spawn) — Theoretical race over a 30-second window during which tokens don't expire in practice. Low-confidence mitigation; revisit only if observed.

Where lenses disagreed:
- **L1.3 vs L1.2 on native modules** — L1.3 (ASAR Paths) says packaging is production-ready and explicitly approves. L1.2 (Native) says rebuild pipeline is "PRESENT but INCOMPLETE" and flags Critical issues. Both are correct at different layers: runtime loading works now (L1.3), but the *build reproducibility* is fragile (L1.2). Treat them as complementary, not contradictory.

---

## 7. Full Findings Index

### Team 1 — Build (`team-1-build/`)

**L1.1 Builder Lens** (`lens-builder.md`)
- F-t1-builder-1: Missing afterSign hook configuration (High/S)
- F-t1-builder-2: Unsigned app missing entitlements declaration (High/M)
- F-t1-builder-3: Missing asarUnpack configuration (Medium/S)
- F-t1-builder-4: No copyright statement in electron-builder.yml (Medium/S)
- F-t1-builder-5: DMG configuration missing app icon name reference (Medium/S)
- F-t1-builder-6: DMG background image not specified (Low/S)
- F-t1-builder-7: `identity: null` does not produce runnable unsigned app by default (High/M)
- F-t1-builder-8: Large ASAR with no explicit size optimization (Low/L)
- F-t1-builder-9: `hardenedRuntime: false` disables code signing hardening (High/M)
- F-t1-builder-10: `gatekeeperAssess: false` bypasses Gatekeeper security check (Medium/S)

**L1.2 Native Lens** (`lens-native.md`)
- F-t1-native-1: Production build script does not invoke electron-rebuild (Critical/S)
- F-t1-native-2: electron-builder.yml lacks npmRebuild and asarUnpack directives (High/M)
- F-t1-native-3: ABI mismatch Electron 39 ABI 140 vs system Node ABI 141 (Critical/S)
- F-t1-native-4: @electron/rebuild v4.0.3 requires Node ≥22.12.0 (Medium/S)
- F-t1-native-5: node-pty postinstall only cleans, rebuilds for Node not Electron (High/S)
- F-t1-native-6: asarUnpack correctly configured via auto-detection (N/A — passing)
- F-t1-native-7: electron-vite correctly externalizes native modules (N/A — passing)
- F-t1-native-8: db.ts loads better-sqlite3 at import time, early crash on ABI mismatch (High/M)
- F-t1-native-9: vitest-global-setup correctly rebuilds for test context (N/A — passing)
- F-t1-native-10: package-lock.json pins versions correctly (N/A — passing)

**L1.3 ASAR Paths Lens** (`lens-asar-paths.md`)
- F-t1-asar-paths-1 through F-t1-asar-paths-10: All N/A (correct implementations) except F-t1-asar-paths-8 (Low) and F-t1-asar-paths-10 (Low, observational)

### Team 2 — First Launch (`team-2-firstlaunch/`)

**L2.1 Onboarding Lens** (`lens-onboarding.md`)
- F-t2-onboarding-1: Two separate onboarding systems confuse intent (High/M)
- F-t2-onboarding-2: "Continue Anyway" button disabled when checks fail (Critical/S)
- F-t2-onboarding-3: "Check Again" button usability unclear (Medium/S)
- F-t2-onboarding-4: Auth token expiry check may fail silently (High/M)
- F-t2-onboarding-5: No documentation link for Claude Code CLI install (Medium/S)
- F-t2-onboarding-6: WelcomeStep Back button does nothing (Low/S)
- F-t2-onboarding-7: GitHub CLI optional but unclear, no Skip button (Medium/M)
- F-t2-onboarding-8: Repositories optional, no empty-state guidance after onboarding (Medium/M)
- F-t2-onboarding-9: No accessibility labels on check rows (Low/S)
- F-t2-onboarding-10: Wizard step indicators not semantic (Low/S)
- F-t2-onboarding-11: No test coverage for onboarding paths (Medium/M)
- F-t2-onboarding-12: Setting key `onboarding.completed` not documented (Low/S)
- F-t2-onboarding-13: GhStep version display does not validate minimum version (Low/M)
- F-t2-onboarding-14: DoneStep always uses first repo, not selected repo (Medium/S)
- F-t2-onboarding-15: No network timeout handling for auth checks (Medium/M)
- F-t2-onboarding-16: RepoStep inline form styling inconsistent with Settings UI (Low/M)

**L2.2 Bootstrap Lens** (`lens-bootstrap.md`)
- F-t2-bootstrap-1 through F-t2-bootstrap-14: Mostly Low/informational (passing checks)
- F-t2-bootstrap-8: Safe storage encryption — lazy re-encryption (Medium/S) — passing, document Keychain requirement
- F-t2-bootstrap-15: Window creation failure not explicitly handled (Medium/S)

**L2.3 Gatekeeper Lens** (`lens-gatekeeper.md`)
- F-t2-gatekeeper-1: Unsigned app blocks on first launch with no user guidance (Critical/S)
- F-t2-gatekeeper-2: Info.plist missing Documents/Downloads usage descriptions (Medium/S)
- F-t2-gatekeeper-3: No entitlements file for shell access APIs (High/M)
- F-t2-gatekeeper-4: Missing NSAppleEventsUsageDescription (Medium/S)
- F-t2-gatekeeper-5: No hardened runtime (High/M)
- F-t2-gatekeeper-6: `~/.bde/` access without sandbox documentation (Low/S)
- F-t2-gatekeeper-7: Quarantine xattr propagates through DMG mount (Low/S)
- F-t2-gatekeeper-8: Right-click → Open workaround not in release notes/CHANGELOG (Medium/S)
- F-t2-gatekeeper-9: No first-launch guidance inside the app (Medium/M)

### Team 3 — Runtime (`team-3-runtime/`)

**L3.1 IPC Surface Lens** (`lens-ipc-surface.md`)
- F-t3-ipc-surface-001: Missing broadcast listener for `sprint:mutation` (Critical/S)
- F-t3-ipc-surface-002: Missing broadcast listener for `agent-manager:circuit-breaker-open` (High/S)
- F-t3-ipc-surface-003: Missing broadcast listener for `task-terminal:resolution-error` (High/S)
- F-t3-ipc-surface-004: Deprecated `agent:event` still broadcast (Medium/M) — design OK
- F-t3-ipc-surface-005: safeHandle wrapper coverage (Low) — compliant

**L3.2 Prod Paths Lens** (`lens-prod-paths.md`)
- F-t3-prod-paths-1: CSP missing `wasm-unsafe-eval` for Monaco workers (High/S) — speculative
- F-t3-prod-paths-2: Status server startup failure not visible to user (Medium/M)
- F-t3-prod-paths-3: Console logging unconditionally writes to stdout/stderr in production (Low/S)

**L3.3 Credentials Lens** (`lens-credentials.md`)
- F-t3-credentials-1: OAuth token file missing on fresh machine — graceful degradation (Medium/M)
- F-t3-credentials-2: OAuth token refresh from Keychain skipped when file missing (High/S)
- F-t3-credentials-3: `getOAuthToken()` returns null when missing — silent spawn failure (Critical/M)
- F-t3-credentials-4: Agent spawn failure with missing token — task silently errors (High/M)
- F-t3-credentials-5: Missing `.bde/oauth-token` not pre-created (Low/S) — correct design
- F-t3-credentials-6: CLI detection via `which` — no error message if Claude not found (Medium/M)
- F-t3-credentials-7: GitHub token missing on fresh machine — no gh auth fallback (Medium/M)
- F-t3-credentials-8: `safeStorage.isEncryptionAvailable()` unclear feedback (Medium/M)
- F-t3-credentials-9: No explicit token validation before agent spawn (High/M)
- F-t3-credentials-10: Settings → Connections tab limited auth status display (Low/M)
- F-t3-credentials-11: Fresh machine with no gh auth — GitHub ops fail silently (High/M)
- F-t3-credentials-12: Keychain access hangs — rate limiting sufficient (Low/S) — passing
- F-t3-credentials-13: Agent pipeline spawn without token fails loudly (Low/S) — passing

---

**Audit compiled:** 2026-04-16
**Lens reports:** `/Users/ryan/worktrees/BDE/audit-packaging-handoff/docs/superpowers/audits/2026-04-16/packaging-handoff/{team-1-build,team-2-firstlaunch,team-3-runtime}/`
