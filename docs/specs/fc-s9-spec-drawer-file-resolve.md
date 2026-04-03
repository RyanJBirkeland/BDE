# FC-S9: SpecDrawer — resolve spec file from disk when spec column is null

## Problem

Every Ticket Tear task has `spec = NULL` in SQLite. The `prompt` field starts with a line like:

```
Read docs/specs/ax-s3-ipc-boundary-validation.md in full before writing code.
```

`SpecDrawer.tsx` falls back to rendering `task.prompt` when `task.spec` is null — so users see the raw prompt text instead of the actual spec content. The spec markdown is sitting on disk at `~/Documents/Repositories/BDE/docs/specs/<file>.md` but nothing reads it.

## Solution

Two-part fix:

### 1. IPC handler: `sprint:read-spec-file`

Add a new IPC handler in `src/main/handlers/sprint-handlers.ts` (or wherever sprint IPC lives):

```ts
safeHandle('sprint:read-spec-file', (_e, filePath: string) => {
  // filePath is relative to BDE repo root, e.g. "docs/specs/ax-s3-ipc-boundary-validation.md"
  // Resolve against the BDE repo root (use app.getAppPath() or __dirname traversal)
  const repoRoot = join(__dirname, '../../..') // adjust depth as needed
  const abs = validatePath(repoRoot, filePath) // use existing validateMemoryPath pattern
  return readFileSync(abs, 'utf-8')
})
```

Expose in preload:

```ts
readSpecFile: (filePath: string) => ipcRenderer.invoke('sprint:read-spec-file', filePath)
```

### 2. SpecDrawer: auto-load spec from file

In `SpecDrawer.tsx`, extract the spec file path from `task.prompt` if `task.spec` is null:

```ts
function extractSpecPath(prompt: string): string | null {
  const match = prompt.match(/docs\/specs\/[\w\-]+\.md/)
  return match ? match[0] : null
}
```

In the `useEffect` that initialises `draft`:

```ts
useEffect(() => {
  if (!task) return
  if (task.spec) {
    setDraft(task.spec)
    return
  }
  const specPath = extractSpecPath(task.prompt ?? '')
  if (specPath) {
    window.api
      .readSpecFile(specPath)
      .then((content) => setDraft(content))
      .catch(() => setDraft(task.prompt ?? ''))
  } else {
    setDraft(task.prompt ?? '')
  }
}, [task?.id])
```

Do the same for the read-only rendered view (replace the inline `task.spec ?? task.prompt` fallback with resolved state).

### 3. Persist on save (optional but recommended)

When the user saves a spec, the `onSave` callback already calls `sprint:update`. No change needed — the content will be stored in `task.spec` going forward. Once saved, the file-read path is bypassed.

## Files to Change

| File                                                | Change                                    |
| --------------------------------------------------- | ----------------------------------------- |
| `src/main/handlers/sprint-handlers.ts`              | Add `sprint:read-spec-file` handler       |
| `src/preload/index.ts`                              | Expose `readSpecFile` in `window.api`     |
| `src/preload/index.d.ts`                            | Add type for `readSpecFile`               |
| `src/renderer/src/components/sprint/SpecDrawer.tsx` | `extractSpecPath()` + useEffect auto-load |

## Acceptance Criteria

- Clicking "Spec" on any Ticket Tear task shows the markdown content from `docs/specs/*.md`, not the raw prompt
- If no spec file is referenced and `task.spec` is null, falls back to `task.prompt` (existing behaviour)
- Once a user edits + saves a spec, the saved content is used (no more file read)
- Path traversal: only files under `docs/specs/` are readable via this handler

## Out of Scope

- Bulk-loading all spec files into the `spec` column on startup
- Editing the spec files on disk (edits go to SQLite only)
- Any other IPC handlers

## Size: S — ~60 lines changed across 4 files
