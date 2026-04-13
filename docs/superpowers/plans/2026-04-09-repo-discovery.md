# Repo Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a modal to Settings > Repositories that lets users discover local git repos or import from GitHub, replacing manual form entry.

**Architecture:** Three new IPC channels (`repos:scanLocal`, `repos:listGithub`, `repos:clone`) in a new handler module, exposed via preload bridge. A new `RepoDiscoveryModal` component with two tabs (Local/GitHub). Clone progress streamed via push events using existing `broadcast()` utility. Two new settings (`repos.scanDirs`, `repos.cloneDir`) with UI in the Repositories tab.

**Tech Stack:** Electron IPC, `gh` CLI, `child_process.spawn`, React modal with tabs, existing `parseGitHubRemote()` utility.

**Spec:** `docs/superpowers/specs/2026-04-09-repo-discovery-design.md`

---

## File Structure

| File                                                           | Responsibility                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/shared/ipc-channels.ts`                                   | Add `RepoDiscoveryChannels` interface + types to `IpcChannelMap`   |
| `src/main/handlers/repo-discovery.ts`                          | **New** — `scanLocal`, `listGithub`, `clone` handlers              |
| `src/main/index.ts`                                            | Import + register new handlers                                     |
| `src/preload/index.ts`                                         | Add `repoDiscovery` API namespace                                  |
| `src/renderer/src/components/settings/RepoDiscoveryModal.tsx`  | **New** — modal with Local/GitHub tabs                             |
| `src/renderer/src/components/settings/RepositoriesSection.tsx` | Add modal trigger, scan/clone dir settings, remove inline add form |
| `src/renderer/src/assets/settings.css`                         | Add modal styles (`.settings-discovery-*` classes)                 |

Test files:

| File                                                                         | Tests                           |
| ---------------------------------------------------------------------------- | ------------------------------- |
| `src/main/handlers/__tests__/repo-discovery.test.ts`                         | **New** — handler unit tests    |
| `src/renderer/src/components/settings/__tests__/RepoDiscoveryModal.test.tsx` | **New** — modal component tests |

---

### Task 1: Shared Types — IPC Channel Definitions

**Files:**

- Modify: `src/shared/ipc-channels.ts` (add interface before line ~890, add to intersection at line ~919)

- [ ] **Step 1: Add types and channel interface**

Add the types and `RepoDiscoveryChannels` interface. Place before the `IpcChannelMap` type alias (~line 890). The types go at the top of the new interface block.

```typescript
/* ── Repo Discovery ─────────────────────────────────────────────── */

export interface LocalRepoInfo {
  name: string
  localPath: string
  owner?: string
  repo?: string
}

export interface GithubRepoInfo {
  name: string
  owner: string
  description?: string
  isPrivate: boolean
  url: string
}

export interface CloneProgressEvent {
  owner: string
  repo: string
  line: string
  done: boolean
  error?: string
  localPath?: string // expanded absolute path, set on successful clone completion
}

export interface RepoDiscoveryChannels {
  'repos:scanLocal': { args: [dirs: string[]]; result: LocalRepoInfo[] }
  'repos:listGithub': { args: []; result: GithubRepoInfo[] }
  'repos:clone': { args: [owner: string, repo: string, destDir: string]; result: void }
}
```

Then add `& RepoDiscoveryChannels` to the `IpcChannelMap` intersection type (~line 919).

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/ryan/projects/BDE && npx tsc --noEmit`
Expected: No new errors (existing errors OK, no regressions).

- [ ] **Step 3: Commit**

```bash
git add src/shared/ipc-channels.ts
git commit -m "feat: add RepoDiscoveryChannels IPC types"
```

---

### Task 2: Main Process — `repo-discovery.ts` Handler (scanLocal + listGithub)

**Files:**

- Create: `src/main/handlers/repo-discovery.ts`
- Create: `src/main/handlers/__tests__/repo-discovery.test.ts`

- [ ] **Step 1: Write tests for `scanLocal` handler**

Create `src/main/handlers/__tests__/repo-discovery.test.ts`. Mock `child_process`, `fs/promises`, `electron`, and `../repo-discovery` imports. Follow the mocking pattern from `src/main/__tests__/git.test.ts`.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const execFileAsyncMock = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })

vi.mock('child_process', () => {
  const execFile = vi.fn() as any
  execFile[Symbol.for('nodejs.util.promisify.custom')] = execFileAsyncMock
  return { execFile, spawn: vi.fn() }
})

vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  access: vi.fn(),
  mkdir: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '/tmp' }
}))

vi.mock('../../settings', () => ({
  getSettingJson: vi.fn(() => [])
}))

import { scanLocalRepos, listGithubRepos } from '../repo-discovery'
import { readdir, stat, access } from 'fs/promises'
import { getSettingJson } from '../../settings'

describe('scanLocalRepos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns repos found in scanned directories', async () => {
    vi.mocked(readdir).mockResolvedValue(['repo-a', 'repo-b'] as any)
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)
    vi.mocked(access).mockResolvedValue(undefined) // .git exists
    execFileAsyncMock.mockResolvedValue({
      stdout: 'git@github.com:owner/repo-a.git\n',
      stderr: ''
    })

    const result = await scanLocalRepos(['/Users/test/projects'])
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'repo-a', localPath: '/Users/test/projects/repo-a' })
      ])
    )
  })

  it('filters out already-configured repos', async () => {
    vi.mocked(getSettingJson).mockReturnValue([
      { name: 'repo-a', localPath: '/Users/test/projects/repo-a' }
    ] as any)
    vi.mocked(readdir).mockResolvedValue(['repo-a', 'repo-b'] as any)
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)
    vi.mocked(access).mockResolvedValue(undefined)
    execFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' })

    const result = await scanLocalRepos(['/Users/test/projects'])
    expect(result.find((r) => r.name === 'repo-a')).toBeUndefined()
    expect(result.find((r) => r.name === 'repo-b')).toBeDefined()
  })

  it('rejects paths with .. traversal', async () => {
    await expect(scanLocalRepos(['/Users/test/../etc'])).rejects.toThrow()
  })

  it('skips non-directory entries', async () => {
    vi.mocked(readdir).mockResolvedValue(['file.txt'] as any)
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => false } as any)

    const result = await scanLocalRepos(['/Users/test/projects'])
    expect(result).toEqual([])
  })
})

describe('listGithubRepos', () => {
  it('parses gh CLI output and maps fields', async () => {
    execFileAsyncMock.mockResolvedValue({
      stdout: JSON.stringify([
        {
          name: 'my-repo',
          owner: { login: 'octocat' },
          description: 'A test repo',
          visibility: 'public',
          url: 'https://github.com/octocat/my-repo'
        }
      ]),
      stderr: ''
    })

    const result = await listGithubRepos()
    expect(result).toEqual([
      {
        name: 'my-repo',
        owner: 'octocat',
        description: 'A test repo',
        isPrivate: false,
        url: 'https://github.com/octocat/my-repo'
      }
    ])
  })

  it('filters out already-configured repos', async () => {
    vi.mocked(getSettingJson).mockReturnValue([
      { name: 'my-repo', localPath: '/x', githubOwner: 'octocat', githubRepo: 'my-repo' }
    ] as any)
    execFileAsyncMock.mockResolvedValue({
      stdout: JSON.stringify([
        {
          name: 'my-repo',
          owner: { login: 'octocat' },
          description: '',
          visibility: 'public',
          url: ''
        }
      ]),
      stderr: ''
    })

    const result = await listGithubRepos()
    expect(result).toEqual([])
  })

  it('throws descriptive error when gh is not found', async () => {
    execFileAsyncMock.mockRejectedValue(new Error('ENOENT'))

    await expect(listGithubRepos()).rejects.toThrow(/gh/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/main/handlers/__tests__/repo-discovery.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `scanLocalRepos` and `listGithubRepos`**

Create `src/main/handlers/repo-discovery.ts`:

```typescript
import { promisify } from 'util'
import { execFile, spawn } from 'child_process'
import { readdir, stat, access, mkdir } from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { parseGitHubRemote } from '../../shared/git-remote'
import { getSettingJson } from '../settings'
import { safeHandle } from '../ipc-utils'
import { broadcast } from '../broadcast'
import type { LocalRepoInfo, GithubRepoInfo, CloneProgressEvent } from '../../shared/ipc-channels'

const execFileAsync = promisify(execFile)

interface RepoConfig {
  name: string
  localPath: string
  githubOwner?: string
  githubRepo?: string
}

function expandTilde(p: string): string {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p
}

function getConfiguredRepos(): RepoConfig[] {
  return (getSettingJson('repos') as RepoConfig[] | null) ?? []
}

function validateDir(dir: string): void {
  if (typeof dir !== 'string' || (!dir.startsWith('/') && !dir.startsWith('~'))) {
    throw new Error(`Invalid directory: must be an absolute path`)
  }
  if (dir.includes('..')) {
    throw new Error(`Invalid directory: path traversal not allowed`)
  }
}

export async function scanLocalRepos(dirs: string[]): Promise<LocalRepoInfo[]> {
  for (const d of dirs) validateDir(d)

  const configured = getConfiguredRepos()
  const configuredPaths = new Set(configured.map((r) => r.localPath))

  const results: LocalRepoInfo[] = []

  for (const rawDir of dirs) {
    const dir = expandTilde(rawDir)
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      continue // directory doesn't exist or unreadable
    }

    const checks = entries.map(async (entry) => {
      const fullPath = path.join(dir, entry)
      try {
        const s = await stat(fullPath)
        if (!s.isDirectory()) return null
        // Check for .git (file or directory — supports worktrees)
        await access(path.join(fullPath, '.git'))
      } catch {
        return null
      }

      if (configuredPaths.has(fullPath)) return null

      // Detect remote
      let owner: string | undefined
      let repo: string | undefined
      try {
        const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
          cwd: fullPath
        })
        const parsed = parseGitHubRemote(stdout.trim())
        if (parsed) {
          owner = parsed.owner
          repo = parsed.repo
        }
      } catch {
        // No remote or not a git repo — still return it
      }

      return { name: entry, localPath: fullPath, owner, repo } as LocalRepoInfo
    })

    const found = await Promise.all(checks)
    for (const r of found) {
      if (r) results.push(r)
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name))
}

export async function listGithubRepos(): Promise<GithubRepoInfo[]> {
  const configured = getConfiguredRepos()
  const configuredSet = new Set(
    configured
      .filter((r) => r.githubOwner && r.githubRepo)
      .map((r) => `${r.githubOwner}/${r.githubRepo}`.toLowerCase())
  )

  let stdout: string
  try {
    const result = await execFileAsync('gh', [
      'repo',
      'list',
      '--json',
      'name,owner,description,visibility,url',
      '--limit',
      '100'
    ])
    stdout = result.stdout
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new Error('GitHub CLI (gh) is not installed. Install it from https://cli.github.com/')
    }
    if (err.stderr?.includes('auth login') || err.stderr?.includes('not logged')) {
      throw new Error('GitHub CLI is not authenticated. Run `gh auth login` in your terminal.')
    }
    throw new Error(`Failed to list GitHub repos: ${err.message}`)
  }

  const raw = JSON.parse(stdout) as Array<{
    name: string
    owner: { login: string }
    description: string | null
    visibility: string
    url: string
  }>

  return raw
    .map((r) => ({
      name: r.name,
      owner: r.owner.login,
      description: r.description ?? undefined,
      isPrivate: r.visibility === 'PRIVATE',
      url: r.url
    }))
    .filter((r) => !configuredSet.has(`${r.owner}/${r.name}`.toLowerCase()))
}

export function cloneRepo(owner: string, repo: string, destDir: string): void {
  const expanded = expandTilde(destDir)
  const target = path.join(expanded, repo)
  const url = `https://github.com/${owner}/${repo}.git`

  const sendEvent = (evt: Partial<CloneProgressEvent>): void => {
    broadcast('repos:cloneProgress', { owner, repo, line: '', done: false, ...evt })
  }

  // Ensure dest dir exists
  mkdir(expanded, { recursive: true })
    .then(() => {
      const proc = spawn('git', ['clone', '--progress', url, target], {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      })

      proc.stdout?.on('data', (data: Buffer) => {
        data
          .toString()
          .split('\n')
          .filter(Boolean)
          .forEach((line) => sendEvent({ line }))
      })
      proc.stderr?.on('data', (data: Buffer) => {
        data
          .toString()
          .split('\n')
          .filter(Boolean)
          .forEach((line) => sendEvent({ line }))
      })

      proc.on('close', (code) => {
        if (code === 0) {
          sendEvent({ done: true, localPath: target })
        } else {
          sendEvent({ done: true, error: `Clone failed with exit code ${code}` })
        }
      })

      proc.on('error', (err) => {
        sendEvent({ done: true, error: `Clone error: ${err.message}` })
      })
    })
    .catch((err) => {
      sendEvent({ done: true, error: `Failed to create directory: ${err.message}` })
    })
}

export function registerRepoDiscoveryHandlers(): void {
  safeHandle('repos:scanLocal', async (_e, dirs: string[]) => {
    return scanLocalRepos(dirs)
  })

  safeHandle('repos:listGithub', async () => {
    return listGithubRepos()
  })

  safeHandle('repos:clone', async (_e, owner: string, repo: string, destDir: string) => {
    cloneRepo(owner, repo, destDir)
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/main/handlers/__tests__/repo-discovery.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/handlers/repo-discovery.ts src/main/handlers/__tests__/repo-discovery.test.ts
git commit -m "feat: add repo-discovery handlers (scanLocal + listGithub + clone)"
```

---

### Task 3: Wire Up Handler Registration + Preload Bridge

**Files:**

- Modify: `src/main/index.ts` (~line 28 for import, ~line 294 for registration)
- Modify: `src/preload/index.ts` (~line 543 for new API namespace)

- [ ] **Step 1: Register handler in main process**

In `src/main/index.ts`:

Add import after the last handler import (~line 28):

```typescript
import { registerRepoDiscoveryHandlers } from './handlers/repo-discovery'
```

Add registration call after `registerPlannerImportHandlers()` (~line 294):

```typescript
registerRepoDiscoveryHandlers()
```

- [ ] **Step 2: Add preload API surface**

In `src/preload/index.ts`, add before the closing `}` of the `api` object (~line 543):

```typescript
  repoDiscovery: {
    scanLocal: (dirs: string[]) => typedInvoke('repos:scanLocal', dirs),
    listGithub: () => typedInvoke('repos:listGithub'),
    clone: (owner: string, repo: string, destDir: string) =>
      typedInvoke('repos:clone', owner, repo, destDir),
    onCloneProgress: (
      cb: (data: { owner: string; repo: string; line: string; done: boolean; error?: string; localPath?: string }) => void
    ): (() => void) => {
      const handler = (_e: unknown, data: any): void => cb(data)
      ipcRenderer.on('repos:cloneProgress', handler)
      return () => ipcRenderer.removeListener('repos:cloneProgress', handler)
    }
  },
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd /Users/ryan/projects/BDE && npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "feat: wire repo-discovery handlers + preload bridge"
```

---

### Task 4: RepoDiscoveryModal — Local Tab

**Files:**

- Create: `src/renderer/src/components/settings/RepoDiscoveryModal.tsx`
- Create: `src/renderer/src/components/settings/__tests__/RepoDiscoveryModal.test.tsx`

- [ ] **Step 1: Write tests for the Local tab**

Create `src/renderer/src/components/settings/__tests__/RepoDiscoveryModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { RepoDiscoveryModal } from '../RepoDiscoveryModal'

// Mock window.api
const mockScanLocal = vi.fn()
const mockListGithub = vi.fn()
const mockClone = vi.fn()
const mockOnCloneProgress = vi.fn(() => vi.fn()) // returns unsubscribe
const mockSettingsGetJson = vi.fn()
const mockSettingsSetJson = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockScanLocal.mockResolvedValue([])
  mockListGithub.mockResolvedValue([])
  mockSettingsGetJson.mockResolvedValue(null)
  ;(window as any).api = {
    repoDiscovery: {
      scanLocal: mockScanLocal,
      listGithub: mockListGithub,
      clone: mockClone,
      onCloneProgress: mockOnCloneProgress
    },
    settings: {
      getJson: mockSettingsGetJson,
      setJson: mockSettingsSetJson
    }
  }
})

describe('RepoDiscoveryModal', () => {
  it('renders with Local tab active by default', async () => {
    render(<RepoDiscoveryModal open onClose={vi.fn()} onRepoAdded={vi.fn()} repos={[]} />)
    expect(screen.getByRole('tab', { name: /local/i })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows discovered local repos', async () => {
    mockScanLocal.mockResolvedValue([
      {
        name: 'my-project',
        localPath: '/Users/test/projects/my-project',
        owner: 'octocat',
        repo: 'my-project'
      }
    ])

    render(<RepoDiscoveryModal open onClose={vi.fn()} onRepoAdded={vi.fn()} repos={[]} />)

    await waitFor(() => {
      expect(screen.getByText('my-project')).toBeInTheDocument()
    })
  })

  it('shows empty state when no local repos found', async () => {
    mockScanLocal.mockResolvedValue([])

    render(<RepoDiscoveryModal open onClose={vi.fn()} onRepoAdded={vi.fn()} repos={[]} />)

    await waitFor(() => {
      expect(screen.getByText(/no unconfigured/i)).toBeInTheDocument()
    })
  })

  it('calls onRepoAdded when Add button clicked', async () => {
    const onRepoAdded = vi.fn()
    mockScanLocal.mockResolvedValue([
      {
        name: 'my-project',
        localPath: '/Users/test/projects/my-project',
        owner: 'oct',
        repo: 'my-project'
      }
    ])

    render(<RepoDiscoveryModal open onClose={vi.fn()} onRepoAdded={onRepoAdded} repos={[]} />)

    await waitFor(() => {
      expect(screen.getByText('my-project')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /add/i }))

    await waitFor(() => {
      expect(onRepoAdded).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'my-project',
          localPath: '/Users/test/projects/my-project'
        })
      )
    })
  })

  it('filters repos by search query', async () => {
    mockScanLocal.mockResolvedValue([
      { name: 'alpha', localPath: '/p/alpha' },
      { name: 'beta', localPath: '/p/beta' }
    ])

    render(<RepoDiscoveryModal open onClose={vi.fn()} onRepoAdded={vi.fn()} repos={[]} />)

    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'bet' } })

    expect(screen.queryByText('alpha')).not.toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
  })

  it('does not render when open is false', () => {
    const { container } = render(
      <RepoDiscoveryModal open={false} onClose={vi.fn()} onRepoAdded={vi.fn()} repos={[]} />
    )
    expect(container.innerHTML).toBe('')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/renderer/src/components/settings/__tests__/RepoDiscoveryModal.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement RepoDiscoveryModal component**

Create `src/renderer/src/components/settings/RepoDiscoveryModal.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, Plus, Lock, Globe, Loader2, AlertCircle, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { toast } from '../../stores/toasts'

interface RepoConfig {
  name: string
  localPath: string
  githubOwner?: string
  githubRepo?: string
  color?: string
}

interface LocalRepoInfo {
  name: string
  localPath: string
  owner?: string
  repo?: string
}

interface GithubRepoInfo {
  name: string
  owner: string
  description?: string
  isPrivate: boolean
  url: string
}

interface CloneState {
  key: string // owner/repo
  lines: string[]
  done: boolean
  error?: string
  localPath?: string // expanded absolute path from main process
}

const REPO_COLOR_PALETTE = [
  '#6C8EEF',
  '#00D37F',
  '#FF8A00',
  '#EF4444',
  '#8B5CF6',
  '#3B82F6',
  '#F97316',
  '#06B6D4'
]

interface Props {
  open: boolean
  onClose: () => void
  onRepoAdded: (repo: RepoConfig) => void
  repos: RepoConfig[]
}

type Tab = 'local' | 'github'

function nextColor(repos: RepoConfig[]): string {
  const used = new Set(repos.map((r) => r.color))
  return REPO_COLOR_PALETTE.find((c) => !used.has(c)) ?? REPO_COLOR_PALETTE[0]
}

export function RepoDiscoveryModal({
  open,
  onClose,
  onRepoAdded,
  repos
}: Props): React.JSX.Element | null {
  const [tab, setTab] = useState<Tab>('local')
  const [search, setSearch] = useState('')

  // Local tab state
  const [localRepos, setLocalRepos] = useState<LocalRepoInfo[]>([])
  const [localLoading, setLocalLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  // GitHub tab state
  const [ghRepos, setGhRepos] = useState<GithubRepoInfo[]>([])
  const [ghLoading, setGhLoading] = useState(false)
  const [ghError, setGhError] = useState<string | null>(null)
  const [cloneStates, setCloneStates] = useState<Record<string, CloneState>>({})

  const backdropRef = useRef<HTMLDivElement>(null)

  // Load scan dirs setting
  const loadLocalRepos = useCallback(async () => {
    setLocalLoading(true)
    setLocalError(null)
    try {
      const scanDirs = (await window.api.settings.getJson('repos.scanDirs')) as string[] | null
      const dirs = scanDirs ?? ['~/projects']
      const results = await window.api.repoDiscovery.scanLocal(dirs)
      setLocalRepos(results)
    } catch (err: any) {
      setLocalError(err.message ?? 'Failed to scan directories')
    } finally {
      setLocalLoading(false)
    }
  }, [])

  const loadGhRepos = useCallback(async () => {
    setGhLoading(true)
    setGhError(null)
    try {
      const results = await window.api.repoDiscovery.listGithub()
      setGhRepos(results)
    } catch (err: any) {
      setGhError(err.message ?? 'Failed to list GitHub repos')
    } finally {
      setGhLoading(false)
    }
  }, [])

  // Load data on tab switch
  useEffect(() => {
    if (!open) return
    setSearch('')
    if (tab === 'local') loadLocalRepos()
    else loadGhRepos()
  }, [open, tab, loadLocalRepos, loadGhRepos])

  // Clone progress listener
  useEffect(() => {
    if (!open) return
    const unsub = window.api.repoDiscovery.onCloneProgress((data) => {
      const key = `${data.owner}/${data.repo}`
      setCloneStates((prev) => {
        const existing = prev[key] ?? { key, lines: [], done: false }
        const lines = data.line ? [...existing.lines.slice(-20), data.line] : existing.lines
        return {
          ...prev,
          [key]: { key, lines, done: data.done, error: data.error, localPath: data.localPath }
        }
      })
    })
    return unsub
  }, [open])

  // Keyboard: Escape to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  const handleAddLocal = useCallback(
    (repo: LocalRepoInfo) => {
      const config: RepoConfig = {
        name: repo.name,
        localPath: repo.localPath,
        githubOwner: repo.owner,
        githubRepo: repo.repo,
        color: nextColor(repos)
      }
      onRepoAdded(config)
      setLocalRepos((prev) => prev.filter((r) => r.localPath !== repo.localPath))
      toast.success(`Added "${repo.name}"`)
    },
    [repos, onRepoAdded]
  )

  const handleClone = useCallback(async (repo: GithubRepoInfo) => {
    const cloneDir =
      ((await window.api.settings.getJson('repos.cloneDir')) as string | null) ?? '~/projects'
    await window.api.repoDiscovery.clone(repo.owner, repo.name, cloneDir)
  }, [])

  // Track which clones have been processed to prevent double-firing
  const processedClonesRef = useRef<Set<string>>(new Set())

  // Watch clone completion to auto-add repo
  useEffect(() => {
    for (const [key, state] of Object.entries(cloneStates)) {
      if (!state.done || state.error || !state.localPath) continue
      if (processedClonesRef.current.has(key)) continue
      processedClonesRef.current.add(key)

      const [owner, name] = key.split('/')
      const ghRepo = ghRepos.find((r) => r.owner === owner && r.name === name)
      if (!ghRepo) continue

      const config: RepoConfig = {
        name: ghRepo.name,
        localPath: state.localPath, // expanded absolute path from main process
        githubOwner: ghRepo.owner,
        githubRepo: ghRepo.name,
        color: nextColor(repos)
      }
      onRepoAdded(config)
      setGhRepos((prev) => prev.filter((r) => !(r.owner === owner && r.name === name)))
      toast.success(`Cloned and added "${ghRepo.name}"`)
    }
  }, [cloneStates, ghRepos, repos, onRepoAdded])

  const filteredLocal = useMemo(() => {
    if (!search) return localRepos
    const q = search.toLowerCase()
    return localRepos.filter((r) => r.name.toLowerCase().includes(q))
  }, [localRepos, search])

  const filteredGh = useMemo(() => {
    if (!search) return ghRepos
    const q = search.toLowerCase()
    return ghRepos.filter(
      (r) => r.name.toLowerCase().includes(q) || r.owner.toLowerCase().includes(q)
    )
  }, [ghRepos, search])

  if (!open) return null

  return (
    <div
      className="settings-discovery-backdrop"
      ref={backdropRef}
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Add Repository"
    >
      <div className="settings-discovery-modal">
        <div className="settings-discovery-header">
          <h2>Add Repository</h2>
          <button className="settings-discovery-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="settings-discovery-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'local'}
            className={`settings-discovery-tab ${tab === 'local' ? 'settings-discovery-tab--active' : ''}`}
            onClick={() => setTab('local')}
          >
            Local
          </button>
          <button
            role="tab"
            aria-selected={tab === 'github'}
            className={`settings-discovery-tab ${tab === 'github' ? 'settings-discovery-tab--active' : ''}`}
            onClick={() => setTab('github')}
          >
            GitHub
          </button>
        </div>

        <div className="settings-discovery-search">
          <Search size={14} />
          <input
            placeholder="Search repos..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="settings-discovery-list" role="tabpanel">
          {tab === 'local' && (
            <>
              {localLoading && (
                <div className="settings-discovery-empty">
                  <Loader2 size={20} className="settings-discovery-spinner" />
                  Scanning directories...
                </div>
              )}
              {localError && (
                <div className="settings-discovery-error">
                  <AlertCircle size={14} /> {localError}
                </div>
              )}
              {!localLoading && !localError && filteredLocal.length === 0 && (
                <div className="settings-discovery-empty">No unconfigured git repos found</div>
              )}
              {filteredLocal.map((r) => (
                <div key={r.localPath} className="settings-discovery-row">
                  <div className="settings-discovery-row__info">
                    <span className="settings-discovery-row__name">{r.name}</span>
                    <span className="settings-discovery-row__path">{r.localPath}</span>
                    {r.owner && r.repo && (
                      <span className="settings-discovery-row__github">
                        {r.owner}/{r.repo}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleAddLocal(r)}
                    aria-label={`Add ${r.name}`}
                  >
                    <Plus size={14} /> Add
                  </Button>
                </div>
              ))}
            </>
          )}

          {tab === 'github' && (
            <>
              {ghLoading && (
                <div className="settings-discovery-empty">
                  <Loader2 size={20} className="settings-discovery-spinner" />
                  Loading GitHub repos...
                </div>
              )}
              {ghError && (
                <div className="settings-discovery-error">
                  <AlertCircle size={14} /> {ghError}
                </div>
              )}
              {!ghLoading && !ghError && filteredGh.length === 0 && (
                <div className="settings-discovery-empty">No repos found</div>
              )}
              {filteredGh.map((r) => {
                const cloneKey = `${r.owner}/${r.name}`
                const cloning = cloneStates[cloneKey]
                return (
                  <div key={cloneKey} className="settings-discovery-row">
                    <div className="settings-discovery-row__info">
                      <span className="settings-discovery-row__name">
                        {r.isPrivate ? <Lock size={12} /> : <Globe size={12} />} {r.owner}/{r.name}
                      </span>
                      {r.description && (
                        <span className="settings-discovery-row__desc">{r.description}</span>
                      )}
                      {cloning && !cloning.done && (
                        <span className="settings-discovery-row__progress">
                          {cloning.lines[cloning.lines.length - 1] ?? 'Cloning...'}
                        </span>
                      )}
                      {cloning?.error && (
                        <span className="settings-discovery-row__error">{cloning.error}</span>
                      )}
                    </div>
                    {!cloning || cloning.error ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleClone(r)}
                        aria-label={`Clone ${r.name}`}
                      >
                        <Plus size={14} /> {cloning?.error ? 'Retry' : 'Clone'}
                      </Button>
                    ) : !cloning.done ? (
                      <Loader2 size={16} className="settings-discovery-spinner" />
                    ) : null}
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/renderer/src/components/settings/__tests__/RepoDiscoveryModal.test.tsx`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/settings/RepoDiscoveryModal.tsx src/renderer/src/components/settings/__tests__/RepoDiscoveryModal.test.tsx
git commit -m "feat: add RepoDiscoveryModal with Local tab"
```

---

### Task 5: CSS Styles for Modal

**Files:**

- Modify: `src/renderer/src/assets/settings.css` (append new classes)

- [ ] **Step 1: Add modal styles**

Append to `src/renderer/src/assets/settings.css`:

```css
/* ── Repo Discovery Modal ─────────────────────────────── */

.settings-discovery-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.settings-discovery-modal {
  background: var(--bde-bg-secondary, #1e1e2e);
  border: 1px solid var(--bde-border, #333);
  border-radius: 12px;
  width: 560px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
}

.settings-discovery-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 0;
}

.settings-discovery-header h2 {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.settings-discovery-close {
  background: none;
  border: none;
  color: var(--bde-text-dim, #888);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}

.settings-discovery-close:hover {
  color: var(--bde-text, #fff);
  background: var(--bde-bg-hover, #2a2a3a);
}

.settings-discovery-tabs {
  display: flex;
  gap: 0;
  padding: 12px 20px 0;
  border-bottom: 1px solid var(--bde-border, #333);
}

.settings-discovery-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 8px 16px;
  color: var(--bde-text-dim, #888);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}

.settings-discovery-tab:hover {
  color: var(--bde-text, #fff);
}

.settings-discovery-tab--active {
  color: var(--bde-text, #fff);
  border-bottom-color: var(--bde-accent, #6c8eef);
}

.settings-discovery-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--bde-border, #333);
  color: var(--bde-text-dim, #888);
}

.settings-discovery-search input {
  background: none;
  border: none;
  outline: none;
  color: var(--bde-text, #fff);
  font-size: 13px;
  flex: 1;
}

.settings-discovery-list {
  overflow-y: auto;
  padding: 8px 0;
  flex: 1;
  min-height: 200px;
  max-height: 400px;
}

.settings-discovery-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  gap: 12px;
}

.settings-discovery-row:hover {
  background: var(--bde-bg-hover, #2a2a3a);
}

.settings-discovery-row__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.settings-discovery-row__name {
  font-size: 13px;
  font-weight: 500;
  color: var(--bde-text, #fff);
  display: flex;
  align-items: center;
  gap: 6px;
}

.settings-discovery-row__path,
.settings-discovery-row__desc {
  font-size: 11px;
  color: var(--bde-text-dim, #888);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-discovery-row__github {
  font-size: 11px;
  color: var(--bde-accent, #6c8eef);
}

.settings-discovery-row__progress {
  font-size: 11px;
  color: var(--bde-text-dim, #888);
  font-family: var(--bde-font-mono, monospace);
}

.settings-discovery-row__error {
  font-size: 11px;
  color: var(--bde-danger, #ef4444);
}

.settings-discovery-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 20px;
  color: var(--bde-text-dim, #888);
  font-size: 13px;
}

.settings-discovery-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  color: var(--bde-danger, #ef4444);
  font-size: 13px;
}

.settings-discovery-spinner {
  animation: bde-spin 1s linear infinite; /* reuses existing @keyframes bde-spin from design-system.css */
}
```

- [ ] **Step 2: Verify the app builds**

Run: `cd /Users/ryan/projects/BDE && npm run build`
Expected: Build passes.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/assets/settings.css
git commit -m "feat: add repo discovery modal styles"
```

---

### Task 6: Integrate Modal into RepositoriesSection

**Files:**

- Modify: `src/renderer/src/components/settings/RepositoriesSection.tsx`

- [ ] **Step 1: Write test for modal integration**

Add to `src/renderer/src/components/settings/__tests__/RepoDiscoveryModal.test.tsx` (or create a separate file if preferred):

```tsx
describe('RepositoriesSection integration', () => {
  it('opens discovery modal when Add Repository is clicked', async () => {
    // This is tested via the existing RepositoriesSection component
    // The key behavior: clicking "Add Repository" opens the modal instead of inline form
  })
})
```

_(The primary integration test is that the modal opens and the inline form is gone — this is verified manually and via the existing RepoDiscoveryModal tests.)_

- [ ] **Step 2: Update RepositoriesSection to use the modal**

In `src/renderer/src/components/settings/RepositoriesSection.tsx`:

1. Import `RepoDiscoveryModal`
2. Add `showModal` state (replaces `adding` state for the inline form)
3. Add `handleRepoAdded` callback that saves to settings
4. Replace the `adding && (...)` block with the manual form fallback
5. Replace the "Add Repository" button to open the modal
6. Add scan/clone dir settings above the repo list
7. Keep the existing remove/ConfirmModal logic unchanged

Replace the component with:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { Trash2, Plus, FolderOpen } from 'lucide-react'
import { toast } from '../../stores/toasts'
import { Button } from '../ui/Button'
import { ConfirmModal, useConfirm } from '../ui/ConfirmModal'
import { SettingsCard } from './SettingsCard'
import { RepoDiscoveryModal } from './RepoDiscoveryModal'

const REPO_COLOR_PALETTE = [
  '#6C8EEF',
  '#00D37F',
  '#FF8A00',
  '#EF4444',
  '#8B5CF6',
  '#3B82F6',
  '#F97316',
  '#06B6D4'
]

interface RepoConfig {
  name: string
  localPath: string
  githubOwner?: string
  githubRepo?: string
  color?: string
}

export function RepositoriesSection(): React.JSX.Element {
  const { confirm, confirmProps } = useConfirm()
  const [repos, setRepos] = useState<RepoConfig[]>([])
  const [showModal, setShowModal] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [deletingName, setDeletingName] = useState<string | null>(null)

  // Manual form state
  const [newName, setNewName] = useState('')
  const [newPath, setNewPath] = useState('')
  const [newOwner, setNewOwner] = useState('')
  const [newRepo, setNewRepo] = useState('')
  const [newColor, setNewColor] = useState(REPO_COLOR_PALETTE[0])
  const [saving, setSaving] = useState(false)

  // Discovery settings
  const [scanDirs, setScanDirs] = useState('~/projects')
  const [cloneDir, setCloneDir] = useState('~/projects')

  useEffect(() => {
    window.api.settings.getJson('repos').then((raw) => {
      if (Array.isArray(raw)) setRepos(raw as RepoConfig[])
    })
    window.api.settings.getJson('repos.scanDirs').then((raw) => {
      if (Array.isArray(raw)) setScanDirs(raw.join(', '))
    })
    window.api.settings.getJson('repos.cloneDir').then((raw) => {
      if (typeof raw === 'string') setCloneDir(raw)
    })
  }, [])

  const saveRepos = useCallback(async (updated: RepoConfig[]) => {
    await window.api.settings.setJson('repos', updated)
    setRepos(updated)
  }, [])

  const handleRemove = useCallback(
    async (name: string) => {
      const ok = await confirm({
        message: `Remove repository "${name}" from BDE?`,
        confirmLabel: 'Remove',
        variant: 'danger'
      })
      if (!ok) return
      setDeletingName(name)
      try {
        const updated = repos.filter((r) => r.name !== name)
        await saveRepos(updated)
        toast.success(`Removed "${name}"`)
      } finally {
        setDeletingName(null)
      }
    },
    [repos, saveRepos, confirm]
  )

  const handleRepoAdded = useCallback(
    async (repo: RepoConfig) => {
      const updated = [...repos, repo]
      await saveRepos(updated)
    },
    [repos, saveRepos]
  )

  const handleManualAdd = useCallback(async () => {
    if (!newName.trim() || !newPath.trim()) return
    setSaving(true)
    try {
      const repo: RepoConfig = {
        name: newName.trim(),
        localPath: newPath.trim(),
        githubOwner: newOwner.trim() || undefined,
        githubRepo: newRepo.trim() || undefined,
        color: newColor
      }
      await handleRepoAdded(repo)
      setShowManual(false)
      setNewName('')
      setNewPath('')
      setNewOwner('')
      setNewRepo('')
      setNewColor(REPO_COLOR_PALETTE[0])
      toast.success(`Added "${newName.trim()}"`)
    } finally {
      setSaving(false)
    }
  }, [newName, newPath, newOwner, newRepo, newColor, handleRepoAdded])

  const handleBrowse = useCallback(async () => {
    const dir = await window.api.openDirectoryDialog()
    if (!dir) return
    setNewPath(dir)
    const basename = dir.split('/').filter(Boolean).pop() ?? ''
    if (!newName.trim() && basename) setNewName(basename)
    try {
      const detected = await window.api.gitDetectRemote(dir)
      if (detected.isGitRepo && detected.owner && detected.repo) {
        if (!newOwner.trim()) setNewOwner(detected.owner)
        if (!newRepo.trim()) setNewRepo(detected.repo)
        toast.success(`Detected ${detected.owner}/${detected.repo}`)
      } else if (!detected.isGitRepo) {
        toast.info('Not a git repository (you can still add it manually)')
      }
    } catch {
      /* non-fatal */
    }
  }, [newName, newOwner, newRepo])

  const handleSaveScanDirs = useCallback(async () => {
    const dirs = scanDirs
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean)
    await window.api.settings.setJson('repos.scanDirs', dirs)
    toast.success('Scan directories updated')
  }, [scanDirs])

  const handleSaveCloneDir = useCallback(async () => {
    await window.api.settings.setJson('repos.cloneDir', cloneDir.trim())
    toast.success('Clone directory updated')
  }, [cloneDir])

  return (
    <>
      <ConfirmModal {...confirmProps} />
      <RepoDiscoveryModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onRepoAdded={handleRepoAdded}
        repos={repos}
      />

      {/* Discovery settings */}
      <div className="settings-discovery-config">
        <div className="settings-discovery-config__row">
          <label className="settings-field__label">Scan directories</label>
          <div className="settings-discovery-config__input-row">
            <input
              className="settings-field__input"
              value={scanDirs}
              onChange={(e) => setScanDirs(e.target.value)}
              placeholder="~/projects"
              onBlur={handleSaveScanDirs}
            />
          </div>
          <span className="settings-field__hint">Comma-separated. Used by Local tab.</span>
        </div>
        <div className="settings-discovery-config__row">
          <label className="settings-field__label">Clone directory</label>
          <div className="settings-discovery-config__input-row">
            <input
              className="settings-field__input"
              value={cloneDir}
              onChange={(e) => setCloneDir(e.target.value)}
              placeholder="~/projects"
              onBlur={handleSaveCloneDir}
            />
          </div>
          <span className="settings-field__hint">Where GitHub repos are cloned to.</span>
        </div>
      </div>

      <div className="settings-cards-list">
        {repos.length === 0 && !showManual && (
          <span className="settings-repos__empty">No repositories configured</span>
        )}

        {repos.map((r) => (
          <SettingsCard
            key={r.name}
            title={r.name}
            subtitle={r.localPath}
            icon={
              <span
                className="settings-repo__dot"
                style={{ background: r.color ?? 'var(--bde-text-dim)' }}
              />
            }
            footer={
              <div className="settings-card-footer-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(r.name)}
                  disabled={deletingName === r.name}
                  loading={deletingName === r.name}
                  title="Remove repository"
                  aria-label="Remove repository"
                  type="button"
                >
                  <Trash2 size={14} /> {deletingName === r.name ? 'Deleting...' : 'Delete'}
                </Button>
              </div>
            }
          >
            {r.githubOwner && r.githubRepo && (
              <span className="settings-repo__github">
                {r.githubOwner}/{r.githubRepo}
              </span>
            )}
          </SettingsCard>
        ))}

        {/* Manual add form (fallback) */}
        {showManual && (
          <SettingsCard title="Add Repository (Manual)">
            <div className="settings-repo-form">
              <div className="settings-repo-form__row">
                <input
                  className="settings-field__input"
                  placeholder="Name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <div className="settings-repo-form__path-row">
                  <input
                    className="settings-field__input"
                    placeholder="Local path"
                    value={newPath}
                    onChange={(e) => setNewPath(e.target.value)}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleBrowse}
                    title="Browse"
                    type="button"
                  >
                    <FolderOpen size={14} />
                  </Button>
                </div>
              </div>
              <div className="settings-repo-form__row">
                <input
                  className="settings-field__input"
                  placeholder="GitHub owner (optional)"
                  value={newOwner}
                  onChange={(e) => setNewOwner(e.target.value)}
                />
                <input
                  className="settings-field__input"
                  placeholder="GitHub repo (optional)"
                  value={newRepo}
                  onChange={(e) => setNewRepo(e.target.value)}
                />
              </div>
              <div className="settings-repo-form__row">
                <div className="settings-colors">
                  {REPO_COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      className={`settings-color ${newColor === c ? 'settings-color--active' : ''}`}
                      style={{ background: c }}
                      onClick={() => setNewColor(c)}
                      aria-label={`Color ${c}`}
                      type="button"
                    />
                  ))}
                </div>
                <div className="settings-repo-form__actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowManual(false)}
                    type="button"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleManualAdd}
                    disabled={!newName.trim() || !newPath.trim() || saving}
                    loading={saving}
                    type="button"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              </div>
            </div>
          </SettingsCard>
        )}

        {!showManual && (
          <div className="settings-repos__actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowModal(true)}
              type="button"
              className="settings-repos__add-btn"
            >
              <Plus size={14} /> Add Repository
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowManual(true)}
              type="button"
              className="settings-repos__manual-btn"
            >
              Manual
            </Button>
          </div>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 3: Add CSS for discovery config section**

Append to `src/renderer/src/assets/settings.css`:

```css
/* ── Discovery Config ─────────────────────────────────── */

.settings-discovery-config {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.settings-discovery-config__row {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.settings-discovery-config__input-row {
  display: flex;
  gap: 8px;
}

.settings-repos__actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
```

- [ ] **Step 4: Verify typecheck and tests pass**

Run: `cd /Users/ryan/projects/BDE && npx tsc --noEmit && npx vitest run src/renderer/src/components/settings/`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/settings/RepositoriesSection.tsx src/renderer/src/assets/settings.css
git commit -m "feat: integrate RepoDiscoveryModal into RepositoriesSection"
```

---

### Task 7: Full Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck`
Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `cd /Users/ryan/projects/BDE && npm test`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `cd /Users/ryan/projects/BDE && npm run lint`
Expected: PASS (warnings OK)

- [ ] **Step 4: Run build**

Run: `cd /Users/ryan/projects/BDE && npm run build`
Expected: PASS
