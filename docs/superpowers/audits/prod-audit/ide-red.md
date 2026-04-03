# IDE -- Red Team Audit

**Date:** 2026-03-29
**Scope:** 22 files (11 source, 2 constants/types, 9 test files)
**Persona:** Red Team (Security)

---

## Cross-Reference with Synthesis Final Report (2026-03-28)

### Previously Reported -- Now Fixed

| Synthesis ID | Issue                                                                                                    | Status                                                                                                                                                                                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-2        | Symlink-based path traversal bypass in `ide-fs-handlers.ts` -- `path.resolve()` does not follow symlinks | **Fixed.** `validateIdePath()` now calls `fs.realpathSync()` on both the root and the target path (lines 19-42). Integration test at `src/main/__tests__/integration/ide-path-traversal.test.ts` covers `..` traversal, absolute paths outside root, prefix siblings, and null bytes. |

### Previously Reported -- Still Open

| Synthesis ID | Issue                     | Status                                                                                                                                                                         |
| ------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SEC-1        | Renderer sandbox disabled | **Still open.** With sandbox disabled, any renderer-side vulnerability (XSS in Monaco, malicious file content) grants full Node.js access. This amplifies every finding below. |

---

## New Findings

### IDE-RED-1: `fs:watchDir` accepts any path without validation -- IDE root can be set to `/`

**Severity:** High
**File:** `src/main/handlers/ide-fs-handlers.ts:140-151`
**Code:**

```typescript
safeHandle('fs:watchDir', (_e, dirPath: string) => {
    stopWatcher()
    ideRootPath = dirPath   // <-- No validation at all
    watcher = fs.watch(dirPath, { recursive: true }, () => { ... })
})
```

**Impact:** The `fs:watchDir` IPC handler sets `ideRootPath` to any renderer-supplied string without validation. All subsequent `fs:readDir`, `fs:readFile`, `fs:writeFile`, `fs:createFile`, `fs:createDir`, `fs:rename`, `fs:delete`, and `fs:stat` calls validate against this root. If the renderer calls `window.api.watchDir('/')`, every file on the system becomes readable, writable, and deletable through the IDE handlers. While the normal UI flow uses `openDirectoryDialog()` (which returns a user-chosen path), any compromised renderer code or XSS can call `window.api.watchDir()` directly with an arbitrary path.

**Combined with SEC-1 (sandbox disabled):** A compromised renderer already has full Node.js access, so this is redundant in the worst case. However, if the sandbox is re-enabled (SEC-1 fix), this becomes the primary escalation path.

**Fix:**

1. Validate that `dirPath` exists, is a directory, and is within the user's home directory (or other allowlist).
2. Alternatively, require that `dirPath` originates from `dialog.showOpenDialog()` by generating a nonce on the main process side that must be passed back.

---

### IDE-RED-2: `validateIdePath` returns the pre-symlink `resolved` path, not the `real` path

**Severity:** Medium
**File:** `src/main/handlers/ide-fs-handlers.ts:14-48`
**Code:**

```typescript
export function validateIdePath(targetPath: string, allowedRoot: string): string {
  // ... resolves symlinks for validation ...
  if (!real.startsWith(rootReal + '/') && real !== rootReal) {
    throw new Error(`Path traversal blocked: ...`)
  }
  return resolved // <-- Returns the UN-resolved symlink path
}
```

**Impact:** The function correctly validates by resolving symlinks via `realpathSync()`, but then returns the original `resolved` path (line 47) rather than the `real` (symlink-resolved) path. All callers (`readDir`, `readFileContent`, `writeFileContent`, `fs:createFile`, `fs:createDir`, `fs:rename`, `fs:delete`, `fs:stat`) then operate on the symlink path. This creates a TOCTOU (time-of-check/time-of-use) race condition:

1. Attacker creates symlink `$ROOT/link -> $ROOT/safe` (passes validation)
2. Between `validateIdePath()` returning and the actual `fs` operation, attacker atomically replaces the symlink: `$ROOT/link -> /etc/shadow`
3. The `fs` operation follows the new symlink target

This is a narrow race window but is exploitable in theory, especially for write operations where the attacker controls timing.

**Fix:** Return `real` instead of `resolved` from `validateIdePath()`, and use the returned path for all subsequent file operations. This eliminates the TOCTOU window. Update the unit tests accordingly (they currently assert that the original `resolved` path is returned).

---

### IDE-RED-3: `validateIdePath` fallback path for non-existent files can be bypassed via dangling symlink to non-existent intermediate

**Severity:** Medium
**File:** `src/main/handlers/ide-fs-handlers.ts:32-42`
**Code:**

```typescript
try {
  real = fs.realpathSync(resolved)
} catch {
  // If realpath fails (e.g., path doesn't exist yet), we need to normalize
  if (resolved.startsWith(root + '/')) {
    real = resolved.replace(root, rootReal)
  } else if (resolved === root) {
    real = rootReal
  } else {
    real = resolved
  }
}
```

**Impact:** When `realpathSync` fails (path does not exist), the fallback uses `resolved.replace(root, rootReal)` which uses `String.replace()` -- this only replaces the **first** occurrence. If `root` appears as a substring within the path (e.g., root is `/home/user` and path is `/home/user/home/user/../../../etc/passwd`), the replacement is applied incorrectly, though `path.resolve()` would have already collapsed the `..` segments making this harder to exploit in practice.

More critically: for the `fs:createFile` and `fs:createDir` handlers, the target path legitimately does not exist yet. The fallback assumes the non-existent path is safe if it textually starts with `root + '/'`. But consider a path like `$ROOT/symlink-to-outside/newfile.txt` where the symlink target directory does not exist -- `realpathSync` fails because the full path does not exist, the textual check passes because it starts with `root + '/'`, and the actual filesystem operation follows the symlink to create a file outside the root.

**Fix:** For non-existent paths, resolve the **parent** directory (which must exist for a create to succeed) via `realpathSync`, then append the filename. This ensures intermediate symlinks are followed during validation.

---

### IDE-RED-4: No filename sanitization in `handleNewFile` / `handleNewFolder` / `handleRename`

**Severity:** Medium
**File:** `src/renderer/src/components/ide/FileSidebar.tsx:30-63`
**Code:**

```typescript
async function handleNewFile(parentPath: string): Promise<void> {
  const name = await prompt({ message: 'New file name:', placeholder: 'filename.txt' })
  if (!name) return
  await window.api.createFile(`${parentPath}/${name}`) // name is user-supplied, unsanitized
}
```

**Impact:** User-supplied filenames from the prompt dialog are concatenated directly into paths. A user (or compromised renderer) could enter `../../../etc/cron.d/evil` as a filename. The `validateIdePath` call in the main process handler would catch `..` traversal, but other dangerous inputs pass through:

- Names containing `/` create nested directories: entering `a/b/c.txt` creates intermediate dirs via `mkdir(dirname(safe), { recursive: true })` in `writeFileContent`.
- Names with special characters (null bytes, unicode control chars) could cause unexpected behavior.
- Names like `.` or `..` (just the dots) would resolve to the parent directory.

The main-process `validateIdePath` mitigates the worst cases, but the renderer should also sanitize filenames as a defense-in-depth measure.

**Fix:** Add filename validation in `FileSidebar.tsx` before calling IPC: reject names containing `/`, `\`, `\0`, or consisting only of `.`/`..`. Also add validation in the main-process handlers for `fs:createFile`, `fs:createDir`, and `fs:rename` to reject path components with these characters.

---

### IDE-RED-5: `fs:readFileAsBase64` and `fs:readFileAsText` have no IDE root scoping

**Severity:** Low (design concern)
**File:** `src/main/fs.ts:116-124, 143-171`
**Code:**

```typescript
export function validateSafePath(filePath: string): string {
  const resolved = resolve(filePath)
  const inHome = resolved.startsWith(HOME_ROOT + '/') || resolved === HOME_ROOT
  const inTmp = resolved.startsWith(TMP_ROOT + '/') || resolved === TMP_ROOT
  if (!inHome && !inTmp) {
    throw new Error(`Path blocked: "${filePath}" is outside allowed directories`)
  }
  return resolved
}
```

**Impact:** The `fs:readFileAsBase64` and `fs:readFileAsText` handlers (registered in `fs.ts`) are exposed on the same `window.api` object and use `validateSafePath` which allows reading ANY file under `$HOME` or `$TMPDIR`. These are not scoped to the IDE root. A compromised renderer could read `~/.ssh/id_rsa`, `~/.aws/credentials`, `~/.bde/bde.db`, or any other sensitive file under the home directory without restriction. These handlers also do not use `realpathSync` to resolve symlinks.

**Fix:** Either (a) scope these handlers to the IDE root when in IDE context, or (b) add an allowlist of permitted file extensions/directories, or (c) document this as accepted risk since they predate the IDE and serve the attachment workflow.

---

### IDE-RED-6: `writeFileContent` atomic write creates predictable temp file path

**Severity:** Low
**File:** `src/main/handlers/ide-fs-handlers.ts:104-119`
**Code:**

```typescript
const tmpPath = `${filePath}.bde-tmp-${Date.now()}`
```

**Impact:** The temp file path uses `Date.now()` which is predictable (millisecond-precision timestamp). On a multi-user system, an attacker who can predict the timestamp could pre-create a symlink at the expected temp path, causing the write to go to an attacker-controlled location. The subsequent `rename()` would then move the symlink (not the content) into place, or the content would be written through the symlink.

In practice, BDE is a single-user desktop app, so this is low risk. However, it deviates from secure temp file best practices.

**Fix:** Use `crypto.randomUUID()` or `crypto.randomBytes(16).toString('hex')` instead of `Date.now()` for the temp file suffix. Alternatively, use `os.tmpdir()` with `mkdtemp` for truly unique temp paths.

---

### IDE-RED-7: No integration test for symlink-based traversal

**Severity:** Low (test gap)
**File:** `src/main/__tests__/integration/ide-path-traversal.test.ts`

**Impact:** The integration test covers `..` traversal, absolute paths, prefix siblings, and null bytes, but does NOT test the actual symlink scenario that SEC-2 was about. There is no test that creates a symlink inside the IDE root pointing outside, then verifies that `validateIdePath` blocks it. The fix (adding `realpathSync`) is present in the code, but its effectiveness against actual symlinks is untested.

**Fix:** Add a test case that:

1. Creates a temp directory as IDE root
2. Creates a symlink inside it: `$ROOT/escape -> /tmp` (or `-> /etc`)
3. Calls `validateIdePath('$ROOT/escape/passwd', ROOT)` and asserts it throws
4. Also tests the TOCTOU scenario from IDE-RED-2 if possible

---

### IDE-RED-8: Integrated terminal runs with full shell access, no sandboxing

**Severity:** Informational (accepted risk)
**File:** `src/renderer/src/components/ide/TerminalPanel.tsx`

**Impact:** The integrated terminal (via `TerminalPanel` -> `TerminalContent` -> xterm.js + node-pty) provides unrestricted shell access. This is by design for a development IDE, but worth noting that:

- Any command injection that reaches the terminal has full system access
- The terminal inherits the Electron process's environment, which includes `PATH` augmentation from `buildAgentEnv()`
- There is no command logging or audit trail for terminal sessions

**Fix:** None required -- this is expected IDE functionality. Document as accepted risk.

---

## Findings Not Present (Explicitly Checked)

- **URL encoding bypass**: `path.resolve()` does not decode URL-encoded sequences (`%2e%2e`), so `%2e%2e/%2e%2e/etc/passwd` resolves to a literal path containing `%2e%2e`, not `../..`. Not exploitable.
- **Unicode normalization attacks**: Node.js `path.resolve()` does not perform Unicode normalization, so homoglyph attacks on `..` are not effective. Not exploitable.
- **Binary file rendering XSS**: Binary files are detected and rejected at the main process level (null byte check in first 8KB). Even if a file passed, Monaco renders it as syntax-highlighted code text, not HTML. Not exploitable.
- **Monaco editor XSS**: Monaco renders file content as syntax-highlighted code, not as raw HTML. There is no unsafe HTML injection in the editor rendering path. Not exploitable via file content.
- **IPC argument type confusion**: All IPC handlers use typed arguments via `safeHandle` wrapper. The TypeScript types in `ipc-channels.ts` enforce string arguments. Not exploitable.

---

## Summary Table

| ID                | Severity      | Title                                                         | File                         | Fixed?                      |
| ----------------- | ------------- | ------------------------------------------------------------- | ---------------------------- | --------------------------- |
| SEC-2 (cross-ref) | Critical      | Symlink path traversal bypass                                 | `ide-fs-handlers.ts:15-21`   | Yes -- `realpathSync` added |
| IDE-RED-1         | High          | `fs:watchDir` accepts any path as IDE root                    | `ide-fs-handlers.ts:140-151` | No                          |
| IDE-RED-2         | Medium        | `validateIdePath` returns pre-symlink path (TOCTOU)           | `ide-fs-handlers.ts:47`      | No                          |
| IDE-RED-3         | Medium        | Fallback path for non-existent files skips symlink resolution | `ide-fs-handlers.ts:32-42`   | No                          |
| IDE-RED-4         | Medium        | No filename sanitization in create/rename operations          | `FileSidebar.tsx:30-63`      | No                          |
| IDE-RED-5         | Low           | `readFileAsBase64`/`readFileAsText` not scoped to IDE root    | `fs.ts:116-124`              | No                          |
| IDE-RED-6         | Low           | Predictable temp file path in atomic write                    | `ide-fs-handlers.ts:106`     | No                          |
| IDE-RED-7         | Low           | No symlink integration test for SEC-2 fix                     | `ide-path-traversal.test.ts` | No                          |
| IDE-RED-8         | Informational | Terminal has full shell access (accepted risk)                | `TerminalPanel.tsx`          | N/A                         |

---

## Recommended Fix Priority

1. **IDE-RED-1** (High) -- Validate `fs:watchDir` input. This is the single highest-impact fix: ~5 lines of validation code that prevents the IDE root from being set to a sensitive directory.
2. **IDE-RED-2** (Medium) -- Return `real` path from `validateIdePath`. One-line change from `return resolved` to `return real` that closes the TOCTOU window.
3. **IDE-RED-3** (Medium) -- Resolve parent directory for non-existent path fallback. Small change to the catch branch.
4. **IDE-RED-4** (Medium) -- Add filename sanitization. Defense-in-depth for the renderer side.
5. **IDE-RED-7** (Low) -- Add symlink test case. Validates the SEC-2 fix actually works.
6. **IDE-RED-5, IDE-RED-6** (Low) -- Lower priority, address when convenient.
