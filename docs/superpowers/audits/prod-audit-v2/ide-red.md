# IDE -- Red Team Follow-Up Audit (v2)

**Date:** 2026-03-29
**Scope:** 11 source files + 1 integration test
**Persona:** Red Team (Security)
**Previous audit:** `docs/superpowers/audits/prod-audit/ide-red.md` (2026-03-29)

---

## Findings Status

### IDE-RED-1: `fs:watchDir` accepts any path as IDE root -- FIXED

**Previous severity:** High
**Status:** Fixed
**File:** `src/main/handlers/ide-fs-handlers.ts:21-45`

The `fs:watchDir` handler now calls `validateIdeRoot(dirPath)` before setting `ideRootPath`. This async function:
1. Resolves the path to an absolute path
2. Validates it is within the user's home directory (`homedir()`)
3. Verifies the path exists and is a directory via `stat()`

The validated path is used for both `ideRootPath` assignment and the `fs.watch()` call. The watcher also has an error handler (IDE-6 fix) that gracefully stops the watcher on EMFILE/EACCES errors.

**Remaining concern (minor):** The validation uses `resolve()` but does not call `realpathSync()` on the input. A symlink at `~/evil -> /` would pass the textual `startsWith(homeDir)` check but resolve to `/` on the filesystem. However, the `stat()` call would succeed (root is a directory), so the check alone does not prevent this. In practice, `~/evil -> /` is an unlikely scenario since the user would have to create this symlink themselves, and the `openDirectoryDialog()` UI path returns the symlink target (resolved path) on macOS. Risk: **Low** (attacker needs write access to `$HOME`).

**Verdict:** Fixed. The high-severity unrestricted path issue is resolved. The residual symlink concern is low-risk.

---

### IDE-RED-2: `validateIdePath` returns pre-symlink path (TOCTOU) -- FIXED

**Previous severity:** Medium
**Status:** Fixed
**File:** `src/main/handlers/ide-fs-handlers.ts:94`

The function now returns `real` (the `realpathSync`-resolved canonical path) instead of `resolved`. Line 94: `return real`. All callers (`readDir`, `readFile`, `writeFile`, `createFile`, `createDir`, `rename`, `delete`, `stat`) operate on the canonical path, eliminating the TOCTOU race window.

The integration test has been updated to expect canonical paths (lines 56, 65, 71, 77 of `ide-path-traversal.test.ts`).

**Verdict:** Fixed.

---

### IDE-RED-3: Fallback path for non-existent files skips symlink resolution -- FIXED

**Previous severity:** Medium
**Status:** Fixed
**File:** `src/main/handlers/ide-fs-handlers.ts:72-87`

The fallback now resolves the **parent** directory via `realpathSync(parent)` when the full path does not exist (lines 74-77). This correctly handles the case where a symlink in an intermediate directory component would escape the root. Only if the parent also fails to resolve does it fall back to the textual prefix check (lines 80-86), which is now a deeper fallback for the case where multiple levels of the path do not exist.

The comment `// IDE-3:` documents the fix rationale.

**Verdict:** Fixed.

---

### IDE-RED-4: No filename sanitization in create/rename operations -- FIXED

**Previous severity:** Medium
**Status:** Fixed
**File:** `src/renderer/src/components/ide/FileSidebar.tsx:31-43`

A `sanitizeFilename()` function has been added that rejects:
- Empty/whitespace-only names
- Names containing `/` or `\` (path separators)
- Names equal to `.` or `..`
- Names containing null bytes or control characters (`\x00-\x1f`, `\x7f`)

This sanitizer is called in `handleNewFile` (line 48), `handleNewFolder` (line 64), and `handleRename` (line 84) before any IPC call. Each rejection shows a user-visible toast error.

This is defense-in-depth on the renderer side. The main-process `validateIdePath` still provides the authoritative check.

**Verdict:** Fixed.

---

### IDE-RED-5: `readFileAsBase64`/`readFileAsText` not scoped to IDE root -- FIXED

**Previous severity:** Low
**Status:** Fixed
**File:** `src/main/fs.ts:143-178, 208-214`

Both `readFileAsBase64` and `readFileAsText` now accept an optional `ideRoot` parameter. When provided, they call `validateIdePathForAttachment()` (lines 181-188) which validates the path is within the IDE root. The IPC handlers (lines 208-214) dynamically import `getIdeRootPath()` from `ide-fs-handlers.ts` and pass it when an IDE root is set.

When no IDE root is set, the original `validateSafePath()` (home + tmpdir scope) is used as fallback.

**Note:** `validateIdePathForAttachment()` does NOT use `realpathSync()` for symlink resolution (line 184 uses textual `startsWith` only). This is a weaker check than `validateIdePath` in `ide-fs-handlers.ts`. However, since these are read-only operations and the scope is already narrowed to IDE root when available, this is acceptable.

**Verdict:** Fixed.

---

### IDE-RED-6: Predictable temp file path in atomic write -- FIXED

**Previous severity:** Low
**Status:** Fixed
**File:** `src/main/handlers/ide-fs-handlers.ts:176-177`

The temp file name now includes a random component: `Math.random().toString(36).substring(2, 8)` appended after `Date.now()`. This makes the path unpredictable enough to prevent the symlink pre-creation attack.

While `crypto.randomUUID()` would be cryptographically stronger, `Math.random()` provides sufficient entropy for this single-user desktop app context. The temp file also has proper cleanup on failure (try/catch around `rm` at lines 183-186).

**Verdict:** Fixed.

---

### IDE-RED-7: No symlink integration test for SEC-2 fix -- PARTIALLY FIXED

**Previous severity:** Low
**Status:** Partially Fixed
**File:** `src/main/__tests__/integration/ide-path-traversal.test.ts:80-103`

A test case `rejects symlink escape attempts` has been added (lines 80-103). However, it does NOT actually create a symlink. The test body simply calls `validateIdePath('/etc/passwd', WATCHED_ROOT)` -- which is the same as the existing "rejects absolute paths outside watched root" test (line 39). The test contains a lengthy comment explaining why creating a real symlink is difficult, but this is not accurate -- creating `ln -s /etc/passwd ${WATCHED_ROOT}/evil-link` in a temp directory requires no elevated privileges.

**What should be tested:**
```typescript
import { symlinkSync } from 'fs'

it('rejects symlink escape attempts', () => {
  symlinkSync('/etc/passwd', join(WATCHED_ROOT, 'evil-link'))
  expect(() => validateIdePath(join(WATCHED_ROOT, 'evil-link'), WATCHED_ROOT))
    .toThrow('Path traversal blocked')
})
```

**Verdict:** Partially Fixed. The test exists but is a duplicate of the absolute-path test. No actual symlink is created or resolved.

---

### IDE-RED-8: Terminal has full shell access -- N/A (Accepted Risk)

**Previous severity:** Informational
**Status:** Accepted risk -- no change expected.

---

## New Findings

### IDE-RED-9: `validateIdeRoot` does not resolve symlinks -- home directory bypass via symlink

**Severity:** Low
**File:** `src/main/handlers/ide-fs-handlers.ts:21-45`

The new `validateIdeRoot()` function validates that the resolved path starts with `homedir()`, but it does not call `realpathSync()` on the input before checking. If a symlink exists within the home directory that points to a location outside it (e.g., `~/link-to-root -> /`), and a user (or compromised renderer) passes `~/link-to-root` to `fs:watchDir`, the textual check passes because the path starts with `$HOME/`. The `stat()` call succeeds because the target exists and is a directory. The IDE root is then set to `~/link-to-root`, and since `validateIdePath` resolves symlinks via `realpathSync`, subsequent file operations will correctly resolve paths through the symlink -- but they validate against `rootReal` which would be `/`, effectively allowing access to the entire filesystem.

**Exploit chain:**
1. Attacker (or user) creates `~/link-to-root -> /`
2. Compromised renderer calls `window.api.watchDir('/Users/user/link-to-root')`
3. `validateIdeRoot` passes (path starts with homedir, stat succeeds, is directory)
4. `ideRootPath` = `/Users/user/link-to-root`
5. `validateIdePath('/Users/user/link-to-root/etc/passwd', '/Users/user/link-to-root')`:
   - `rootReal` = `realpathSync('/Users/user/link-to-root')` = `/`
   - `real` = `realpathSync('/Users/user/link-to-root/etc/passwd')` = `/etc/passwd`
   - Check: `/etc/passwd`.startsWith(`/` + `/`) = `/etc/passwd`.startsWith(`//`) = **false**
   - Actually: `rootReal + '/'` = `//`, so the check is `real !== rootReal` which is true, and `!real.startsWith('//')` which is true -- so it **throws**.

Wait -- re-examining: if `rootReal` = `/`, then `rootReal + '/'` = `//`. The check `!real.startsWith('//')` would be true for `/etc/passwd`, AND `real !== rootReal` (`/etc/passwd` !== `/`) is true, so validation **would throw**. The edge case at line 90 actually protects against this because the `/` + `/` concatenation creates `//` which no real path starts with.

However, if the symlink points to a non-root directory like `/var`, then `rootReal` = `/var`, and `rootReal + '/'` = `/var/`, so `real.startsWith('/var/')` would correctly scope. This means the bypass only applies when the symlink target contains the file being accessed.

**Revised assessment:** The `/` edge case is accidentally safe due to the `+ '/'` concatenation. Symlinks to other directories would correctly scope. The risk is lower than initially assessed.

**Fix:** Add `realpathSync()` call in `validateIdeRoot` to resolve the input path before the home directory check.

---

### IDE-RED-10: `validateIdePathForAttachment` in `fs.ts` does not resolve symlinks

**Severity:** Low
**File:** `src/main/fs.ts:181-188`

The `validateIdePathForAttachment()` function uses textual `startsWith` without calling `realpathSync()`. Unlike `validateIdePath` in `ide-fs-handlers.ts`, there is no symlink resolution. A symlink inside the IDE root pointing outside it would bypass this check for `readFileAsBase64` and `readFileAsText`.

This is read-only (no write/delete), so the impact is limited to information disclosure.

**Fix:** Use `realpathSync()` for both `resolvedRoot` and `resolvedPath` before the `startsWith` comparison, consistent with `validateIdePath`.

---

## Previously Fixed Issues (Cross-Reference)

| Synthesis ID | Issue | Status |
|---|---|---|
| SEC-2 | Symlink path traversal in `validateIdePath` | Fixed in v1 audit -- `realpathSync` added |
| IDE-5 | File contents in component state | Fixed -- moved to Zustand store |
| IDE-6 | File watcher has no error handler | Fixed -- error handler added at line 226 |
| IDE-7 | Save/read race condition | Fixed -- async save with proper loading states |
| IDE-8 | File read error silently shows empty content | Fixed -- toast error shown |
| IDE-9 | No loading indicator during file fetch | Fixed -- loading state in store |
| IDE-10 | No `beforeunload` guard for unsaved changes | Fixed -- guard added |
| IDE-16 | Predictable temp file path | Fixed -- random component added |

---

## Summary Table

| ID | Severity | Title | Status | Notes |
|---|---|---|---|---|
| IDE-RED-1 | High | `fs:watchDir` accepts any path as IDE root | **Fixed** | `validateIdeRoot()` enforces home dir + exists + is directory |
| IDE-RED-2 | Medium | `validateIdePath` returns pre-symlink path (TOCTOU) | **Fixed** | Now returns `real` (canonical path) |
| IDE-RED-3 | Medium | Fallback path for non-existent files skips symlink resolution | **Fixed** | Parent directory resolved via `realpathSync` |
| IDE-RED-4 | Medium | No filename sanitization in create/rename | **Fixed** | `sanitizeFilename()` added in FileSidebar |
| IDE-RED-5 | Low | `readFileAsBase64`/`readFileAsText` not scoped to IDE root | **Fixed** | IDE root passed when available |
| IDE-RED-6 | Low | Predictable temp file path | **Fixed** | Random suffix added |
| IDE-RED-7 | Low | No symlink integration test | **Partially Fixed** | Test exists but does not create actual symlink |
| IDE-RED-8 | Info | Terminal has full shell access | **N/A** | Accepted risk |
| IDE-RED-9 | Low | `validateIdeRoot` does not resolve symlinks | **New** | Symlink in $HOME could set root outside home |
| IDE-RED-10 | Low | `validateIdePathForAttachment` lacks symlink resolution | **New** | Read-only information disclosure via symlink |

---

## Overall Assessment

**Significant improvement.** The previous audit identified 1 high, 3 medium, and 3 low severity issues. All high and medium severity findings have been remediated:

- **IDE-RED-1 (High):** The unrestricted `fs:watchDir` path issue -- the most critical finding -- is fixed with proper validation.
- **IDE-RED-2 (Medium):** The TOCTOU race condition is eliminated by returning canonical paths.
- **IDE-RED-3 (Medium):** The non-existent path fallback now resolves parent symlinks.
- **IDE-RED-4 (Medium):** Filename sanitization is in place as defense-in-depth.

The two remaining issues (IDE-RED-9, IDE-RED-10) are both low severity and require an attacker to have write access to the user's home directory to create a malicious symlink. The one partial fix (IDE-RED-7) is a test quality issue, not a runtime vulnerability.

**Recommended next steps:**
1. Add `realpathSync()` to `validateIdeRoot()` -- 3-line change, closes IDE-RED-9
2. Add `realpathSync()` to `validateIdePathForAttachment()` -- 4-line change, closes IDE-RED-10
3. Create a real symlink in the integration test -- 2-line change, closes IDE-RED-7

**Security posture: Good.** The IDE filesystem handlers now implement multi-layer path validation (home directory scope, symlink resolution via `realpathSync`, renderer-side filename sanitization, binary detection). The attack surface has been substantially reduced from the v1 audit.
