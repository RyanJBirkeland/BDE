# L2.3 Gatekeeper Lens — First-Launch Unsigned UX on macOS

**Date:** 2026-04-16
**Auditor:** Claude (macOS Gatekeeper / Unsigned-App UX Reviewer)

## Executive Summary

A non-technical user downloading `BDE-0.1.0-arm64.dmg`, dragging the app to Applications, and double-clicking it on a fresh Mac (Sonoma/Sequoia) encounters a hard barrier:

1. **Gatekeeper blocks the unsigned app with "Apple could not verify the developer" dialog** — no app launch button, no workaround shown in the dialog.
2. **The documented workaround (right-click → Open) is only mentioned in the README**, not in release notes, install instructions, or inside the app's first-launch experience.
3. **App lacks critical Info.plist usage-description strings** for APIs it attempts to use (dialogs, file access, shells), creating silent denials or crashes on permission requests.
4. **No entitlements file for TCC-controlled APIs** (`shell.openPath`, spawning `gh`/`git`, accessing `~/worktrees`, writing to `~/.bde`) — these may fail silently on unsigned+unhardened builds.
5. **Database and OAuth tokens written to `~/.bde/` without handling macOS sandbox/TCC restrictions** — signed future builds will face file-access permission prompts.

**Impact: Adoption blocker.** A first-time user sees a scary "damaged app" error and has no guidance on how to proceed. Even if they find the README workaround, they may not trust an app that requires "unsafe" steps.

---

## F-t2-gatekeeper-1: Unsigned App Blocks on First Launch with No User Guidance

**Severity:** Critical
**Category:** signing
**Location:** `electron-builder.yml:14` (`identity: null`)
**Evidence:**
- Line 14: `identity: null` — app is unsigned.
- Line 15: `hardenedRuntime: false` — no hardened runtime either.
- Line 16: `gatekeeperAssess: false` — electron-builder is configured to NOT even perform local Gatekeeper assessment during build.
- Built app `/release/mac-arm64/BDE.app` has no codesign signature (`codesign -v` returns "code has no resources but signature indicates they must be present").

**Impact:**
On a fresh Mac with default Gatekeeper settings (enabled since Catalina), double-clicking the DMG-extracted app shows:
```
"BDE" cannot be opened because the developer cannot be verified.
macOS cannot verify the developer of "BDE".
[Cancel] [Move to Trash] [OK]
```
No "Open" button. Clicking [OK] just closes the dialog. The app does NOT launch.

The workaround (right-click → Open) is **not documented anywhere a user will see on first install** — only in the README, buried in a note at line 321:
```
> **Note:** The app is unsigned. Right-click → Open to bypass macOS Gatekeeper on first launch.
```

**Recommendation:**
1. **Add prominent install instructions** to README's Getting Started section:
   ```markdown
   ### Install from DMG (macOS)
   1. Download BDE-*.dmg
   2. Double-click to mount the DMG
   3. Drag **BDE** to the **Applications** folder
   4. In Applications, **right-click BDE → Open** (bypass Gatekeeper)
   5. Click "Open" in the confirmation dialog
   ```

2. **Create INSTALL.md** with step-by-step macOS install guide with screenshots.

3. **Add release notes template** that includes Gatekeeper workaround in every release.

4. **Future: Plan for code signing.** Unsigned is acceptable for friends & family, but requires 3 clicks instead of 1. Apple Developer Program membership + notarization = single-click launch (Sonoma/Sequoia users see "Apple verified" instead of scary warnings).

**Effort:** S (docs only, no code change)
**Confidence:** High

---

## F-t2-gatekeeper-2: Info.plist Missing NSDocumentsFolderUsageDescription and NSDownloadsFolderUsageDescription

**Severity:** Medium
**Category:** plist
**Location:** `/release/mac-arm64/BDE.app/Contents/Info.plist` (missing keys)
**Evidence:**
- Info.plist **has** `NSMicrophoneUsageDescription`, `NSCameraUsageDescription`, `NSAudioCaptureUsageDescription`, `NSBluetoothAlwaysUsageDescription`.
- Info.plist **does NOT have** `NSDocumentsFolderUsageDescription` or `NSDownloadsFolderUsageDescription`.
- The app uses `dialog.showOpenDialog()` and `dialog.showSaveDialog()` in:
  - `/src/main/fs.ts:5` — `dialog.showOpenDialog()` (file picker)
  - `/src/main/handlers/sprint-export-handlers.ts` — `showSaveDialog()` (CSV export)
  - `/src/main/handlers/planner-import.ts` — `showOpenDialog()` (import)

On **Sonoma/Sequoia**, if the user navigates to `~/Documents` or `~/Downloads` in a file picker, macOS TCC may prompt or silently deny access without an explicit plist key.

**Impact:**
- User opens "Export Tasks as CSV" dialog.
- Navigates to Downloads folder.
- macOS denies access silently (no error shown in dialog).
- User cannot see or select the Downloads folder.
- **Silent failure** — the app appears broken, no error message.

**Recommendation:**
Add to Info.plist via electron-builder extraInfo or an entitlements file:
```xml
<key>NSDocumentsFolderUsageDescription</key>
<string>BDE needs access to your Documents folder to save and import task files</string>
<key>NSDownloadsFolderUsageDescription</key>
<string>BDE needs access to your Downloads folder to export reports and import files</string>
```

**Effort:** S (plist key addition)
**Confidence:** High

---

## F-t2-gatekeeper-3: No Entitlements File for Shell Access APIs

**Severity:** High
**Category:** tcc
**Location:** No entitlements file exists; `electron-builder.yml` does not reference one
**Evidence:**
- `/src/main/pty.ts:61` — `pty.spawn(shell, ...)` — spawns interactive shell (node-pty).
- `/src/main/agent-manager/spawn-cli.ts:60` — `spawn('claude', ...)` — spawns Claude CLI as child process.
- `/src/main/git.ts:31, 91, 116, etc.` — multiple `execFileAsync('git', ...)` calls.
- `/src/main/agent-manager/pr-operations.ts` — spawns `gh` (GitHub CLI).
- `/src/main/handlers/window-handlers.ts` — `shell.openPath(filepath)` — opens file in Finder.

**None of these APIs are guarded by entitlements.** On an **unsigned build with no hardened runtime**, TCC does not enforce code-signing-backed permission checks. However:

1. **If the app is ever signed in future** (to solve F-t2-gatekeeper-1), spawning `gh` or `git` will require entitlements.
2. **Shell access via pty is inherently unrestricted**, but file access from spawned processes may inherit sandbox restrictions.
3. **`shell.openPath()` may trigger file access checks** on future macOS versions when the app is signed.

On **current unsigned build**, this is a **deferred risk** — the unsigned app runs without sandbox, so there are no TCC denials. But the code is not prepared for hardened runtime.

**Impact (now):** None — unsigned app has no sandbox.
**Impact (when signed):** If code signing is added without entitlements, spawning `git`, `gh`, or `claude` will fail with TCC denial or "Operation not permitted" error.

**Recommendation:**
Prepare entitlements file now (even though not needed for unsigned):

`build/entitlements.mac.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!-- Shell access for spawning git, gh, claude CLI -->
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>

  <!-- File access to home directory and worktrees -->
  <key>com.apple.security.files.user-selected.read-write</key>
  <true/>

  <!-- macOS 13.1+: Required for accessing ~/Documents, ~/Downloads via system dialogs -->
  <key>com.apple.security.files.downloads.read-write</key>
  <true/>

  <!-- Network access for API calls -->
  <key>com.apple.security.network.client</key>
  <true/>
  <key>com.apple.security.network.server</key>
  <true/>
</dict>
</plist>
```

And in `electron-builder.yml`:
```yaml
mac:
  ...
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
```

**Effort:** M (create entitlements file, test with signed build)
**Confidence:** High

---

## F-t2-gatekeeper-4: Missing NSAppleEventsUsageDescription for spawn-triggered Apple Events

**Severity:** Medium
**Category:** plist
**Location:** `Info.plist` (missing key); impacts `/src/main/agent-manager/spawn-cli.ts`
**Evidence:**
- The app spawns `gh` CLI (in `pr-operations.ts`), which may trigger Apple Events when accessing GitHub's macOS Keychain integration (e.g., `gh auth login` or `gh auth status`).
- On Sequoia, if an app tries to spawn a tool that accesses Keychain via Apple Events without `NSAppleEventsUsageDescription` in the parent app's plist, macOS may:
  - Show a TCC prompt (if app is signed).
  - Silently deny the event (if unsigned, behavior is less predictable).

**Impact:**
User runs a task that invokes `gh auth status` or similar. If Keychain access is involved, the spawned `gh` process may hang or fail silently waiting for TCC permission.

**Recommendation:**
Add to Info.plist:
```xml
<key>NSAppleEventsUsageDescription</key>
<string>BDE needs access to Apple Events to authenticate with GitHub and manage credentials</string>
```

**Effort:** S
**Confidence:** Medium (only relevant if spawned tools use Apple Events)

---

## F-t2-gatekeeper-5: No Hardened Runtime; hardenedRuntime: false Disables Code Signing Protections

**Severity:** High
**Category:** signing
**Location:** `electron-builder.yml:15` (`hardenedRuntime: false`)
**Evidence:**
```yaml
mac:
  ...
  hardenedRuntime: false
```

With `hardenedRuntime: false`:
1. **If unsigned (current state):** No restrictions — app can do anything.
2. **If signed without hardened runtime (future state):** Notarization is rejected; Gatekeeper warnings are scary.
3. **Code cannot migrate to proper security model** until hardened runtime is enabled + entitlements are added.

**Impact (now):** None — unsigned + no runtime = no enforcement.
**Impact (when signing):** Notarization will fail; users will see "unknown developer" warnings.

**Recommendation:**
Enable hardened runtime **in preparation for signing**:
```yaml
mac:
  ...
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
```

**Effort:** M (requires entitlements file + testing)
**Confidence:** High

---

## F-t2-gatekeeper-6: Database and OAuth Tokens Written to ~/.bde/ Without Sandbox/Home Directory Access Documentation

**Severity:** Low
**Category:** tcc
**Location:** `/src/main/paths.ts:81, 86` (BDE_DIR, BDE_DB_PATH)
**Evidence:**
```typescript
export const BDE_DIR = process.env.BDE_DATA_DIR ?? join(homedir(), '.bde')
export const BDE_DB_PATH = ... ?? join(BDE_DIR, 'bde.db')
```

App writes: SQLite DB, OAuth token, agent logs, memory files all to `~/.bde/`.

On **unsigned builds**, home directory access is unrestricted. But if the app is signed + sandboxed in future, writing to `~/.bde/` requires entitlements or the app will fail on startup.

**Impact (now):** None.
**Impact (when signed with sandbox):** App will fail to create/write `~/.bde/bde.db` without explicit entitlements.

**Recommendation:**
Ensure entitlements (from F-t2-gatekeeper-3) include home directory access. Electron apps typically need:
```xml
<key>com.apple.security.files.home-relative.read-write</key>
<true/>
```

**Effort:** S (entitlements update)
**Confidence:** Medium (depends on future sandbox design)

---

## F-t2-gatekeeper-7: Quarantine xattr Propagates Through DMG Mount

**Severity:** Low
**Category:** quarantine
**Location:** DMG file `/release/BDE-0.1.0-arm64.dmg`
**Evidence:**
When a user downloads the DMG via Safari/Chrome, the browser sets `com.apple.quarantine` on the file. When mounted, the app inside also inherits quarantine. On first launch:
- Unsigned app + quarantine + Gatekeeper = "damaged" or "developer cannot be verified" dialog (as in F-t2-gatekeeper-1).
- Right-click → Open clears quarantine and launches the app.

**Recommendation:**
1. **Document in install instructions** that the right-click workaround also clears quarantine.
2. **Optional:** `xattr -dr com.apple.quarantine /Applications/BDE.app` terminal workaround for power users.

**Effort:** S (docs only)
**Confidence:** High

---

## F-t2-gatekeeper-8: Right-Click → Open Workaround Not Mentioned in Release Notes or CHANGELOG

**Severity:** Medium
**Category:** docs
**Location:** `README.md:321` only; no CHANGELOG, no release-notes template
**Evidence:**
The workaround is documented in the README, but:
- No CHANGELOG.md or RELEASES.md file.
- No release-notes template for GitHub releases.
- Users who download the DMG and do NOT read the entire README will not discover the workaround.

**Impact:**
User downloads DMG, gets Gatekeeper error, assumes the app is broken or malicious, and uninstalls it without trying the workaround.

**Recommendation:**
1. Create CHANGELOG.md with install-section template emphasizing right-click → Open.
2. Add GitHub Releases template (`.github/release.yml`) that surfaces the Gatekeeper step.
3. Add inline release notes in GitHub UI emphasizing the Gatekeeper step.

**Effort:** S (docs only)
**Confidence:** High

---

## F-t2-gatekeeper-9: No First-Launch Guidance Inside the App

**Severity:** Medium
**Category:** docs
**Location:** N/A — feature request
**Evidence:**
- The app launches directly to the dashboard without any onboarding modal explaining Gatekeeper.
- If auth setup is missing, the app shows warnings via `emitStartupWarnings()` (bootstrap.ts:61), but does not guide users through the Gatekeeper experience they just went through.

**Impact:**
A user successfully opens the app via right-click but may:
1. Not understand why they had to use a workaround.
2. Distrust the app (why is it unsigned?).
3. Not configure Claude authentication.

**Recommendation:**
Add one-time welcome panel:
```
Welcome to BDE

BDE is an unsigned app. If you saw a Gatekeeper warning on first launch,
that's normal. Right-click the BDE app → Open to bypass this in future.

Next steps:
 [ ] Claude Code CLI installed
 [ ] GitHub CLI authenticated
 [ ] Git installed
```

**Effort:** M (UI component + IPC handler)
**Confidence:** Medium (nice-to-have, not critical)

---

## Summary Table

| Finding | Severity | Category | Effort |
|---------|----------|----------|--------|
| F-t2-gatekeeper-1: Unsigned app + no user docs | Critical | signing | S |
| F-t2-gatekeeper-2: Missing Documents/Downloads plist | Medium | plist | S |
| F-t2-gatekeeper-3: No entitlements file for shell access | High | tcc | M |
| F-t2-gatekeeper-4: Missing NSAppleEvents plist key | Medium | plist | S |
| F-t2-gatekeeper-5: hardenedRuntime: false | High | signing | M |
| F-t2-gatekeeper-6: ~/.bde/ access without sandbox docs | Low | tcc | S |
| F-t2-gatekeeper-7: Quarantine xattr inheritance | Low | quarantine | S |
| F-t2-gatekeeper-8: No release notes mentioning workaround | Medium | docs | S |
| F-t2-gatekeeper-9: No first-launch guidance | Medium | docs | M |

## Quick Wins (Immediate Impact)

1. **Update README** with "Install from DMG" section and right-click workaround (F-t2-gatekeeper-1). **Effort: 5 min.**
2. **Add INSTALL.md** with screenshots. **Effort: 30 min.**
3. **Add release-notes template** mentioning Gatekeeper workaround. **Effort: 10 min.**

These three changes dramatically improve first-launch UX without code changes.

## Strategic Improvements (For Code Signing)

When planning to sign the app:
1. Create `build/entitlements.mac.plist` (F-t2-gatekeeper-3, F-t2-gatekeeper-6).
2. Enable `hardenedRuntime: true` in `electron-builder.yml` (F-t2-gatekeeper-5).
3. Add missing plist keys (F-t2-gatekeeper-2, F-t2-gatekeeper-4).
4. Set up notarization via `@electron/notarize`.

Requires Apple Developer Program account (~$99/year) and ~10-min notarization per release.
