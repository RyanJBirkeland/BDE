# FC-S5: MemoryView new file creation fails for subdirectories

## Problem Statement

When a user creates a new memory file with a path that includes a subdirectory (e.g., `projects/myfile.md`), the operation fails silently. `writeMemoryFile()` in `src/main/fs.ts:55-58` calls `writeFile()` directly without ensuring the parent directory exists. If the subdirectory hasn't been created yet, `writeFile` throws `ENOENT`. The `createFile()` function in `MemoryView.tsx:119-128` has no `try/catch`, so the error becomes an unhandled promise rejection with no user feedback — the UI simply does nothing.

## Root Cause

Two issues:

1. **Backend:** `writeMemoryFile()` does not call `mkdir({ recursive: true })` on the parent directory before `writeFile()`.
2. **Frontend:** `createFile()` has no error handling — no `try/catch`, no toast on failure.

## Files to Change

| File                                    | Change                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/main/fs.ts`                        | In `writeMemoryFile()`: add `await mkdir(dirname(fullPath), { recursive: true })` before `writeFile()` |
| `src/renderer/src/views/MemoryView.tsx` | Wrap `createFile()` body in `try/catch` with a `toast.error()` on failure                              |

## Implementation Notes

### fs.ts (lines 55-58)

```typescript
async function writeMemoryFile(filePath: string, content: string): Promise<void> {
  const fullPath = join(MEMORY_ROOT, filePath)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, content, 'utf-8')
}
```

Import `mkdir` from `fs/promises` and `dirname` from `path` (likely already imported).

### MemoryView.tsx (lines 119-128)

```typescript
const createFile = async (name: string): Promise<void> => {
  const path = name.endsWith('.md') ? name : `${name}.md`
  try {
    await memoryService.writeFile(path, '')
    await loadFiles()
    openFile(path)
  } catch (err) {
    toast.error(`Failed to create file: ${err instanceof Error ? err.message : 'Unknown error'}`)
  }
}
```

### Security note

The `writeMemoryFile` handler should also validate that the resolved `fullPath` is still within `MEMORY_ROOT` (no `..` traversal). This is flagged in the engineering audit (issue #2) as a separate concern, but if touching this function anyway, adding a `realpath` check or a `startsWith` guard is prudent.

## Success Criteria

1. Create a file with path `subfolder/notes.md` → file is created, subfolder appears in the file browser
2. Create a file with path `deeply/nested/file.md` → all intermediate directories are created
3. Create a file with path `existing-file.md` in the root → works as before (no regression)
4. If `writeFile` fails for any other reason (permissions, disk full), a toast error is shown
