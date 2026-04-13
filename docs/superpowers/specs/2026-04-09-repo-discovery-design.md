# Repo Discovery — Add Repositories via Local Scan or GitHub Import

**Date:** 2026-04-09
**Status:** Draft

## Problem

Adding repositories to BDE requires manually typing the name, local path, GitHub owner, and GitHub repo for each one. The browse-folder flow auto-detects git remotes, but you still have to navigate to each repo individually. For a developer with 10+ repos this is tedious and error-prone.

## Solution

Replace the inline "Add Repository" form with a modal that offers two tabs:

1. **Local** — Scan configured directories (1-level deep) for git repos not yet configured in BDE. One-click to add.
2. **GitHub** — List the user's GitHub repos via `gh` CLI. Select one to clone into a configurable directory and auto-configure.

Code review remains local — this feature only affects how repos are discovered and added to BDE's configuration.

## Decisions

| Decision                 | Choice                   | Rationale                                           |
| ------------------------ | ------------------------ | --------------------------------------------------- |
| GitHub repo source       | `gh` CLI                 | Already a BDE prerequisite; handles auth natively   |
| Clone destination        | Configurable default dir | Setting `repos.cloneDir`, defaults `~/projects/`    |
| Scan directories         | Configurable list        | Setting `repos.scanDirs`, defaults `['~/projects']` |
| Scan depth               | 1 level                  | Keeps scanning fast and predictable                 |
| Already-configured repos | Hidden from lists        | Users are here to add, not review existing          |
| Clone progress           | Streaming via IPC events | Clone can take 30s+; frozen spinner is bad UX       |
| UX surface               | Modal with tabs          | Inline form too cramped for repo lists with search  |

## Architecture

### IPC Channels

New channels added to `src/shared/ipc-channels.ts`:

```typescript
// Request/response — add to IpcChannelMap in ipc-channels.ts
'repos:scanLocal':    (dirs: string[]) => LocalRepoInfo[]
'repos:listGithub':   () => GithubRepoInfo[]
'repos:clone':        (owner: string, repo: string, destDir: string) => void
//   ^ resolves immediately after spawning the clone process, NOT after clone completes.
//     Completion is signaled via the push event below.

// Push event (main → renderer) — NOT in IpcChannelMap.
// Follows the same pattern as 'github:rateLimitWarning', 'pr:listUpdated', etc.
'repos:cloneProgress': CloneProgressEvent
```

### Types

```typescript
interface LocalRepoInfo {
  name: string // directory basename
  localPath: string // absolute path
  owner?: string // parsed from git remote
  repo?: string // parsed from git remote
}

interface GithubRepoInfo {
  name: string // repo name
  owner: string // owner login (mapped from gh's owner.login)
  description?: string // repo description
  isPrivate: boolean
  url: string // clone URL
}

interface CloneProgressEvent {
  owner: string
  repo: string
  line: string // single line of git clone stderr output
  done: boolean // true when process has exited
  error?: string // set on non-zero exit
}
```

**`gh` CLI field mapping:** The `gh repo list --json` output uses `owner` as an object (`{ login: "..." }`), not a string. The handler must map `owner.login` → `GithubRepoInfo.owner`. The `--json` fields to request are: `name,owner,description,visibility,url`. Map `visibility === 'private'` → `isPrivate: true`.

### New Settings

| Key              | Type       | Default          | Purpose                                      |
| ---------------- | ---------- | ---------------- | -------------------------------------------- |
| `repos.scanDirs` | `string[]` | `['~/projects']` | Directories to scan for local git repos      |
| `repos.cloneDir` | `string`   | `~/projects`     | Default clone destination for GitHub imports |

Settings store the unexpanded `~` form. Tilde expansion happens at read time in the handler (via `os.homedir()`), so paths remain portable across macOS migrations.

### Main Process

**New file: `src/main/handlers/repo-discovery.ts`**

Registered in `src/main/index.ts` alongside other handler modules.

#### `repos:scanLocal(dirs: string[])`

**Input validation:** Each directory must be an absolute path with no `..` traversal segments (consistent with `git:detectRemote` validation in `git-handlers.ts`). Reject invalid paths with a descriptive error.

1. For each directory in `dirs`, read immediate subdirectories (1 level)
2. For each subdirectory, check if `.git` exists (file or directory — supports worktrees)
3. If git repo, run `git remote get-url origin` via `execFile` to detect remote
4. Parse remote URL using existing `parseGitHubRemote()` from `src/shared/git-remote.ts`
5. Filter out repos whose `localPath` matches any already-configured repo
6. Return `LocalRepoInfo[]` sorted alphabetically by name

**Performance:** Parallelizes git remote detection with `Promise.all`. Typical `~/projects/` with 20 subdirs completes in <500ms.

#### `repos:listGithub()`

1. Run `gh repo list --json name,owner,description,visibility,url --limit 100`
2. Parse JSON output; map `owner.login` → string `owner`, `visibility === 'private'` → `isPrivate`
3. Filter out repos where `owner/name` matches any already-configured repo's `githubOwner/githubRepo`
4. Return `GithubRepoInfo[]`

**Error handling:** If `gh` is not installed or not authenticated, throw a descriptive error that the renderer can display inline (e.g., "Run `gh auth login` to connect your GitHub account").

#### `repos:clone(owner, repo, destDir)`

1. Validate `destDir` exists (create if not)
2. Spawn `git clone https://github.com/{owner}/{repo}.git {destDir}/{repo}` via `child_process.spawn`
3. Stream `stdout` and `stderr` line-by-line, sending `repos:cloneProgress` events via `broadcast()` from `src/main/broadcast.ts` (includes `isDestroyed()` safety check)
4. On process exit code 0: send `{ done: true }`
5. On non-zero exit: send `{ done: true, error: 'Clone failed: ...' }`

Uses `spawn` (not `execFile`) to enable line-by-line streaming. The `GIT_TERMINAL_PROMPT=0` env var prevents git from hanging on auth prompts.

**Clone cancellation:** If the modal is closed during a clone, the child process runs to completion in the background (it's a finite operation). The `repos:cloneProgress` events continue broadcasting; the renderer simply stops rendering them. No kill logic needed.

### Preload Bridge

Add to `src/preload/index.ts`:

```typescript
repoDiscovery: {
  scanLocal: (dirs: string[]) => typedInvoke('repos:scanLocal', dirs),
  listGithub: () => typedInvoke('repos:listGithub'),
  clone: (owner: string, repo: string, destDir: string) =>
    typedInvoke('repos:clone', owner, repo, destDir),
  onCloneProgress: (cb: (data: CloneProgressEvent) => void) => {
    const handler = (_e: IpcRendererEvent, data: CloneProgressEvent): void => cb(data)
    ipcRenderer.on('repos:cloneProgress', handler)
    return () => ipcRenderer.removeListener('repos:cloneProgress', handler)
  },
}
```

The `onCloneProgress` returns an unsubscribe function (consistent with existing listener patterns in the preload). The renderer component calls the returned function in its cleanup/unmount effect.

### Renderer

**New file: `src/renderer/src/components/settings/RepoDiscoveryModal.tsx`**

Modal component with two tabs:

#### Local Tab

- On mount, calls `window.api.repoDiscovery.scanLocal(scanDirs)` with dirs from settings
- Shows a list of discovered repos with: name, path, detected owner/repo (if any)
- Each row has an "Add" button that:
  1. Creates a `RepoConfig` from the `LocalRepoInfo` (assigns next unused color from palette)
  2. Appends to `repos` setting
  3. Shows toast, removes row from list
- Search/filter input at top for filtering by name
- Loading state while scanning
- Empty state: "No unconfigured git repos found in {dirs}"

#### GitHub Tab

- On mount, calls `window.api.repoDiscovery.listGithub()`
- Shows list of repos with: name, owner, description, private badge
- Each row has an "Add" button that:
  1. Shows inline clone progress (subscribe to `repos:cloneProgress`)
  2. Calls `window.api.repoDiscovery.clone(owner, name, cloneDir)`
  3. Streams progress text below the row
  4. On completion: creates `RepoConfig` with `localPath: cloneDir/name`, appends to `repos` setting
  5. Shows toast, removes row from list
- On clone error: shows error inline on the row with a "Retry" option
- Search/filter input at top
- Loading state while fetching repo list
- Empty state: "No repos found" or error message if `gh` not configured

#### Modal Shell

- Triggered by new "Add Repository" button (replaces current inline form behavior)
- Title: "Add Repository"
- Two tabs: "Local" | "GitHub"
- Standard BDE modal patterns (escape to close, click-outside to close)
- Below tabs: settings link or inline display of scan dirs / clone dir so user knows where it's looking

#### Keeping the Manual Fallback

The current inline form is still accessible via a "Manual" link/button in the modal footer, for edge cases where the repo isn't on GitHub or isn't in a scanned directory. This opens the existing inline form (no modal needed for manual).

### Settings UI Integration

The `repos.scanDirs` and `repos.cloneDir` settings need to be editable. Two options:

**Option A (recommended):** Add a small config section at the top of the Repositories tab — a "Scan directories" field (comma-separated or tag input) and a "Clone directory" field with browse button. Visible but not prominent.

**Option B:** Tuck them into the modal itself as expandable "Configure" section.

Going with **Option A** — settings that affect behavior should live in Settings, not hidden in a modal.

## Files to Change

| File                                                           | Change                                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/shared/ipc-channels.ts`                                   | Add `repos:scanLocal`, `repos:listGithub`, `repos:clone` channels + types   |
| `src/main/handlers/repo-discovery.ts`                          | **New** — handler implementations                                           |
| `src/main/index.ts`                                            | Register `registerRepoDiscoveryHandlers()`                                  |
| `src/preload/index.ts`                                         | Add `repoDiscovery` API surface                                             |
| `src/renderer/src/components/settings/RepoDiscoveryModal.tsx`  | **New** — modal with Local/GitHub tabs                                      |
| `src/renderer/src/components/settings/RepositoriesSection.tsx` | Replace inline form trigger with modal trigger, add scan/clone dir settings |
| `src/renderer/src/components/settings/repo-discovery.css`      | **New** — modal-specific styles (tabs, repo list rows, clone progress)      |

## How to Test

1. **Local scan:** Configure `repos.scanDirs` to `~/projects`. Open modal → Local tab. Verify it shows git repos not yet configured. Add one → verify it appears in repo list. Reopen modal → verify the added repo is gone from list.
2. **GitHub import:** Open modal → GitHub tab. Verify it lists your repos. Click Add on one → verify clone progress streams. After clone completes → verify repo appears in config with correct path/owner/repo.
3. **Clone error:** Disconnect network, try to clone → verify error shows inline, not a crash.
4. **`gh` not authed:** Remove `gh` auth, open GitHub tab → verify helpful error message.
5. **Already configured filtering:** Add a repo manually, reopen modal → verify it doesn't appear in either tab.
6. **Manual fallback:** Click "Manual" in modal → verify the old inline form still works.

## Known Limitations

- `gh repo list --limit 100` silently truncates for users with 100+ repos. Pagination can be added later if needed.
- Duplicate repo name detection is not enforced (same as current manual form). Can be added as a follow-up validation.

## Out of Scope

- Cloning into worktrees (repos clone into normal directories)
- Bulk-add (add one at a time from the list)
- GitHub organization filtering (shows all repos the user has access to)
- Editing existing repo configurations (separate concern)
- Any changes to code review flow (stays local as-is)
