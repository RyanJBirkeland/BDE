# FLEET → FLEET Rename

**Date:** 2026-04-26  
**Status:** Approved

## Overview

Rename the product from "FLEET" (Agentic Development Environment) to "FLEET" (Agentic Development Environment) with full migration — no stale references left behind.

## Scope

- **In scope:** `~/projects/FLEET` repo, `~/CLAUDE.md`
- **Out of scope:** `fleet-site`, `claude-task-runner`, `life-os`, `claude-chat-service`

## Substitution Map

The sed sweep handles all of the below via three case rules. This table makes the coverage explicit.

| From | To | Rule |
|------|----|------|
| `FLEET` | `FLEET` | `FLEET` → `FLEET` |
| `fleet` | `fleet` | `fleet` → `fleet` |
| `Fleet` | `Fleet` | `Fleet` → `Fleet` (PascalCase identifiers) |
| `Agentic Development Environment` | `Agentic Development Environment` | `FLEET` rule covers `FLEET` portion; full phrase replaced first |
| `com.rbtechboy.fleet` | `com.rbtechboy.fleet` | covered by `fleet` rule |
| `FLEET_MEMORY_DIR`, `FLEET_DIR`, `FLEET_DB_PATH`, `FLEET_DATA_DIR`, `FLEET_AGENTS_INDEX`, `FLEET_AGENT_LOGS_DIR`, `FLEET_AGENT_TMP_DIR`, `FLEET_AGENT_LOG_PATH`, `FLEET_TASK_MEMORY_DIR`, `FLEET_CONSOLE_LOG`, `FLEET_TEST_DB` | `FLEET_*` equivalents | covered by `FLEET` rule |
| `FLEET_DEFAULT_PERMISSIONS` | `FLEET_DEFAULT_PERMISSIONS` | covered by `FLEET` rule |
| `fleet-badge`, `fleet-panel` (CSS BEM classes) | `fleet-badge`, `fleet-panel` | covered by `fleet` rule; `.css` and `.tsx` files both in sweep |
| `~/.fleet/` | `~/.fleet/` | covered by `fleet` rule |
| `fleet.db`, `fleet.log` | `fleet.db`, `fleet.log` | covered by `fleet` rule |
| `fleet-agents` (tmpdir subdirectory) | `fleet-agents` | covered by `fleet` rule |
| `fleet:copilot-messages` | `fleet:copilot-messages` (localStorage key) | covered by `fleet` rule |
| MCP server key `"fleet"` | `"fleet"` | covered by `fleet` rule |
| Path `~/projects/FLEET`, `/projects/FLEET` | `~/projects/FLEET`, `/projects/FLEET` | covered by `FLEET` rule |

**Manual-only (cannot be automated):**
- `AboutSection.tsx` — `const GITHUB_URL = 'https://github.com/RyanJBirkeland/FLEET'`: update to reflect the new repo URL once the GitHub repo is renamed. Until then, update the string manually but leave a `// TODO: update when GitHub repo is renamed` comment.

## What Changes

### Config Files
- `package.json`: `name`, `productName`, `description`
- `electron-builder.yml`: `appId`, `productName`, `copyright`, DMG title, app bundle name (`FLEET.app` → `FLEET.app`)

### Docs
- `docs/FLEET_FEATURES.md` → renamed to `docs/FLEET_FEATURES.md`; all content updated
- `CLAUDE.md` (FLEET repo): `@docs/FLEET_FEATURES.md` directive updated; all FLEET references replaced
- `~/CLAUDE.md` (global): all FLEET references, descriptions, and paths updated

### Source Files (automated sed sweep)
All `.ts`, `.tsx`, `.js`, `.mjs`, `.json`, `.yml`, `.yaml`, `.md`, `.css`, `.html`, `.sh` files under `src/`, `scripts/`, `resources/`, `e2e/`, `docs/` — excluding `node_modules`, `.git`, `out/`, `release/`.

### SQLite Data Migration
A new migration (next version number after current last) must update existing task rows:

```sql
UPDATE sprint_tasks SET repo = 'fleet' WHERE repo = 'fleet';
UPDATE sprint_tasks SET repo = 'fleet' WHERE repo = 'FLEET';
```

This ensures existing tasks remain visible after the settings `repos[].name` changes to `'fleet'`. The migration must follow the existing pattern in `src/main/migrations/` with a corresponding test in `src/main/migrations/__tests__/`.

### Runtime Directory Migration
On first launch after the rename the app copies `~/.fleet/` → `~/.fleet/` and then uses `~/.fleet/` for all subsequent reads and writes. The old `~/.fleet/` directory is left in place (users can delete it manually). This is implemented as a startup check before any path constants are used.

### Directory Rename
`~/projects/FLEET` → `~/projects/FLEET` — performed last, after all file edits are committed.

## Approach

**Automated find-and-replace + targeted manual fixes + directory rename:**

1. Rename `docs/FLEET_FEATURES.md` → `docs/FLEET_FEATURES.md`; update the `@` directive in the repo's `CLAUDE.md`
2. Run sed sweep across all text file types (see file type list above), applying substitutions longest-first to avoid partial matches:
   - `Agentic Development Environment` → `Agentic Development Environment`
   - `FLEET` → `FLEET`
   - `fleet` → `fleet`
   - `Fleet` → `Fleet`
3. Manually update `AboutSection.tsx` GitHub URL with a TODO comment
4. Add SQLite migration file + test
5. Add runtime directory migration logic on app startup
6. Update `~/CLAUDE.md` (global) separately
7. Commit all changes, then `mv ~/projects/FLEET ~/projects/FLEET`
8. Verify with a final grep sweep (see success criteria)

## Success Criteria

The following returns zero results after the rename (note: no trailing slash on `\.fleet` to catch all variants):

```bash
grep -r "FLEET\|fleet\|Birkeland\|\.fleet" ~/projects/FLEET \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" \
  --include="*.json" --include="*.yml" --include="*.yaml" \
  --include="*.md" --include="*.css" --include="*.html" --include="*.sh" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=out --exclude-dir=release
```

Expected exceptions (allowlist — these are intentional and must not match):
- The GitHub URL TODO comment in `AboutSection.tsx`
- Any test fixture that references the old name with an explicit comment explaining it's a legacy fixture

Additional checks:
- `~/CLAUDE.md` contains no remaining `FLEET` or `~/.fleet` references
- `npm run build` passes; app launches with title "FLEET"
- Existing sprint tasks are visible after rename (SQLite `repo` column migrated to `'fleet'`)
- `~/.fleet/` directory contains migrated data on first launch
