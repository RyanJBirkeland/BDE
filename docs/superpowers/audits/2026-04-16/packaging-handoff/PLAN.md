# Packaging & Handoff Readiness — Remediation Plan

**Scope:** Address all 62 findings from the 2026-04-16 lensed audit.
**Strategy:** Verify speculative items first, then ship fixes in waves that maximize parallelization. Consolidate same-file edits into single tasks to avoid merge conflicts.
**Parallelization model:** Each task below is a candidate pipeline-agent sprint task. Tasks within a phase are independent unless marked `DEP:`.

## Parallelization Rules

- Tasks that edit the **same file** must not run in parallel — bundle them into one task.
- Tasks that edit **different files in the same module** may run in parallel but merge in order.
- Verification tasks (Phase 0) must complete before their dependent tasks — they decide whether certain fixes are needed at all.
- WIP limit (`agentManager.maxConcurrent`) caps real concurrency. Don't queue more than ~6 tasks that touch overlapping layers simultaneously.

---

## Phase 0 — Verification (parallel × 6, ~1–2h each)

Per `feedback_audit_false_positives.md`, 5/10 top findings in prior audits were false positives. Six findings in this audit are flagged as speculative. Run verification agents first; their output gates later phases.

| ID | Task | Verifies | Outcome |
|----|------|---------|---------|
| V0.1 | Launch packaged DMG, open IDE view, exercise Monaco syntax highlight + Cmd+P search + find-in-file. Capture console errors. | F-t3-prod-paths-1 (CSP wasm-unsafe-eval) | Confirms whether Monaco actually breaks without the directive → gates T4.1 |
| V0.2 | `grep -r "desktopCapturer\|getUserMedia\|AudioContext\|navigator.mediaDevices\|navigator.bluetooth"` across src/. Decide whether NSMicrophone/Camera/Bluetooth plist keys describe real features. | F-t1-builder-2 | If no usage: remove the plist keys entirely (dead metadata). If usage exists: add entitlements. Gates T4.4. |
| V0.3 | Signed-build simulation of `gh auth login` on a TCC-aware macOS. Grep `gh` source for AppleScript/Apple Events. | F-t2-gatekeeper-4 (NSAppleEventsUsageDescription) | Confirms need. Likely drop — `gh` uses Keychain via `security(1)`, not Apple Events. Gates T4.4. |
| V0.4 | Walk a fresh Mac through OnboardingWizard → Onboarding on a clean install. Record whether the two-layer flow actually loops, blocks, or just reads weirdly. | F-t2-onboarding-1 | If it loops: consolidation is critical. If it just reads weirdly: deprioritize to Phase 6. Gates T3.4. |
| V0.5 | Build DMG with a scrubbed `node_modules` on an arm64 Mac where `electron-builder` auto-detection is the only unpack mechanism. Confirm `app.asar.unpacked/` contents. | F-t1-builder-3, F-t1-native-2 (explicit asarUnpack) | If unpacking is robust without explicit config: skip. If fragile: add explicit directives. Gates T1.3 line-item. |
| V0.6 | Search for any real 30s window during which tokens expire between the precondition check and spawn call. | F-t3-credentials-9 | Likely a theoretical race. Confirm before spending effort. Gates T2.2 line-item. |

**Output of Phase 0:** a short memo `PHASE-0-VERIFICATION.md` in this directory with each V result: *confirmed / not-needed / partial*. The memo determines which Phase 1–4 line items actually execute.

---

## Phase 1 — Ship-Blocker Fixes (parallel × 5, ~4–8h each)

All five tasks independent (different files / different subsystems). Should queue simultaneously.

### T1.1 — Gatekeeper install documentation

**Severity driver:** Critical (F-t2-gatekeeper-1).
**Files:** `README.md`, new `INSTALL.md`, new `.github/release.yml`.
**Closes:** F-t2-gatekeeper-1, F-t2-gatekeeper-7, F-t2-gatekeeper-8.
**What to do:**
- New README section "Install from DMG (macOS)" with 5 numbered steps including right-click → Open.
- New `INSTALL.md` with screenshots (Finder right-click menu, Gatekeeper dialog).
- `.github/release.yml` template that surfaces the install instructions in every GitHub release body.
- Optional `xattr -dr com.apple.quarantine /Applications/BDE.app` terminal recipe for power users.
**How to test:** Render README, open INSTALL.md on GitHub preview, verify release template renders on a draft release.

### T1.2 — Native module rebuild pipeline fix

**Severity driver:** Critical (F-t1-native-1, F-t1-native-3).
**Files:** `package.json` (scripts only), potentially `.nvmrc` note.
**Closes:** F-t1-native-1, F-t1-native-3, F-t1-native-5, F-t1-native-4 (via doc note).
**What to do:**
- Update `postinstall`, `predev`, and `package` scripts to pass `-v 39.8.6 -f -w better-sqlite3,node-pty` to `electron-rebuild`.
- Add `-a arm64` explicitly to the `package` script.
- Document Node ≥22.12.0 requirement in CLAUDE.md (paperwork, not enforcement).
**How to test:** `rm -rf node_modules && npm install && npm run package`, launch the DMG, verify app opens and `~/.bde/bde.db` is created (proves better-sqlite3 loaded), open terminal view (proves node-pty loaded).

### T1.3 — electron-builder.yml consolidated edit

**Severity driver:** High (F-t1-builder-1, F-t1-builder-3).
**Files:** `electron-builder.yml` (single-file edit — must not parallelize).
**Closes:** F-t1-builder-1, F-t1-builder-3 (conditional on V0.5), F-t1-builder-4, F-t1-builder-5, F-t1-builder-6 (opt-out), F-t1-builder-10, F-t1-native-2.
**What to do:**
- Add `afterSign: scripts/after-sign.sh` under `mac:`.
- Add root-level `copyright: "Copyright © 2026 BDE"`.
- Add `name` fields to both `dmg.contents[]` entries.
- Add `gatekeeperAssess: true` under `mac:` (single line flip).
- Add `npmRebuild: true` at root level (explicit override of default).
- If V0.5 confirms fragility: add explicit `asarUnpack` block.
**How to test:** `npm run package`, inspect generated `release/mac-arm64/BDE.app/Contents/Info.plist` for copyright, inspect `app.asar.unpacked/` contents, run `codesign -dv BDE.app` to confirm ad-hoc signature persisted.

### T1.4 — Fix "Continue Anyway" onboarding trap

**Severity driver:** Critical (F-t2-onboarding-2).
**Files:** `src/renderer/src/components/Onboarding.tsx` or relevant step in `components/onboarding/` (single-file, single component).
**Closes:** F-t2-onboarding-2.
**What to do:**
- The button is disabled when `allRequiredPassed === false` but that's exactly the state where users need to continue anyway. Invert: enable the button unless `criticalFailures > 0`, and reword to "Continue without [X]" with explicit risk callout.
- Alternatively: keep disabled but surface a secondary "I understand, continue anyway" path after a 3-second dwell, gated by a checkbox.
**How to test:** Unit test the component in each check state (all pass / some fail / all fail) and verify the button is reachable. Manual: launch app with no claude CLI installed; confirm you can still reach the main UI.

### T1.5 — Wire missing IPC broadcast listeners

**Severity driver:** Critical (F-t3-ipc-surface-001).
**Files:** `src/preload/index.ts` and relevant `src/preload/api-*.ts` modules; renderer subscribers that should use the new listener.
**Closes:** F-t3-ipc-surface-001, F-t3-ipc-surface-002, F-t3-ipc-surface-003.
**What to do:**
- Add `onSprintMutation` in `api-utilities.ts` (or whichever module already has `onBroadcast` factory usage).
- Add `onCircuitBreakerOpen` in `api-agents.ts`.
- Add `onTaskTerminalError` in `api-utilities.ts`.
- Wire each to a renderer store/toast so user-facing behavior actually changes.
- Verify preload/main type sync: add the channel names to `broadcast-channels.ts` if not already there.
**How to test:** Trigger a sprint mutation from main (e.g., via review-action-executor), confirm renderer receives it. Mock a circuit breaker open and a task terminal error; confirm toast/store updates.

---

## Phase 2 — Credential Handoff Unification (mostly sequential, ~1–2 days)

Per synthesis theme 2, OAuth handling has three subtly-different checks. This is a small refactor, best done as a single coherent change rather than piecemeal patches that fight each other.

### T2.1 — Unified CredentialService design spec (1–2h, solo)

**What:** A spec document (no code) defining:
- Single `getCredential(kind: 'claude' | 'github'): Promise<CredentialResult>` with discriminated return `{ status: 'ok' | 'missing' | 'expired' | 'keychain-locked', actionable: string | null }`.
- Kill all three existing check sites and route through this.
- Pre-spawn validation contract: drain loop calls this before `spawnWithTimeout()`, fails task with actionable error if missing.
**Output:** `docs/superpowers/specs/credential-service.md`.
**DEP:** None.

### T2.2 — Implement CredentialService + wire all spawn sites (1 day, solo)

**DEP:** T2.1.
**Files:** `src/main/auth-guard.ts`, `src/main/oauth-checker.ts` (merge/delete), `src/main/env-utils.ts`, `src/main/agent-manager/sdk-adapter.ts`, `src/main/agent-manager/spawn-cli.ts`, `src/main/agent-manager/drain-loop.ts`.
**Closes:** F-t3-credentials-1, F-t3-credentials-2, F-t3-credentials-3, F-t3-credentials-4, F-t3-credentials-9 (if V0.6 confirms the race matters), F-t3-credentials-8.
**What to do:** per T2.1 spec. Must land as one PR — the three old check sites need to be removed together to avoid regression.
**How to test:** Test matrix: (no file, no keychain) / (no file, keychain has token) / (file exists, expired) / (file exists, valid) / (file exists, corrupt). Automated unit tests for each. Manual: delete `~/.bde/oauth-token`, launch app, queue a task, confirm the error bubbles up to the UI with "run: claude login" guidance.

### T2.3 — GitHub auth enforcement + onboarding integration (parallel with T2.2 after T2.1)

**DEP:** T2.1.
**Files:** `src/renderer/src/components/onboarding/GhStep.tsx` (or equivalent), `src/main/handlers/operational-checks-handlers.ts`.
**Closes:** F-t3-credentials-7, F-t3-credentials-11, F-t2-onboarding-7.
**What to do:**
- GhStep shows copy-pasteable `gh auth login` command when check fails.
- Add "Skip GitHub (read-only mode)" button that records `settings.githubOptedOut = true`; Task Workbench + Code Review surface a dismissable banner "GitHub disabled — PR actions unavailable".
- Pipeline agents that attempt a PR action with no gh auth fail loudly with the same guidance.
**How to test:** `gh auth logout`, launch app, walk through onboarding, skip GitHub, queue a task that would create a PR, confirm the failure message references `gh auth login`.

---

## Phase 3 — First-Launch UX Polish (parallel × 5, ~2–4h each)

These all touch `components/onboarding/` but different files. Safe to parallelize if each task owns a specific step file.

### T3.1 — AuthStep + WelcomeStep polish

**Files:** `components/onboarding/AuthStep.tsx`, `WelcomeStep.tsx`.
**Closes:** F-t2-onboarding-5, F-t2-onboarding-6, F-t2-onboarding-15.
**What:** Add Claude CLI install link (`https://docs.claude.com/en/docs/claude-code`) with copy-pasteable `curl`/`brew` command. Remove (or make functional) the WelcomeStep Back button. Add 10s timeout wrapper for auth check with fallback error copy.

### T3.2 — RepoStep + DoneStep empty-state and selection

**Files:** `components/onboarding/RepoStep.tsx`, `DoneStep.tsx`.
**Closes:** F-t2-onboarding-8, F-t2-onboarding-14.
**What:** When user skips repos, DoneStep shows "Add a repository to get started" with a button that opens Settings → Repositories. DoneStep uses the selected repo (or first-if-none), not always first.

### T3.3 — Accessibility pass on onboarding

**Files:** Every `components/onboarding/*.tsx`.
**Closes:** F-t2-onboarding-9, F-t2-onboarding-10, F-t2-onboarding-13.
**What:** aria-labels on check-status icons, `role="progressbar"` + `aria-current` on step indicators, version-comparison guard on GhStep.

### T3.4 — Onboarding test coverage

**Files:** `src/renderer/src/components/onboarding/__tests__/` (new).
**Closes:** F-t2-onboarding-11, F-t2-onboarding-12.
**What:** Vitest + React Testing Library tests for each step; document `onboarding.completed` setting key in `docs/modules/components/index.md`.

### T3.5 — Window creation + bootstrap hardening

**Files:** `src/main/index.ts` (window creation), `src/main/bootstrap.ts`.
**Closes:** F-t2-bootstrap-15.
**What:** Wrap `new BrowserWindow()` in try/catch; on failure, log + `app.quit()` with a dialog. Prevents silent hang on headless systems.

### T3.6 — First-launch in-app guidance modal

**Files:** New `components/onboarding/WelcomeTour.tsx` or similar.
**Closes:** F-t2-gatekeeper-9, F-t2-onboarding-1 if V0.4 confirms consolidation (merge this task with a full OnboardingWizard rewrite).
**What:** One-time dismissable panel explaining the Gatekeeper workaround the user just experienced. Persist `settings.welcomeTourDismissed`.
**DEP on V0.4:** If two-layer onboarding is actually broken, fold this into a full onboarding consolidation task instead (effort bumps to L).

---

## Phase 4 — Production Runtime Polish (parallel × 4, ~2h each)

### T4.1 — CSP wasm-unsafe-eval (CONDITIONAL on V0.1)

**Files:** `src/main/bootstrap.ts` (single-line CSP edit).
**Closes:** F-t3-prod-paths-1.
**Skip if V0.1 shows Monaco works fine without it.**

### T4.2 — Status server port conflict visibility

**Files:** `src/main/status-server.ts` (or equivalent), renderer toast store.
**Closes:** F-t3-prod-paths-2.
**What:** When port 18791 bind fails, broadcast `manager:warning` so a dismissable toast appears. Optional: dynamic port allocation with setting persistence.

### T4.3 — Production log noise reduction

**Files:** `src/main/logger.ts`.
**Closes:** F-t3-prod-paths-3.
**What:** Add `is.dev` guard around `console.*` writes. File writes unchanged. Saves ~397 dual-writes per startup.

### T4.4 — Plist permission descriptions alignment (CONDITIONAL on V0.2, V0.3)

**Files:** `electron-builder.yml` `mac.extendInfo`.
**Closes:** F-t1-builder-2 or F-t2-gatekeeper-2, F-t2-gatekeeper-4 — depending on V0.2/V0.3 outcomes.
**What:**
- If V0.2 says no mic/cam/bluetooth usage: remove those plist keys (reduce attack surface + clean metadata).
- If V0.2 says usage exists: keep keys and add entitlements file (Phase 5 work).
- Always add `NSDocumentsFolderUsageDescription` and `NSDownloadsFolderUsageDescription` if the app ever navigates file dialogs to those paths.
- If V0.3 says `gh` doesn't use Apple Events: skip NSAppleEventsUsageDescription.

---

## Phase 5 — Strategic: Code Signing Initiative (separate decision, ~1–2 weeks)

This is a project, not a task. Requires product decision before starting. Items below are prerequisites that must all be done together.

**Prerequisite decision:** Is BDE being distributed beyond friends-and-family? If yes, commit to this. If no, defer indefinitely and lean harder on the Phase 1 docs story.

**S5.1 — Apple Developer Program membership** (~$99/yr, 1 day admin).

**S5.2 — Certificate provisioning** (1–2h).
Generate Developer ID Application certificate. Store in Keychain + CI secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`).

**S5.3 — Entitlements file + build config** (1d).
- Create `build/entitlements.mac.plist` per F-t2-gatekeeper-3 spec.
- Flip `identity: "Developer ID Application: ..."`, `hardenedRuntime: true`, reference entitlements.
- **Closes:** F-t1-builder-7, F-t1-builder-9, F-t2-gatekeeper-3, F-t2-gatekeeper-5.

**S5.4 — Notarization pipeline** (1–2d).
Add `@electron/notarize` with `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` env vars. Test end-to-end including staple.

**S5.5 — Sandbox prep (optional, ~1wk)** (F-t2-gatekeeper-6, F-t3-credentials-12).
Not needed unless App Store distribution is on the table.

---

## Phase 6 — Cleanup & Cosmetic (parallel, low priority)

Ship when there's spare capacity. Do NOT queue ahead of Phase 1–4.

- **T6.1** (F-t3-ipc-surface-004) — Remove deprecated `agent:event` broadcast once all callers migrated to batch. Scan for subscribers first.
- **T6.2** (F-t1-builder-8) — ASAR size optimization. Only if DMG size becomes a user complaint. Effort L.
- **T6.3** (F-t2-onboarding-16) — RepoStep styling consistency. Fold into next Settings refactor.
- **T6.4** (F-t2-onboarding-3) — "Check Again" button copy/affordance polish.
- **T6.5** Bootstrap low-severity items (F-t2-bootstrap-1..-14 residual). Most are informational or already passing; audit-level doc pass only.

---

## Execution Schedule

```
Week 1:
  Mon-Tue: Phase 0 (6 parallel verifications)
  Wed-Fri: Phase 1 (T1.1 T1.2 T1.3 T1.4 T1.5 in parallel)

Week 2:
  Mon: T2.1 design spec (solo, blocking)
  Tue-Thu: T2.2 + T2.3 parallel
  Fri: Phase 3 wave (T3.1 T3.2 T3.3 T3.4 T3.5 T3.6 in parallel — six agents, hit WIP ceiling, batch in two groups of 3)

Week 3:
  Mon-Tue: Phase 4 (T4.1 T4.2 T4.3 T4.4 in parallel, conditional items gated by Phase 0 outputs)
  Wed: Phase 6 cleanup
  Thu-Fri: Phase 5 kickoff IF distribution decision is made
```

**Wall-clock estimate:** 3 weeks for Phases 0–4 + 6 with two-agent WIP. 1–2 weeks for Phase 5 on top. All estimates assume pipeline-agent execution with the current `maxConcurrent: 2` ceiling.

---

## How to use this plan

1. Read `SYNTHESIS.md` first for scoring methodology and top actions.
2. Queue Phase 0 verification tasks as pipeline agents. Each verification task spec should reference the finding ID and the specific claim to verify.
3. When Phase 0 completes, update this plan's conditional items (T1.3 asarUnpack, T3.6 consolidation scope, T4.1 CSP, T4.4 plist keys) based on V-memo outcomes.
4. Queue Phase 1 tasks in parallel — all five are independent.
5. Phase 2 is a short solo engagement (T2.1 → T2.2) with T2.3 running in parallel after T2.1.
6. Phase 3 tasks touch the same directory but different files — safe to parallelize at the WIP limit.
7. Phase 5 waits on a product decision.

Each T-task above should become a sprint task with a detailed spec (file paths, test plan, effort). Current task IDs in this doc are the plan-level grouping — they will map 1:1 to sprint_tasks.title unless noted.

---

**Plan compiled:** 2026-04-16
**Audit source:** `SYNTHESIS.md` (62 findings across 9 lenses)
**Branch:** `audit/packaging-handoff-2026-04-16`
