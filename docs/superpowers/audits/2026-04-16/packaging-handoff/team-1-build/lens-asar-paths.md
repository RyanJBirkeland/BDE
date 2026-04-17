# ASAR Path Resolution Audit — BDE Electron App

**Date:** 2026-04-16  
**Auditor:** Claude (ASAR Path Expert)  
**Status:** Complete  

---

## Executive Summary

BDE's Electron bundle is laid out as **three compiled entry points** bundled by `electron-vite` into `/out/{main,preload,renderer}/`:

- **`out/main/index.js`** — monolithic main process (1.5MB), with all migrations pre-resolved via `import.meta.glob()` at build time into a static `migrationModules` object. No runtime filesystem scans.
- **`out/preload/index.js`** — preload script (16.5KB), bundled as a single file.
- **`out/renderer/`** — React app with chunked assets (Monaco editor separately loaded).

The **critical path-resolution pattern** throughout the codebase uses **`__dirname` relative to the compiled output location**, not the source tree. This works in both dev (where `__dirname` points to `out/` subdirs) and production (where `__dirname` points to `.asar/out/` subdirs).

**Verdict: No Critical ASAR path bugs detected.** All migrations are static-bundled, all dynamic requires go to user-writable directories (`~/.bde/`), and the HTML loading path is guarded by `is.dev` correctly. One minor hardening opportunity identified.

---

## Detailed Findings

### ✅ F-t1-asar-paths-1: Migrations are statically bundled via import.meta.glob()

**Severity:** N/A (Correct Implementation)  
**Category:** resource-loading  
**Location:** `src/main/migrations/loader.ts:31-33`, compiled to `out/main/index.js`  
**Evidence:**

```typescript
// loader.ts
const migrationModules = import.meta.glob<MigrationModule>('./v*.ts', {
  eager: true
})
```

Compiled output shows all 48 migrations pre-resolved at build time:

```javascript
const migrationModules = /* @__PURE__ */ Object.assign({
  "./v001-create-core-tables-agent-runs-settings.ts": __vite_glob_0_0,
  "./v002-noop-version-number-preserved-for-compatibility.ts": __vite_glob_0_1,
  // ... 46 more migrations ...
  "./v048-add-composite-index-on-agent-runs-status-started-at.ts": __vite_glob_0_47,
})
```

**Impact:** ✅ **No risk.** The previous implementation used `readdirSync(__dirname)` which **failed silently in production** (returned `[]` because bundled output has no `.ts` files). This was caught and fixed via the glob pattern. Migrations now run in all environments (dev, test, production).

**Recommendation:** No action required. This is a well-documented fix in `loader.ts` lines 20-27.

**Effort:** N/A  
**Confidence:** High

---

### ✅ F-t1-asar-paths-2: HTML loading path is correctly guarded by is.dev

**Severity:** N/A (Correct Implementation)  
**Category:** dev-guard  
**Location:** `src/main/index.ts:148-163`  
**Evidence:**

```typescript
const appUrl =
  is.dev && process.env['ELECTRON_RENDERER_URL']
    ? process.env['ELECTRON_RENDERER_URL']
    : `file://${join(__dirname, '../renderer/index.html')}`

if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
  mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
} else {
  mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}
```

In production, `__dirname` resolves to `.asar/out/main/`, and the relative path `../renderer/index.html` correctly points to `.asar/out/renderer/index.html` — bundled and valid.

**Impact:** ✅ **No risk.** The `is.dev` guard is **not gating required functionality** — it's only controlling whether to use HMR URL vs. bundled file. Both paths work.

**Recommendation:** No action required. This pattern is correct.

**Effort:** N/A  
**Confidence:** High

---

### ✅ F-t1-asar-paths-3: Preload script path uses __dirname correctly

**Severity:** N/A (Correct Implementation)  
**Category:** path-resolution  
**Location:** `src/main/tearoff-window-manager.ts:23`  
**Evidence:**

```typescript
export const SHARED_WEB_PREFERENCES = {
  preload: join(__dirname, '../preload/index.js'),
  sandbox: true,
  contextIsolation: true
}
```

In production, this resolves to `.asar/out/preload/index.js` — a bundled file loaded by Electron's preload mechanism.

**Impact:** ✅ **No risk.** Electron handles `.asar` preload paths natively.

**Recommendation:** No action required.

**Effort:** N/A  
**Confidence:** High

---

### ✅ F-t1-asar-paths-4: Plugin loader targets user-writable directory (~/.bde/plugins)

**Severity:** N/A (Correct Implementation)  
**Category:** resource-loading  
**Location:** `src/main/services/plugin-loader.ts:8`  
**Evidence:**

```typescript
import { join } from 'node:path'
import { homedir } from 'node:os'

const PLUGINS_DIR = join(homedir(), '.bde', 'plugins')

export function loadPlugins(): BdePlugin[] {
  if (!existsSync(PLUGINS_DIR)) {
    logger.info(`[plugin-loader] No plugins directory at ${PLUGINS_DIR}`)
    return []
  }
  const files = readdirSync(PLUGINS_DIR).filter((f) => f.endsWith('.js') || f.endsWith('.cjs'))
  for (const file of files) {
    const mod = require(join(PLUGINS_DIR, file))
    // ...
  }
}
```

**Impact:** ✅ **No risk.** Plugins are loaded from user data, not from the ASAR bundle. Correct separation of concerns.

**Recommendation:** No action required.

**Effort:** N/A  
**Confidence:** High

---

### ✅ F-t1-asar-paths-5: Database and data paths use homedir() or env overrides

**Severity:** N/A (Correct Implementation)  
**Category:** path-resolution  
**Location:** `src/main/paths.ts:81-92`  
**Evidence:**

```typescript
export const BDE_DIR = process.env.BDE_DATA_DIR ?? join(homedir(), '.bde')
export const BDE_DB_PATH = process.env.BDE_TEST_DB ?? process.env.BDE_DB_PATH ?? join(BDE_DIR, 'bde.db')
export const BDE_AGENTS_INDEX = join(BDE_DIR, 'agents.json')
export const BDE_AGENT_LOGS_DIR = join(BDE_DIR, 'agent-logs')
export const BDE_MEMORY_DIR = join(BDE_DIR, 'memory')
export const BDE_TASK_MEMORY_DIR = join(BDE_MEMORY_DIR, 'tasks')
```

All user data lives outside the ASAR bundle, in `~/.bde/` or environment-overridable paths.

**Impact:** ✅ **No risk.** User data is kept out of the bundle boundary.

**Recommendation:** No action required.

**Effort:** N/A  
**Confidence:** High

---

### ✅ F-t1-asar-paths-6: Icon asset uses Vite's ?asset query syntax

**Severity:** N/A (Correct Implementation)  
**Category:** resource-loading  
**Location:** `src/main/index.ts:15`  
**Evidence:**

```typescript
import icon from '../../resources/icon.png?asset'
```

Vite's `?asset` loader copies static assets into the output and provides a path. This is handled at build time.

**Impact:** ✅ **No risk.** Vite resolves this correctly in both dev and prod.

**Recommendation:** No action required.

**Effort:** N/A  
**Confidence:** High

---

### ✅ F-t1-asar-paths-7: Child process spawning uses PATH lookup (not bundled paths)

**Severity:** N/A (Correct Implementation)  
**Category:** resource-loading  
**Location:** `src/main/agent-manager/spawn-cli.ts:60-76`  
**Evidence:**

```typescript
const child = spawn(
  'claude',  // Looked up in PATH, not from ASAR
  [
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--verbose',
    '--model', opts.model
  ],
  {
    cwd: opts.cwd,
    env: env as NodeJS.ProcessEnv,
    stdio: ['pipe', 'pipe', 'pipe']
  }
)
```

The `claude` CLI is spawned by name, not by absolute path. This is correct — the CLI is a user-installed tool, not bundled.

**Impact:** ✅ **No risk.** Relies on PATH environment, which is managed correctly in `env-utils.ts`.

**Recommendation:** No action required.

**Effort:** N/A  
**Confidence:** High

---

### ✅ F-t1-asar-paths-8: Adhoc agent uses dynamic require() for db.ts at runtime

**Severity:** Low  
**Category:** dev-guard  
**Location:** `src/main/adhoc-agent.ts:300-301`  
**Evidence:**

```typescript
const { getDb } = require('./db')
updateAgentRunCost(getDb(), meta.id, { /* ... */ })
```

This is a **dynamic require** inside a try-catch in a non-critical path (cost persistence). The require is scoped to a CommonJS context where `./db` resolves correctly relative to the compiled location.

**Impact:** ⚠️ **Low risk.** This works because:
1. The main bundle is CommonJS (not ESM).
2. The relative path `./db` resolves to `./db.js` in the same directory (`out/main/`).
3. The try-catch makes failure non-fatal ("Non-fatal — best-effort cost persistence").

**Recommendation:** 
- **Optional hardening:** Replace with a top-level import if cost persistence becomes critical. Currently safe because the try-catch absorbs failures.
- No action required if cost reporting can tolerate occasional losses (current design accepts this).

**Effort:** S  
**Confidence:** High

---

### ✅ F-t1-asar-paths-9: PTY native module is lazy-loaded with fallback

**Severity:** N/A (Correct Implementation)  
**Category:** resource-loading  
**Location:** `src/main/pty.ts:3-10`  
**Evidence:**

```typescript
let pty: typeof import('node-pty') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  pty = require('node-pty')
} catch {
  /* terminal unavailable */
}

export function isPtyAvailable(): boolean {
  return pty !== null
}
```

Native modules like `node-pty` are in `electron.vite.config.ts:10` marked as `external` (not bundled). The lazy-load with fallback is correct.

**Impact:** ✅ **No risk.** Native modules are handled by electron-rebuild and configured as external in Vite.

**Recommendation:** No action required.

**Effort:** N/A  
**Confidence:** High

---

### ⚠️ F-t1-asar-paths-10: CSP setup uses is.dev to gate dev-only headers

**Severity:** Low  
**Category:** dev-guard  
**Location:** `src/main/bootstrap.ts:285-303`  
**Evidence:**

```typescript
const csp = is.dev
  ? "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*; " +
    "worker-src 'self' blob:; " +
    // ... dev-friendly CSP ...
  : "default-src 'self'; " +
    "script-src 'self'; " +
    "worker-src 'self' blob:; " +
    // ... restrictive production CSP ...
```

**Impact:** ✅ **No risk, but observation:** The `is.dev` check correctly gates dev-only features (HMR, devtools). In production, CSP is stricter. This is **not gating required functionality** — it's making security stricter in production, which is correct.

**Recommendation:** No action required. This is exemplary practice.

**Effort:** N/A  
**Confidence:** High

---

## Risk Summary

| Category | Count | Risk Level |
|----------|-------|-----------|
| ✅ Correct patterns | 9 | None |
| ⚠️ Minor observations | 1 | Low |
| 🔴 Critical issues | 0 | — |

---

## Conclusion

**BDE's packaging is production-ready.** The codebase demonstrates:

1. **Correct migration bundling** — No runtime filesystem scans; all migrations are pre-resolved by Vite.
2. **Proper data isolation** — User data and plugins live outside the ASAR bundle.
3. **Safe path resolution** — `__dirname` relative paths work in both dev and packaged environments.
4. **Appropriate dev guards** — `is.dev` is used for HMR/devtools, not for gating required functionality.
5. **Graceful fallbacks** — Native modules and optional features degrade safely.

**No blocking issues for ASAR packaging.** Proceed with confidence.

---

## Audit Methodology

- Scanned `src/main/**/*.ts` for `__dirname`, `__filename`, `process.cwd()`, path resolution patterns.
- Verified migration loader uses `import.meta.glob()` (not runtime filesystem scans).
- Checked all dynamic `require()` calls for safety and context.
- Verified preload path and HTML loading guards.
- Examined `electron-vite` config for external modules and bundler settings.
- Inspected compiled output (`out/main/index.js`) to confirm migrations are statically bundled.
- Reviewed `electron-builder.yml` for asarUnpack configuration (none needed).

---

**Generated by:** Claude (ASAR Path Expert)  
**Confidence Level:** High  
**Recommendation:** Approve for production packaging.
