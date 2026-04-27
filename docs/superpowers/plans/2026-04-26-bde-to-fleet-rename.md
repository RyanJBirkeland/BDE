# FLEET → FLEET Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the product from "FLEET" to "FLEET" across all source files, config, docs, runtime paths, and the project directory itself — zero stale references remaining.

**Architecture:** Automated sed sweep over all text files (longest-match-first to avoid partial replacements), followed by targeted manual edits for the GitHub URL and a new SQLite migration for existing task rows, then a runtime directory migration on startup, and finally a filesystem directory rename.

**Tech Stack:** Node.js/TypeScript, Electron, better-sqlite3, shell (sed/grep/mv)

**Spec:** `docs/superpowers/specs/2026-04-26-fleet-to-fleet-rename-design.md`

---

## File Map

**Renamed:**
- `docs/FLEET_FEATURES.md` → `docs/FLEET_FEATURES.md`

**Modified (automated sed):**
- All `.ts`, `.tsx`, `.js`, `.mjs`, `.json`, `.yml`, `.yaml`, `.md`, `.css`, `.html`, `.sh` under `src/`, `scripts/`, `resources/`, `e2e/`, `docs/` (excl. `node_modules`, `.git`, `out/`, `release/`)
- `~/CLAUDE.md` (global)

**Manually edited:**
- `src/renderer/src/components/settings/AboutSection.tsx` — GitHub URL TODO comment
- `src/main/index.ts` — `setAppUserModelId('com.fleet')` → `com.fleet`

**Created:**
- `src/main/migrations/v055-rename-fleet-to-fleet-repo-column.ts`
- `src/main/migrations/__tests__/v055.test.ts`
- Runtime migration logic added to `src/main/startup-migration.ts` (new file) and wired into `src/main/index.ts`

**Directory rename (last step):**
- `~/projects/FLEET` → `~/projects/FLEET`

---

### Task 1: Rename FLEET_FEATURES.md and update the @ directive

**Files:**
- Rename: `docs/FLEET_FEATURES.md` → `docs/FLEET_FEATURES.md`
- Modify: `CLAUDE.md` (repo root) — update `@docs/FLEET_FEATURES.md` → `@docs/FLEET_FEATURES.md`

- [ ] **Step 1: Rename the file**

```bash
cd ~/projects/FLEET
git mv docs/FLEET_FEATURES.md docs/FLEET_FEATURES.md
```

- [ ] **Step 2: Update the @ directive in CLAUDE.md**

In `CLAUDE.md`, find and replace:
```
@docs/FLEET_FEATURES.md
```
with:
```
@docs/FLEET_FEATURES.md
```

- [ ] **Step 3: Verify**

```bash
grep "@docs/FLEET_FEATURES" ~/projects/FLEET/CLAUDE.md
# Expected: no output
ls ~/projects/FLEET/docs/FLEET_FEATURES.md
# Expected: file exists
```

- [ ] **Step 4: Commit**

```bash
cd ~/projects/FLEET
git add docs/FLEET_FEATURES.md CLAUDE.md
git commit -m "chore: rename FLEET_FEATURES.md to FLEET_FEATURES.md"
```

---

### Task 2: Run the automated sed sweep

**Files:** All text files in the repo (see File Map above)

Apply substitutions in longest-match-first order to avoid partial replacements. The sweep must exclude `node_modules`, `.git`, `out/`, `release/`, and binary files.

- [ ] **Step 1: Run full sed sweep**

```bash
cd ~/projects/FLEET

# Helper: apply a sed substitution to all text files
sweep() {
  grep -rl "$1" \
    --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" \
    --include="*.json" --include="*.yml" --include="*.yaml" \
    --include="*.md" --include="*.css" --include="*.html" --include="*.sh" \
    --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=out --exclude-dir=release \
    . | xargs sed -i '' "s/$1/$2/g"
}

# 1. Longest phrase first
sweep 'Agentic Development Environment' 'Agentic Development Environment'

# 2. ALL-CAPS variant
sweep 'FLEET' 'FLEET'

# 3. lowercase variant
sweep 'fleet' 'fleet'

# 4. PascalCase variant (e.g. FleetConfig → FleetConfig — rare, but cover it)
sweep 'Fleet' 'Fleet'
```

> **Note:** `sed -i ''` is the macOS syntax for in-place edit. On Linux use `sed -i`.

- [ ] **Step 2: Verify the sweep caught the key substitutions**

```bash
# Check package.json name and productName
grep '"name"\|"productName"\|"description"' ~/projects/FLEET/package.json
# Expected: "fleet", "FLEET", "Agentic Development Environment"

# Check electron-builder.yml
grep "appId\|productName\|copyright" ~/projects/FLEET/electron-builder.yml
# Expected: com.rbtechboy.fleet, FLEET

# Check paths.ts constants
grep "FLEET_DIR\|FLEET_DB_PATH\|\.fleet" ~/projects/FLEET/src/main/paths.ts | head -5
# Expected: FLEET_DIR, fleet.db, ~/.fleet

# Check HTTP headers
grep "X-FLEET-\|X-FLEET-" ~/projects/FLEET/src/main/mcp-server/ -r
# Expected: X-FLEET-Delivery, X-FLEET-Event (no X-FLEET- remaining)
```

- [ ] **Step 3: Commit**

```bash
cd ~/projects/FLEET
git add -A
git commit -m "chore: automated FLEET→FLEET rename sweep"
```

---

### Task 3: Manual fix — AboutSection.tsx GitHub URL

**Files:**
- Modify: `src/renderer/src/components/settings/AboutSection.tsx` line 11

The GitHub URL points to an external repo that hasn't been renamed yet. Add a TODO comment and update the URL string.

- [ ] **Step 1: Edit AboutSection.tsx**

In `src/renderer/src/components/settings/AboutSection.tsx`, find:
```ts
const GITHUB_URL = 'https://github.com/RyanJBirkeland/FLEET/releases'
```
Replace with:
```ts
// TODO: update URL when GitHub repo is renamed from FLEET to FLEET
const GITHUB_URL = 'https://github.com/RyanJBirkeland/FLEET/releases'
```

> **Do NOT change the URL itself** — the GitHub repo has not been renamed yet.

- [ ] **Step 2: Verify**

```bash
grep -n "GITHUB_URL" ~/projects/FLEET/src/renderer/src/components/settings/AboutSection.tsx
# Expected: line with TODO comment above the const, URL unchanged
```

> **Note:** `setAppUserModelId('com.fleet')` in `src/main/index.ts` is already handled by the sweep in Task 2 (the `fleet` → `fleet` rule matches the substring `'com.fleet'`). No manual edit needed for that.

- [ ] **Step 3: Commit**

```bash
cd ~/projects/FLEET
git add src/renderer/src/components/settings/AboutSection.tsx
git commit -m "chore: add GitHub URL TODO comment post-sweep"
```

---

### Task 4: SQLite migration — rename repo column values

**Files:**
- Create: `src/main/migrations/v055-rename-fleet-to-fleet-repo-column.ts`
- Create: `src/main/migrations/__tests__/v055.test.ts`

Existing sprint tasks have `repo = 'fleet'`. After the rename the settings will use `repos[].name = 'fleet'`, so all existing rows must be updated.

- [ ] **Step 1: Write the failing test first**

Create `src/main/migrations/__tests__/v055.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { up, version } from '../v055-rename-fleet-to-fleet-repo-column'

describe('migration v055', () => {
  it('has version 55', () => {
    expect(version).toBe(55)
  })

  it('renames repo fleet → fleet and FLEET → fleet', () => {
    const db = new Database(':memory:')
    db.prepare('CREATE TABLE sprint_tasks (id TEXT PRIMARY KEY, repo TEXT)').run()
    db.prepare("INSERT INTO sprint_tasks VALUES ('t1', 'fleet')").run()
    db.prepare("INSERT INTO sprint_tasks VALUES ('t2', 'FLEET')").run()
    db.prepare("INSERT INTO sprint_tasks VALUES ('t3', 'other')").run()

    up(db)

    const rows = db.prepare('SELECT id, repo FROM sprint_tasks ORDER BY id').all() as Array<{id: string; repo: string}>
    expect(rows.find(r => r.id === 't1')!.repo).toBe('fleet')
    expect(rows.find(r => r.id === 't2')!.repo).toBe('fleet')
    expect(rows.find(r => r.id === 't3')!.repo).toBe('other')
    db.close()
  })

  it('is a no-op when no fleet rows exist', () => {
    const db = new Database(':memory:')
    db.prepare('CREATE TABLE sprint_tasks (id TEXT PRIMARY KEY, repo TEXT)').run()
    db.prepare("INSERT INTO sprint_tasks VALUES ('t1', 'fleet')").run()

    up(db)

    const row = db.prepare("SELECT repo FROM sprint_tasks WHERE id = 't1'").get() as {repo: string}
    expect(row.repo).toBe('fleet')
    db.close()
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd ~/projects/FLEET
npx vitest run --config vitest.node.config.ts src/main/migrations/__tests__/v055.test.ts
# Expected: FAIL — module not found
```

- [ ] **Step 3: Create the migration**

Create `src/main/migrations/v055-rename-fleet-to-fleet-repo-column.ts`:

```ts
import type Database from 'better-sqlite3'

export const version = 55
export const description = 'Rename sprint_tasks.repo values from fleet/FLEET to fleet'

export const up: (db: Database.Database) => void = (db) => {
  const sql = `UPDATE sprint_tasks SET repo = 'fleet' WHERE repo IN ('fleet', 'FLEET')`
  db.prepare(sql).run()
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd ~/projects/FLEET
npx vitest run --config vitest.node.config.ts src/main/migrations/__tests__/v055.test.ts
# Expected: 3 tests pass
```

- [ ] **Step 5: Commit**

```bash
cd ~/projects/FLEET
git add src/main/migrations/v055-rename-fleet-to-fleet-repo-column.ts \
        src/main/migrations/__tests__/v055.test.ts
git commit -m "feat(migration): v055 rename sprint_tasks.repo fleet→fleet"
```

---

### Task 5: Runtime directory migration (~/.fleet → ~/.fleet)

**Files:**
- Create: `src/main/startup-migration.ts`
- Modify: `src/main/index.ts` — call migration before any path constants are used

On first launch after the rename, copy `~/.fleet/` to `~/.fleet/` (non-destructive — old dir stays).

- [ ] **Step 1: Create the migration module**

Create `src/main/startup-migration.ts`:

```ts
import { existsSync, mkdirSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { join, homedir } from 'node:path'

const legacyDir = join(homedir(), '.fleet')
const newDir = join(homedir(), '.fleet')

/**
 * On first launch after the FLEET→FLEET rename, copies ~/.fleet to ~/.fleet.
 * Non-destructive — the old directory is left intact for manual cleanup.
 * Safe to call on every launch; no-ops when ~/.fleet already exists.
 */
export async function migrateRuntimeDir(): Promise<void> {
  if (existsSync(newDir)) return
  if (!existsSync(legacyDir)) {
    mkdirSync(newDir, { recursive: true })
    return
  }
  await cp(legacyDir, newDir, { recursive: true })
}
```

- [ ] **Step 2: Wire into src/main/index.ts**

Add the import with the other local imports at the top of `src/main/index.ts`:

```ts
import { migrateRuntimeDir } from './startup-migration'
```

Then find the `app.whenReady().then(` callback. It currently looks like:
```ts
app.whenReady().then(() => {
```
Change it to `async`:
```ts
app.whenReady().then(async () => {
```

Then add `await migrateRuntimeDir()` as the **first statement** inside that callback, before `initDatabaseOrExit()`:

```ts
app.whenReady().then(async () => {
  await migrateRuntimeDir()
  // ... rest of startup (initDatabaseOrExit, etc.)
```

> **Why first?** `createLogger` runs at module-init time (top of file) and cannot be moved. `initDatabaseOrExit()` opens `~/.fleet/fleet.db` — the migration must copy the old data before that happens. The `whenReady` callback is the earliest async point after Electron is ready.

- [ ] **Step 3: Verify typecheck passes**

```bash
cd ~/projects/FLEET
npm run typecheck
# Expected: zero errors
```

- [ ] **Step 4: Commit**

```bash
cd ~/projects/FLEET
git add src/main/startup-migration.ts src/main/index.ts
git commit -m "feat: migrate ~/.fleet to ~/.fleet on first launch after rename"
```

---

### Task 6: Update global CLAUDE.md

**Files:**
- Modify: `~/CLAUDE.md`

The global CLAUDE.md still references `FLEET`, `~/projects/FLEET`, and `~/.fleet`. Apply the same substitutions manually (sed would work, but this file is short enough to do precisely).

- [ ] **Step 1: Run sed sweep on ~/CLAUDE.md**

```bash
sed -i '' \
  -e 's/Agentic Development Environment/Agentic Development Environment/g' \
  -e 's/FLEET/FLEET/g' \
  -e 's/fleet/fleet/g' \
  ~/CLAUDE.md
```

- [ ] **Step 2: Verify**

```bash
grep -n "FLEET\|fleet\|Birkeland\|\.fleet" ~/CLAUDE.md
# Expected: zero matches
```

- [ ] **Step 3: No commit needed** — `~/CLAUDE.md` is not inside the repo. No git action required.

---

### Task 7: Run full verification sweep

Confirm zero stale references across all tracked file types.

- [ ] **Step 1: Run the success-criteria grep**

```bash
cd ~/projects/FLEET
grep -r "FLEET\|fleet\|Birkeland\|\.fleet" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" \
  --include="*.json" --include="*.yml" --include="*.yaml" \
  --include="*.md" --include="*.css" --include="*.html" --include="*.sh" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=out --exclude-dir=release \
  .
```

Expected output: **zero lines**, except:
- One line in `AboutSection.tsx` containing the TODO comment + unchanged GitHub URL
- Any legacy fixture lines with an explicit "legacy" comment

If any unexpected matches appear, fix them and re-run.

- [ ] **Step 2: Run typecheck and tests**

```bash
cd ~/projects/FLEET
npm run typecheck
npm test
npm run test:main
# Expected: all pass
```

- [ ] **Step 3: Commit any remaining fixes found during verification**

```bash
cd ~/projects/FLEET
git add -A
git commit -m "chore: post-rename cleanup — fix remaining FLEET references"
```

---

### Task 8: Rename the project directory and push

This is the final step — it cannot be undone easily, so all previous tasks must be complete and pushed first.

- [ ] **Step 1: Push everything to origin before renaming**

```bash
cd ~/projects/FLEET
git push origin main
```

- [ ] **Step 2: Rename the directory**

```bash
mv ~/projects/FLEET ~/projects/FLEET
```

- [ ] **Step 3: Verify the repo still works from the new path**

```bash
cd ~/projects/FLEET
git status
# Expected: clean working tree
git remote -v
# Expected: origin pointing to RyanJBirkeland/FLEET (or FLEET once GitHub repo is renamed)
```

- [ ] **Step 4: Update CLAUDE.md path reference (if ~/CLAUDE.md was not already updated in Task 6)**

```bash
grep "projects/FLEET\|projects/FLEET" ~/CLAUDE.md
# If any projects/FLEET remain, fix them:
sed -i '' 's|projects/FLEET|projects/FLEET|g' ~/CLAUDE.md
```

- [ ] **Step 5: Final sanity check from the new location**

```bash
cd ~/projects/FLEET
npm run typecheck 2>&1 | tail -3
# Expected: zero errors
```

Done. The app is now FLEET. The old `~/.fleet/` directory remains on disk for manual cleanup. Once the GitHub repo is renamed, update the URL in `src/renderer/src/components/settings/AboutSection.tsx` and remove the TODO comment.
