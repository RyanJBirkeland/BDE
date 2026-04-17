# L1.1 Builder Lens — electron-builder Configuration Audit

**Date:** 2026-04-16
**Auditor:** Claude (electron-builder Expert)

## Summary

The BDE macOS packaging configuration is **functional but contains several configuration gaps** that create risks for distribution and user experience on fresh Macs. The app successfully builds a 507MB arm64 DMG with proper ASAR bundling, automatic unpacking of native modules (better-sqlite3, node-pty, @anthropic-ai/claude-agent-sdk), and a valid ad-hoc signature. However, the configuration lacks proper signing entitlements, missing explicit ASAR unpacking rules, no copyright statement in the config, absent DMG background image specification, and incomplete macOS permission declarations. The build outputs correctly to `release/` with proper artifact naming, but several production-readiness issues would prevent successful distribution outside a single developer's machine.

---

## F-t1-builder-1: Missing afterSign Hook Configuration

**Severity:** High
**Category:** signing
**Location:** `electron-builder.yml` (entire file); `/Users/ryan/projects/BDE/scripts/after-sign.sh` exists but unused
**Evidence:** The script `/Users/ryan/projects/BDE/scripts/after-sign.sh` performs ad-hoc re-signing (`codesign --deep --force --sign -`) to handle Team ID mismatches on macOS 26. However, electron-builder.yml contains no `afterSign` hook configuration. The app is currently signed with `adhoc` signature and `Identifier=Electron` (default), not the expected `com.rbtechbot.bde` bundle identifier.

**Impact:** On a fresh Mac with Gatekeeper enabled (macOS 12+), the unsigned app will prompt users with "BDE cannot be opened because the developer cannot be verified" and will not run without user intervention (Right-click > Open). Distribution via DMG becomes problematic.

**Recommendation:** Add to `electron-builder.yml` under the `mac:` section:
```yaml
mac:
  identity: null
  hardenedRuntime: false
  gatekeeperAssess: false
  afterSign: scripts/after-sign.sh
```
Or alternatively, configure proper code signing if certificates are available.

**Effort:** S
**Confidence:** High

---

## F-t1-builder-2: Unsigned App Missing Entitlements Declaration

**Severity:** High
**Category:** plist
**Location:** `/Users/ryan/projects/BDE/release/mac-arm64/BDE.app/Contents/Info.plist` lines 1-114
**Evidence:** The app declares permission descriptions (NSMicrophoneUsageDescription, NSCameraUsageDescription, NSAudioCaptureUsageDescription, NSBluetoothAlwaysUsageDescription) in Info.plist, but the app binary has **no entitlements embedded** (`codesign -d --entitlements` returns empty). The ad-hoc signature includes `flags=0x20002(adhoc,linker-signed)` with sealed resources set to `none`.

**Impact:** Permission prompts will be silently suppressed on first launch. Users granting microphone/camera/Bluetooth access via System Preferences will see no effect in the app, leading to feature failures (terminal I/O, agent audio capture) without user awareness.

**Recommendation:** Create `/Users/ryan/projects/BDE/build/entitlements.mac.plist` with:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.device.audio-input</key>
  <true/>
  <key>com.apple.security.device.camera</key>
  <true/>
  <key>com.apple.security.device.bluetooth</key>
  <true/>
</dict>
</plist>
```
And reference in electron-builder.yml:
```yaml
mac:
  entitlements: build/entitlements.mac.plist
```

**Effort:** M
**Confidence:** High

---

## F-t1-builder-3: Missing asarUnpack Configuration

**Severity:** Medium
**Category:** config
**Location:** `electron-builder.yml` (no `asarUnpack` key); actual unpacking verified in `/Users/ryan/projects/BDE/release/mac-arm64/BDE.app/Contents/Resources/app.asar.unpacked/`
**Evidence:** The app.asar (162M) is built with automatic unpacking of native modules (better-sqlite3: 21M, node-pty: 2.8M, @anthropic-ai/claude-agent-sdk: 49M totaling 89M unpacked). This unpacking is **implicit and not declared** in electron-builder.yml. electron-builder auto-detects binary modules, but the configuration lacks explicit intent and documentation.

**Impact:** Future builds may fail silently if asarUnpack rules change. On a fresh Mac without the auto-detection heuristic working correctly (edge case), the ASAR would load modules from inside the archive, causing native module load failures (cannot find better-sqlite3 for ARM64 architecture).

**Recommendation:** Add explicit asarUnpack configuration to `electron-builder.yml`:
```yaml
asarUnpack:
  - node_modules/better-sqlite3/**/*
  - node_modules/node-pty/**/*
  - node_modules/@anthropic-ai/claude-agent-sdk/**/*
  - node_modules/@img/**/*
```

**Effort:** S
**Confidence:** Medium

---

## F-t1-builder-4: No Copyright Statement in electron-builder.yml

**Severity:** Medium
**Category:** metadata
**Location:** `electron-builder.yml` (missing `copyright` key)
**Evidence:** The Info.plist contains `NSHumanReadableCopyright = "Copyright © 2026 BDE"` but this is auto-generated. The electron-builder.yml has no `copyright` key at the root or `mac:` level. The copyright will revert to Electron's default if the build process changes.

**Impact:** Incorrect copyright attribution in About dialog and legal metadata on a fresh Mac running the app.

**Recommendation:** Add to `electron-builder.yml`:
```yaml
copyright: "Copyright © 2026 BDE"
```

**Effort:** S
**Confidence:** High

---

## F-t1-builder-5: DMG Configuration Missing App Icon Name Reference

**Severity:** Medium
**Category:** packaging
**Location:** `electron-builder.yml` lines 18-29 (`dmg:` section)
**Evidence:** The DMG `contents:` array has two entries (coordinates 130,220 and 410,220), but the first entry (the app icon) is missing a `name` field. electron-builder infers this as the app itself, but without explicit naming, layout is fragile. A fresh user mounting the DMG will see the app and Applications symlink but no labels, making it unclear what to drag.

**Impact:** Poor UX on first-time user experience. Users unfamiliar with drag-to-Applications workflows may not understand how to install the app.

**Recommendation:** Add explicit `name` fields:
```yaml
dmg:
  title: 'BDE ${version}'
  contents:
    - x: 130
      y: 220
      name: 'BDE'
    - x: 410
      y: 220
      type: link
      path: /Applications
      name: 'Applications'
  window:
    width: 540
    height: 380
```

**Effort:** S
**Confidence:** Medium

---

## F-t1-builder-6: DMG Background Image Not Specified (Silent Fallback)

**Severity:** Low
**Category:** packaging
**Location:** `electron-builder.yml` (missing `dmg.background` key)
**Evidence:** The DMG was successfully created and contains `.background.tiff` (37KB) and `.DS_Store` (16KB), indicating electron-builder auto-generated a default background. No `dmg.background` key is specified in the config. If a custom background is desired, it must be explicitly declared or the auto-generated default will be used.

**Impact:** Inconsistent branding on fresh Mac installs. If the maintainer later wants a custom background, the config must be explicitly updated. Current default is acceptable but not branded.

**Recommendation:** Either accept the default (no action needed) or explicitly reference a custom background:
```yaml
dmg:
  background: resources/dmg-background.tiff
```

**Effort:** S
**Confidence:** Low

---

## F-t1-builder-7: identity: null Does Not Produce Runnable Unsigned App by Default

**Severity:** High
**Category:** signing
**Location:** `electron-builder.yml` line 14 (`identity: null`)
**Evidence:** Setting `identity: null` tells electron-builder to skip re-signing, leaving the app with the default Electron signature. The built app has `Signature=adhoc` with `flags=0x20002(adhoc,linker-signed)`. On a fresh Mac running macOS 13+, unsigned apps require explicit System Preferences override or Right-click > Open. The ad-hoc signature is valid but non-distributable.

**Impact:** End users downloading the DMG on a fresh Mac will see Gatekeeper quarantine warnings. The app will not launch from Finder without user manually Right-clicking and selecting Open.

**Recommendation:** Either:
1. Configure proper signing with a developer certificate (requires Apple Developer account):
```yaml
mac:
  identity: "Developer ID Application: Company Name (XXXXXXXXXX)"
  certificateFile: path/to/cert.p12
  certificatePassword: "${CSC_KEY_PASSWORD}"
```
2. Or add a post-build step to remove quarantine attributes at install time (user-side):
```yaml
mac:
  afterSign: scripts/after-sign.sh
```
Currently, the app will require user workaround on every launch.

**Effort:** M
**Confidence:** High

---

## F-t1-builder-8: Large ASAR with No Explicit Size Optimization

**Severity:** Low
**Category:** packaging
**Location:** `/Users/ryan/projects/BDE/release/mac-arm64/BDE.app/Contents/Resources/app.asar` (162M)
**Evidence:** The ASAR archive is 162M, with app.asar.unpacked consuming 89M (35% of total). The `files` rule includes `- out/**/*` with no excludes beyond source maps (`- '!out/**/*.map'`). The out/ directory contains built JS but likely includes locale files from Electron framework (.lproj directories total 62 entries in Resources/).

**Impact:** Slower DMG download, mount, and extraction on a fresh Mac with poor network connectivity. DMG is 170M total.

**Recommendation:** Add excludes for unneeded locale files (optional optimization):
```yaml
files:
  - out/**/*
  - '!out/**/*.map'
  - '!out/**/*.{ts,tsx,css}'
```

**Effort:** L
**Confidence:** Low

---

## F-t1-builder-9: hardenedRuntime: false Disables Code Signing Hardening

**Severity:** High
**Category:** signing
**Location:** `electron-builder.yml` line 15
**Evidence:** `hardenedRuntime: false` disables Apple's Runtime Hardening requirements. Combined with `identity: null`, the app is built without hardened runtime protections. On macOS 13+, unsigned apps with disabled hardening will trigger additional Gatekeeper warnings.

**Impact:** Users on a fresh Mac will see a more aggressive warning: "BDE cannot be opened because Apple cannot check it for malicious software." Even after user approval, the app lacks runtime protections against code injection and memory corruption exploits.

**Recommendation:** Enable hardened runtime:
```yaml
mac:
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
```
This requires proper entitlements (see F-t1-builder-2) but is essential for user security and Gatekeeper compatibility on modern macOS.

**Effort:** M
**Confidence:** High

---

## F-t1-builder-10: gatekeeperAssess: false Bypasses Gatekeeper Security Check

**Severity:** Medium
**Category:** signing
**Location:** `electron-builder.yml` line 16
**Evidence:** `gatekeeperAssess: false` skips Gatekeeper assessment entirely during the build process. Combined with `identity: null` and `hardenedRuntime: false`, the app is built with three layers of security disabled.

**Impact:** On a fresh Mac, the system's Gatekeeper will assess the unsigned app at runtime and block it. The build-time `gatekeeperAssess: false` simply skips early detection, pushing the problem to end users.

**Recommendation:** Enable Gatekeeper assessment:
```yaml
mac:
  gatekeeperAssess: true
```
Or implement proper code signing (see F-t1-builder-1 and F-t1-builder-7).

**Effort:** S
**Confidence:** Medium

---

## Next Steps for Production Distribution

1. Implement proper code signing with Apple Developer Certificate (requires CSC_KEY_PASSWORD env var)
2. Add `afterSign: scripts/after-sign.sh` hook to handle Team ID mismatches
3. Create and reference entitlements.mac.plist for permission declarations
4. Enable `hardenedRuntime: true` and `gatekeeperAssess: true`
5. Add explicit `asarUnpack` rules for native module safety
6. Add copyright and DMG metadata (app icon names, background)
7. Test full DMG build workflow on a clean macOS VM to verify Gatekeeper behavior
