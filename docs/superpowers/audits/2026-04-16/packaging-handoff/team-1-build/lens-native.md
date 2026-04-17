# Native Module Build Pipeline Audit (Electron 39, arm64)

## Summary

The native module rebuild pipeline is **PRESENT but INCOMPLETE**. `better-sqlite3` (v12.8.0) and `node-pty` (v1.1.0) are correctly unpacked into `app.asar.unpacked` for dlopen access, and the dev workflow includes `electron-rebuild` in postinstall and predev hooks. However, the **production build pipeline does NOT invoke electron-rebuild**, relying on electron-builder's default auto-detection and optional npm install step. The critical risk is that unless electron-builder independently invokes rebuild (which is version-dependent and not documented in the yml), the native modules bundled into the DMG will be rebuilt against system Node.js ABI 141, not Electron 39's ABI 140. This creates a NODE_MODULE_VERSION mismatch at app launch if the user's build machine has a different system Node version than the machine that built the packaged app.

---

## F-t1-native-1: Production build script does not invoke electron-rebuild
**Severity:** Critical  
**Category:** rebuild  
**Location:** `/Users/ryan/projects/BDE/package.json:25`  
**Evidence:**
```
"package": "npm run build && electron-builder --mac --arm64"
```
The `package` script runs `npm run build` (electron-vite only) then `electron-builder --mac --arm64`. It does **not** call `electron-rebuild` before electron-builder. Compare with dev:
```
"predev": "electron-rebuild -f -w better-sqlite3"
```
**Impact:** When `npm run package` is executed, better-sqlite3 and node-pty are built against system Node.js ABI (141 on build machine at time of audit), not Electron 39's ABI (140). If the packaged app is later launched on a machine with a different Node version, or if users extract the DMG and re-import it, native module loading fails with `Error: Module version mismatch. Expected ABI 140, got 141` at `require('better-sqlite3')`.  
**Recommendation:** Wrap the production build to rebuild against Electron before electron-builder:
```json
"package": "npm run build && electron-rebuild -f -a arm64 -v 39.8.6 && electron-builder --mac --arm64"
```
Or add an `install-app-deps` step if using electron-builder's built-in npm rebuild support (requires checking electron-builder version compatibility).  
**Effort:** S  
**Confidence:** High

---

## F-t1-native-2: electron-builder.yml lacks npmRebuild and asarUnpack directives
**Severity:** High  
**Category:** rebuild, asarUnpack  
**Location:** `/Users/ryan/projects/BDE/electron-builder.yml (lines 1-30)`  
**Evidence:**
The yml is minimal and does not include:
- `npmRebuild: false` (explicitly disable npm rebuild if electron-builder auto-detects)
- `asarUnpack` array specifying which modules need unpacking
- `afterPack` / `afterSign` hook to invoke rebuild

Instead, electron-builder relies on **default behavior**:
- By default, electron-builder runs `npm install --production --platform-target` (or similar) in the build directory
- Auto-detection of native modules to unpack is version-dependent and undocumented for v26.8.1
- If auto-detection fails, native modules end up in `app.asar` and fail to load at runtime

**Impact:** Unpredictable behavior depending on electron-builder version. Native modules MAY be correctly unpacked and rebuilt, or they MAY remain in app.asar (causing dlopen failure). The audit found them correctly unpacked (Apr 10 DMG), but without explicit config, future builds may break.  
**Recommendation:** Explicitly configure electron-builder.yml:
```yaml
npmRebuild: true
asarUnpack:
  - node_modules/better-sqlite3/build/**/*.node
  - node_modules/node-pty/build/**/*.node
  - node_modules/node-pty/bin/**/*.node
```
And add a prebuilt hook in the build script to ensure rebuild happens before electron-builder:
```bash
electron-rebuild -f -a arm64 -v "$ELECTRON_VERSION" --build-from-source
```
**Effort:** M  
**Confidence:** High

---

## F-t1-native-3: ABI mismatch risk: Electron 39 ABI 140 vs system Node.js ABI 141
**Severity:** Critical  
**Category:** abi  
**Location:** `/Users/ryan/projects/BDE/node_modules/electron/abi_version`, system Node.js v25.8.1  
**Evidence:**
- Electron 39.8.6 (in package-lock.json, used in package.json devDependencies) → **ABI 140**
- System Node.js v25.8.1 (on build machine) → **ABI 141**

The postinstall and predev scripts call:
```json
"postinstall": "node scripts/check-xcode-clt.js && electron-rebuild -f -w better-sqlite3"
```
This rebuilds for **system Node.js**, not Electron, because electron-rebuild defaults to the system Node ABI unless explicitly passed `--version` or `ELECTRON_BUILDER_TARGET` env var.

When the app launches, the Electron runtime (ABI 140) tries to load better-sqlite3.node (built for ABI 141), and fails.

**Impact:** App crash on DB open with `MODULE_VERSION mismatch` or similar native addon error. Terminal feature (node-pty) also fails silently (caught by lazy-load try/catch in pty.ts:5-10, but app loses terminal capability).  
**Recommendation:** Explicitly pass Electron version to electron-rebuild:
```json
"postinstall": "node scripts/check-xcode-clt.js && electron-rebuild -f -w better-sqlite3 -v 39.8.6"
"predev": "electron-rebuild -f -w better-sqlite3 -v 39.8.6"
```
Or set env var:
```bash
ELECTRON_BUILDER_TARGET=39.8.6 electron-rebuild -f -w better-sqlite3
```
Also update predev to target Electron:
```json
"predev": "electron-rebuild -f -w better-sqlite3 -v 39.8.6"
```
**Effort:** S  
**Confidence:** High

---

## F-t1-native-4: electron-rebuild v4.0.3 requires Node.js >=22.12.0, may conflict with postinstall
**Severity:** Medium  
**Category:** rebuild  
**Location:** `/Users/ryan/projects/BDE/package-lock.json` → `@electron/rebuild@4.0.3.engines.node`  
**Evidence:**
```
"@electron/rebuild": {
  "version": "4.0.3",
  "engines": {
    "node": ">=22.12.0"
  }
}
```
But package.json specifies:
```json
"engines": {
  "node": "^20.19.0 || >=22.12.0"
}
```
Current machine Node: v25.8.1 (satisfies >=22.12.0).

If a developer with Node 20.x runs `npm install`, npm will NOT block (because package.json allows 20.x), but then `postinstall` will run and electron-rebuild v4.0.3 will execute... and may silently fail or skip rebuild (behavior undefined for Node <22.12.0).

**Impact:** Silent rebuild failure on older Node versions. Developers on Node 20.x who run `npm install` will have incompatible better-sqlite3 binaries and fail tests.  
**Recommendation:** Add a preinstall check or clarify in CLAUDE.md that Node >=22.12.0 is required for development (since @electron/rebuild v4.0.3 is mandatory post-npm-install).  
**Effort:** S  
**Confidence:** Medium

---

## F-t1-native-5: node-pty postinstall script runs but only cleans build artifacts, does not rebuild for Electron
**Severity:** High  
**Category:** rebuild  
**Location:** `/Users/ryan/projects/BDE/node_modules/node-pty/scripts/post-install.js` (first 40 lines)  
**Evidence:**
```js
console.log('\x1b[32m> Cleaning release folder...\x1b[0m');
// Deletes build files, does NOT rebuild
```
The postinstall only cleans old binaries. Actual build is triggered by npm install script:
```json
"install": "node scripts/prebuild.js || node-gyp rebuild"
```
This rebuilds for **system Node.js**, not Electron.

**Impact:** node-pty.node in the packaged app will be ABI 141 (system Node), not ABI 140 (Electron). Lazy-load try/catch in pty.ts:5-10 masks the error, but terminal feature silently fails and users cannot spawn shells.  
**Recommendation:** Same as F-t1-native-3: ensure all npm install hooks rebuild for Electron. Add electron-rebuild as a postinstall after better-sqlite3:
```json
"postinstall": "node scripts/check-xcode-clt.js && electron-rebuild -f -w better-sqlite3,node-pty -v 39.8.6"
```
**Effort:** S  
**Confidence:** High

---

## F-t1-native-6: asarUnpack correctly configured (implicit auto-detection), native modules in app.asar.unpacked
**Severity:** Low (Informational, passing)  
**Category:** asarUnpack  
**Location:** `/Users/ryan/projects/BDE/release/mac-arm64/BDE.app/Contents/Resources/app.asar.unpacked/`  
**Evidence:**
Verified in packaged DMG (Apr 10 build):
```
app.asar.unpacked/
  node_modules/
    better-sqlite3/
      build/Release/better_sqlite3.node ✓
    node-pty/
      build/Release/pty.node ✓
      bin/darwin-arm64-140/node-pty.node ✓
      prebuilds/darwin-arm64/pty.node ✓
```
electron-builder correctly unpacked all .node files and native subdirectories. This suggests electron-builder 26.8.1's auto-detection is working.

**Impact:** None (passing). Native modules can be loaded via dlopen at runtime.  
**Recommendation:** Despite passing, **explicitly document** in electron-builder.yml to guarantee future builds remain unpacked:
```yaml
asarUnpack:
  - node_modules/better-sqlite3/**/*.node
  - node_modules/node-pty/**/*.node
```
**Effort:** S  
**Confidence:** High

---

## F-t1-native-7: electron-vite correctly externalizes better-sqlite3, node-pty, jsdom from bundle
**Severity:** Low (Informational, passing)  
**Category:** rebuild  
**Location:** `/Users/ryan/projects/BDE/electron.vite.config.ts:9-11`  
**Evidence:**
```ts
external: ['node-pty', 'better-sqlite3', 'jsdom']
```
The main process is built with rollup-external, so requires() of native modules are NOT bundled into out/main/index.js, and npm modules are loaded from node_modules at runtime.

**Impact:** None (passing). This is correct and necessary for native modules.  
**Recommendation:** No action. Continue to externalize native modules.  
**Effort:** N/A  
**Confidence:** High

---

## F-t1-native-8: db.ts loads better-sqlite3 at module-import time, early crash on ABI mismatch
**Severity:** High  
**Category:** abi  
**Location:** `/Users/ryan/projects/BDE/src/main/db.ts:1`  
**Evidence:**
```ts
import Database from 'better-sqlite3'
```
This is a top-level import, not lazy-loaded. It means db.ts fails to parse/load if better-sqlite3 is missing or ABI-incompatible.

Compare with pty.ts:
```ts
let pty: typeof import('node-pty') | null = null
try {
  pty = require('node-pty')
} catch {
  /* terminal unavailable */
}
```
pty.ts gracefully handles load failure. db.ts does not.

**Impact:** App crashes immediately on launch with `Cannot find module 'better-sqlite3'` or `NODE_MODULE_VERSION mismatch` if ABI is wrong. No recovery, no graceful degradation.  
**Recommendation:** While not strictly part of the rebuild pipeline, consider lazy-loading or try/catch in db.ts to improve error resilience:
```ts
let Database: typeof import('better-sqlite3').default | null = null
try {
  Database = require('better-sqlite3').default
} catch (err) {
  throw new Error(
    `Failed to load better-sqlite3 native module. Ensure it was rebuilt for Electron 39 (ABI 140).\n${getErrorMessage(err)}`
  )
}
```
**Effort:** M  
**Confidence:** High

---

## F-t1-native-9: vitest-global-setup correctly rebuilds better-sqlite3 for Node.js in test context
**Severity:** Low (Informational, passing)  
**Category:** rebuild  
**Location:** `/Users/ryan/projects/BDE/src/main/vitest-global-setup.ts:19-44`  
**Evidence:**
```ts
function isNativeModuleCompatible(): boolean {
  try {
    execFileSync(
      process.execPath,
      ['-e', "const db = require('better-sqlite3')(':memory:'); db.close();"],
      { stdio: 'pipe', cwd: process.cwd(), timeout: 10_000 }
    )
    return true
  } catch {
    return false
  }
}
export function setup(): void {
  if (isNativeModuleCompatible()) return
  console.log('[vitest-global-setup] better-sqlite3 native binary is incompatible with current Node.js. Rebuilding...')
  try {
    execFileSync('node-gyp', ['rebuild', '--directory=node_modules/better-sqlite3'], ...)
```
This is correct: before running tests, verify better-sqlite3 is compatible with the test Node.js, and rebuild if needed.

**Impact:** None (passing). Tests will not fail due to ABI mismatch.  
**Recommendation:** No action. This pattern is excellent and should be documented as an example for other tools that depend on better-sqlite3.  
**Effort:** N/A  
**Confidence:** High

---

## F-t1-native-10: package-lock.json pins all versions correctly, better-sqlite3 v12.8.0 has hasInstallScript
**Severity:** Low (Informational, passing)  
**Category:** rebuild  
**Location:** `/Users/ryan/projects/BDE/package-lock.json`  
**Evidence:**
```json
"better-sqlite3": {
  "version": "12.8.0",
  "resolved": "https://registry.npmjs.org/better-sqlite3/-/better-sqlite3-12.8.0.tgz",
  "hasInstallScript": true
},
"node-pty": {
  "version": "1.1.0",
  "resolved": "https://registry.npmjs.org/node-pty/-/node-pty-1.1.0.tgz",
  "hasInstallScript": true
},
"electron": {
  "version": "39.8.6",
  "resolved": "https://registry.npmjs.org/electron/-/electron-39.8.6.tgz"
}
```
Versions are locked. Both native packages have install scripts. Electron is known.

**Impact:** None (passing). Lock file is healthy.  
**Recommendation:** No action.  
**Effort:** N/A  
**Confidence:** High

---

## Summary of Recommended Changes

| Priority | Action | File | Effort |
|----------|--------|------|--------|
| 1 | Add `electron-rebuild -v 39.8.6` to package script before electron-builder | package.json | S |
| 2 | Update postinstall and predev to pass `-v 39.8.6` to electron-rebuild | package.json | S |
| 3 | Add explicit `asarUnpack` and `npmRebuild` directives to electron-builder.yml | electron-builder.yml | S |
| 4 | Clarify Node.js version requirement (>=22.12.0) in dev docs due to @electron/rebuild v4.0.3 constraint | CLAUDE.md or README | S |
| 5 | (Optional) Add try/catch around better-sqlite3 import in db.ts for clearer error messages | src/main/db.ts | M |

---

**Audit Date:** 2026-04-16  
**Electron Version:** 39.8.6 (ABI 140)  
**@electron/rebuild:** 4.0.3  
**System Node.js:** v25.8.1 (ABI 141)  
**Target Arch:** arm64  
**DMG Build Date:** 2026-04-10 (latest in release/)
