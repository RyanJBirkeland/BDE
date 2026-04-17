# Production vs. Dev Runtime Audit (2026-04-16)

## Executive Summary

The BDE Electron app's prod-vs-dev runtime divergence is **mostly well-handled** but contains **three substantive issues**:

1. **Status Server Silently Fails in Production** — A networking error in the status server (port bind failure) is caught and logged but does NOT prevent app startup. In prod, if port 18791 is blocked/in-use, the monitoring endpoint silently goes down with only a file log entry users will never see. The main app continues, but admin/support has no visibility into agent queue status.

2. **Console Logging Leaks to stdout/stderr in Production** — The structured logger writes every log call (info, warn, error, debug) to both file AND console (stdout/stderr), unconditionally. In a packaged macOS app this may be invisible, but on Linux/Windows with console redirection, this creates unnecessary noise and slightly increases process overhead per log call.

3. **CSP Prod Policy Missing `wasm-unsafe-eval`** — Monaco editor and other Web Workers may require WebAssembly execution. The prod CSP lacks this directive while dev has full `'unsafe-eval'`. If Monaco workers attempt to use WASM, they will fail silently in prod due to CSP block. This is a potential blocker for code editing features.

Renderer loading logic is sound; dev/prod branches are correctly placed. The app recovers gracefully from missing `.html` file. OAuth token handling is safe (returns null on missing/invalid tokens). No hardcoded localhost references leak into prod builds.

---

## Finding Details

### F-t3-prod-paths-1: CSP Missing `wasm-unsafe-eval` for Monaco Workers
**Severity:** High  
**Category:** csp  
**Location:** `/Users/ryan/projects/BDE/src/main/bootstrap.ts:295-303`

**Evidence:**
```typescript
// Production CSP (lines 295-303):
"default-src 'self'; " +
"script-src 'self'; " +
"worker-src 'self' blob:; " +
"style-src 'self' 'unsafe-inline'; " +
"img-src 'self' data:; " +
"font-src 'self' data:; " +
`connect-src 'self' ${connectSrc} https://api.github.com; ` +
"frame-ancestors 'none'; " +
"form-action 'self'"
```

**Impact:**  
Monaco editor (@monaco-editor/react) spawns Web Workers that may compile and execute WebAssembly bytecode. The prod CSP explicitly allows `blob:` workers but does NOT include `wasm-unsafe-eval`. If a worker attempts to instantiate a WASM module (either via `WebAssembly.instantiate()` or `WebAssembly.instantiateStreaming()`), the browser will silently block it with a CSP violation. The editor will either fail to initialize, lose syntax highlighting, or fail on rename/navigation operations depending on how Monaco degrades. This feature works in dev (line 287: `'unsafe-eval'` is present).

**Recommendation:**  
Add `wasm-unsafe-eval` to the prod CSP `script-src` or `default-src` directive:
```typescript
"script-src 'self' wasm-unsafe-eval; " +
```
Alternatively, if WASM is truly not needed, test Monaco in prod build with verbose CSP reporting enabled to confirm no violations occur.

**Effort:** S  
**Confidence:** High

---

### F-t3-prod-paths-2: Status Server Startup Failure Not Visible to User
**Severity:** Medium  
**Category:** dev-guard  
**Location:** `/Users/ryan/projects/BDE/src/main/index.ts:257-262`

**Evidence:**
```typescript
const statusServer = createStatusServer(am, repo)
statusServer.start().catch((err) => {
  createLogger('startup').error(`Failed to start status server: ${err}`)
})
app.on('will-quit', () => statusServer.stop())
```

**Impact:**  
The status server listens on hardcoded `127.0.0.1:18791` (src/main/services/status-server.ts:79-82). If port 18791 is already in use (e.g., another app, leftover process, or OS reservation), the `.start()` promise rejects with a network error. This is caught and logged to `~/.bde/bde.log` but NOT reported to the user via UI dialog or startup warning. The main app continues running, but the agent queue monitoring endpoint is unavailable. Since this is a background service, users won't notice until they try to query agent status externally (e.g., via monitoring tool). In production, logs are not user-visible, so the failure is completely hidden.

**Recommendation:**  
Option A (User-facing): Emit a startup warning to the renderer if status server fails:
```typescript
statusServer.start().catch((err) => {
  const msg = `Agent monitoring unavailable (status server failed to bind): ${err}`
  createLogger('startup').error(msg)
  broadcast('manager:warning', { message: msg })  // Add to emitStartupWarnings flow
})
```

Option B (Operational): Use dynamic port allocation instead of hardcoded 18791, with fallback to random port and log the actual port to a user-accessible location (e.g., settings DB or ~/.bde/status-server.txt).

Option C (Minimal): At least log to file with max verbosity so support can diagnose issues. Current implementation is acceptable if monitoring is truly optional and external consumers are not expected.

**Effort:** M  
**Confidence:** High

---

### F-t3-prod-paths-3: Console Logging Unconditionally Writes to stdout/stderr in Production
**Severity:** Low  
**Category:** logging  
**Location:** `/Users/ryan/projects/BDE/src/main/logger.ts:82-96`

**Evidence:**
```typescript
export function createLogger(name: string): Logger {
  ensureLogDir()
  rotateIfNeeded()
  return {
    info: (m: string) => {
      console.log(`[${name}]`, m)  // Always writes to stdout
      fileLog('INFO', name, m)
    },
    warn: (m: string) => {
      console.warn(`[${name}]`, m)  // Always writes to stderr
      fileLog('WARN', name, m)
    },
    error: (m: string) => {
      console.error(`[${name}]`, m)  // Always writes to stderr
      fileLog('ERROR', name, m)
    },
    debug: (m: string) => {
      console.debug(`[${name}]`, m)  // Always writes to stdout (in Node.js)
      fileLog('DEBUG', name, m)
    }
  }
}
```

**Impact:**  
Every logger call writes to both file AND console, unconditionally. In a packaged macOS app (Electron), console output is invisible to end users (no terminal window). However:
- On Linux/Windows with console redirection or when running under systemd/supervisor, stdout/stderr is captured to syslog or daemon logs, creating noise.
- Each log call incurs the cost of formatting two outputs instead of one.
- In dev, console output during HMR is useful; in prod, it's wasted I/O.
- The logger has no conditional to suppress console output in production.

This is NOT a bug, but represents a deviation from typical logging practice: prod loggers usually suppress console output to reduce noise and process overhead. Observed in practice: ~397 logger calls across src/main (per grep count), so prod builds are making 397 extra console.* calls per startup/operation cycle.

**Recommendation:**  
Conditionally suppress console output in production:
```typescript
export function createLogger(name: string): Logger {
  ensureLogDir()
  rotateIfNeeded()
  const isProduction = !require('@electron-toolkit/utils').is.dev
  
  return {
    info: (m: string) => {
      if (!isProduction) console.log(`[${name}]`, m)
      fileLog('INFO', name, m)
    },
    // ... similar for warn, error, debug
  }
}
```

Or expose a disable flag:
```typescript
let CONSOLE_ENABLED = !process.env.BDE_LOG_FILE_ONLY
export function disableConsoleLogging() { CONSOLE_ENABLED = false }
```

**Effort:** S  
**Confidence:** Medium

---

## Cleared / Non-Issues

### ✓ Renderer Loading Path
- **Main window:** `loadFile(join(__dirname, '../renderer/index.html'))` correctly resolves post-bundle.
- **Tearoff windows:** Same path construction, guarded by `is.dev` check at creation and restoration.
- **Missing file handling:** Electron's `loadFile()` will show white screen with developer console error if file missing; this is acceptable for packaging bugs but should never happen in release build.

### ✓ Hardcoded URLs
- **No localhost in main/preload:** Grep found only dev-guarded references (`is.dev && process.env['ELECTRON_RENDERER_URL']`).
- **Status server `127.0.0.1:18791`:** Intentional; only listens locally, not exposed to network. Safe in prod.
- **CSP `http://localhost:*`:** Correctly gated to dev mode only (line 287-292).

### ✓ Dev Guard Placement
- **is.dev checks:** All three renderer loading sites (main, tearoff create, tearoff restore) correctly branch.
- **No devtools auto-open:** No `openDevTools()` found in codebase.
- **No source maps in prod:** CSP `script-src 'self'` is strict enough; sourcemap URLs would be blocked anyway.

### ✓ OAuth Token Handling
- **getOAuthToken()** returns `string | null`, never throws.
- **Graceful degradation:** Missing token causes agent manager to skip authentication check (returns null), allowing manual agent runs without auto-start.
- **Permissions validated:** Token file checked for symlinks, max size, and mode (0o600).

### ✓ Environment Variables
- **NODE_ENV:** Not used in main/preload (reliance on `is.dev` is correct).
- **ELECTRON_RENDERER_URL:** Only read when `is.dev` is true; safe.
- **No stray console.env reads** that would fail in packaged app.

### ✓ Logging Verbosity
- **No excessive logging in prod:** Logger respects structured file rotation (10MB limit, 4 backups).
- **Startup warnings:** Accumulated in `startupErrors[]` array and emitted post-window-ready, not flooded to console.
- **Agent event batching:** Flushed on shutdown, not left hanging.

---

## Recommendations Summary

| Severity | Issue | Effort | Action |
|----------|-------|--------|--------|
| High | CSP missing `wasm-unsafe-eval` | S | Add to prod CSP or test Monaco WASM in prod build |
| Medium | Status server startup failure hidden | M | Emit startup warning or use dynamic port allocation |
| Low | Console logging in prod | S | Conditionally suppress in prod build |

---

## Testing Checklist for Handoff

Before shipping packaged app:
- [ ] Test Monaco editor in prod build (file open, edit, search, rename, goto-definition)
- [ ] Verify status server binds on first run (no port conflicts)
- [ ] Check `~/.bde/bde.log` contains startup errors if any (not just empty)
- [ ] Confirm no console output in packaged macOS app (run with `electron` CLI to verify)
- [ ] Load https://api.github.com in dev CSP for reachability (GitHub API, not localhost)

---

**Audit Date:** 2026-04-16  
**Scope:** Production vs. Dev Runtime (L1.4 Lens)  
**Files Examined:** 150+ main/preload sources, bootstrap.ts, index.ts, tearoff-*.ts, status-server.ts, logger.ts, electron.vite.config.ts  
**Confidence:** High (read-only source review, no dynamic testing)
