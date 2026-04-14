# MemorySection.tsx Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose MemorySection.tsx (592L) into MemoryFileList, MemoryFileEditor, MemorySearch, useMemoryFiles hook, and thin MemorySection facade.

**Architecture:** MemorySection currently owns file listing (with grouping and keyboard nav), file editor (textarea and save/discard), search (input and results), file operations (create, load, save), and coordination between components. The refactor extracts file loading into a custom hook; file listing into MemoryFileList; editor into MemoryFileEditor; search into MemorySearch; MemorySection becomes a thin coordinator that manages dirty-state checking before switching files and file creation flow.

**Tech Stack:** TypeScript, React, Electron (renderer process), Vitest

---

## Task 1: Create useMemoryFiles Hook

**Files:**
- Create: `src/renderer/src/components/settings/useMemoryFiles.ts`
- Modify: `src/renderer/src/components/settings/MemorySection.tsx`

- [ ] Read `src/renderer/src/components/settings/MemorySection.tsx` and identify file I/O logic: lines 76–92 (state: `files`, `loadingFiles`, `loadingContent`, `selectedPath`, `content`, `savedContent`, `activeFiles`), lines 95–118 (`loadFiles`, `loadActiveFiles` callbacks), lines 153–162 (`saveFile`), lines 168–184 (`createFile`)
- [ ] Create `src/renderer/src/components/settings/useMemoryFiles.ts` with:
  - Return type: `{ files: MemoryFile[]; loadingFiles: boolean; activeFiles: Record<string, boolean>; loadFiles: () => Promise<void>; loadActiveFiles: () => Promise<void>; saveFile: (path: string, content: string) => Promise<void>; createFile: (name: string) => Promise<void> }`
  - Internal state: `files`, `loadingFiles`, `activeFiles`
  - Callbacks: `loadFiles`, `loadActiveFiles`, `saveFile` (takes path+content args), `createFile` (takes name arg)
  - `useEffect` for initialization (call `loadFiles` + `loadActiveFiles` on mount)
  - Imports: `memoryService`, `toast`
- [ ] In MemorySection.tsx, replace the file I/O state and callbacks with: `const { files, loadingFiles, activeFiles, loadFiles, loadActiveFiles, saveFile: saveFileToService, createFile: createFileWithService } = useMemoryFiles()`
- [ ] Update handlers that call the hook functions to use the new signatures
- [ ] Run `npm run typecheck` — fix any errors
- [ ] Run `npm test` — all tests must pass
- [ ] Commit: `git add -A && git commit -m "refactor: extract useMemoryFiles hook from MemorySection"`

---

## Task 2: Create MemoryFileList

**Files:**
- Create: `src/renderer/src/components/settings/MemoryFileList.tsx`
- Modify: `src/renderer/src/components/settings/MemorySection.tsx`

- [ ] Read MemorySection.tsx and identify file list rendering: lines 249–255 (`groupFiles`, `flatFiles` memo), lines 257–294 (keyboard nav: `focusIndex`, `useEffect` handlers, scroll-into-view), lines 305–527 (sidebar DOM: header, file list groups, loading/empty states)
- [ ] Create `src/renderer/src/components/settings/MemoryFileList.tsx` with:
  - Props: `{ files: MemoryFile[]; loadingFiles: boolean; selectedPath: string | null; activeFiles: Record<string, boolean>; onSelectFile: (path: string) => void; onLoadFiles: () => void; onToggleActive: (path: string) => void; onNewFileClick: () => void }`
  - Internal: `focusIndex` state, `sidebarRef`, keyboard nav `useEffect`, scroll `useEffect`
  - Derived: `groupFiles`, `flatFiles` (move `groupFiles` helper function here or to a shared utils file)
  - Move helper functions `formatRelativeTime` and `formatSize` here if they're only used in the file list
  - Render: lines 305–527 (entire sidebar section)
- [ ] In MemorySection.tsx, delete lines 249–294 (groupFiles memo and keyboard nav)
- [ ] Replace lines 305–527 with `<MemoryFileList files={files} loadingFiles={loadingFiles} selectedPath={selectedPath} activeFiles={activeFiles} onSelectFile={handleSelectFile} onLoadFiles={loadFiles} onToggleActive={toggleActive} onNewFileClick={() => setNewFilePrompt(true)} />`
- [ ] Run `npm run typecheck` — fix any errors
- [ ] Run `npm test` — all tests must pass
- [ ] Commit: `git add -A && git commit -m "refactor: extract MemoryFileList from MemorySection"`

---

## Task 3: Create MemoryFileEditor

**Files:**
- Create: `src/renderer/src/components/settings/MemoryFileEditor.tsx`
- Modify: `src/renderer/src/components/settings/MemorySection.tsx`

- [ ] Read MemorySection.tsx and identify editor state/logic: `content`, `savedContent` state; `editorRef`; `saveFile` callback; discard callback; `useEffect` for Cmd+S (lines 224–236); `activeCount`, `activeTotalBytes` memos (lines 296–300); editor DOM (lines 531–587)
- [ ] Create `src/renderer/src/components/settings/MemoryFileEditor.tsx` with:
  - Props: `{ selectedPath: string | null; content: string; savedContent: string; loadingContent: boolean; activeFiles: Record<string, boolean>; files: MemoryFile[]; onContentChange: (content: string) => void; onSaveFile: () => void; onDiscardChanges: () => void; onToggleActive: (path: string) => void }`
  - Internal: `editorRef`, `isDirty` (derived from content !== savedContent), `activeCount`, `activeTotalBytes` memos
  - `useEffect` for Cmd+S keyboard shortcut
  - Render: lines 531–587 (loading state, toolbar, size banner, textarea, empty state)
- [ ] In MemorySection.tsx, delete the editor state, editorRef, saveFile, discard, Cmd+S useEffect, and activeCount/activeTotalBytes memos
- [ ] Replace lines 531–587 with `<MemoryFileEditor selectedPath={selectedPath} content={content} savedContent={savedContent} loadingContent={loadingContent} activeFiles={activeFiles} files={files} onContentChange={setContent} onSaveFile={saveFile} onDiscardChanges={discard} onToggleActive={toggleActive} />`
- [ ] Keep `saveFile` and `discard` as thin wrapper callbacks in MemorySection that call service functions
- [ ] Run `npm run typecheck` — fix any errors
- [ ] Run `npm test` — all tests must pass
- [ ] Commit: `git add -A && git commit -m "refactor: extract MemoryFileEditor from MemorySection"`

---

## Task 4: Create MemorySearch

**Files:**
- Create: `src/renderer/src/components/settings/MemorySearch.tsx`
- Modify: `src/renderer/src/components/settings/MemorySection.tsx`

- [ ] Read MemorySection.tsx and identify search logic: `searchQuery`, `searchResults`, `isSearching` state (lines 85–87); `handleSearch` callback (lines 186–204); `clearSearch` callback (lines 206–209); search input markup (lines 357–377)
- [ ] Create `src/renderer/src/components/settings/MemorySearch.tsx` with:
  - Props: `{ searchQuery: string; searchResults: MemorySearchResult[]; isSearching: boolean; selectedPath: string | null; onSearch: (query: string) => void; onClearSearch: () => void; onSelectResult: (path: string) => void }`
  - No internal state — all state passed via props
  - Render: search input wrapper and clear button (lines 357–377)
- [ ] In MemorySection.tsx, keep `searchQuery`, `searchResults`, `isSearching` state and `handleSearch`/`clearSearch` callbacks (coordination state stays in facade)
- [ ] Replace the search input markup with `<MemorySearch searchQuery={searchQuery} searchResults={searchResults} isSearching={isSearching} selectedPath={selectedPath} onSearch={handleSearch} onClearSearch={clearSearch} onSelectResult={handleSelectFile} />`
- [ ] Run `npm run typecheck` — fix any errors
- [ ] Run `npm test` — all tests must pass
- [ ] Commit: `git add -A && git commit -m "refactor: extract MemorySearch from MemorySection"`

---

## Task 5: Finalize MemorySection Facade

**Files:**
- Modify: `src/renderer/src/components/settings/MemorySection.tsx`

- [ ] Review MemorySection.tsx — it should now contain only:
  - `useMemoryFiles()` hook call
  - Coordination state: `selectedPath`, `content`, `savedContent`, `loadingContent`, `newFilePrompt`, `newFileName`, `creating`, `searchQuery`, `searchResults`, `isSearching`
  - Coordination callbacks: `openFile`, `handleSelectFile` (with dirty-state check), `saveFile` wrapper, `discard` wrapper, `handleSearch`, `clearSearch`, `toggleActive`, `createFile` wrapper
  - `isDirty` computed (content !== savedContent) — used for dirty-state gate before switching files
  - File creation flow (lines 337–355): `newFilePrompt` state + new file input form
  - Before-unload warning hook
  - Composition of `<MemoryFileList>`, `<MemoryFileEditor>`, `<MemorySearch>`
- [ ] Expected size: ≤150 lines (coordination complexity warrants this)
- [ ] Verify dirty-state check before switching files is still present: `if (isDirty && !confirm(...)) return`
- [ ] Run `npm run typecheck` — fix any errors
- [ ] Run `npm test` — all tests must pass
- [ ] Run `npm run lint` — zero errors
- [ ] Commit: `git add -A && git commit -m "refactor: memory-section decomposition complete"`

---

## Verification

- `npm run typecheck` — zero errors
- `npm test` — zero regressions
- `MemorySection.tsx` ≤150 lines; each extracted file ≤200 lines; `useMemoryFiles.ts` ≤100 lines
