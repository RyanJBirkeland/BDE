# BDE Packaging & Handoff Readiness Audit

**Date:** 2026-04-16
**Git SHA:** 8254204b9a294a38848875bb98a10e344c13dccf (main)
**Branch:** audit/packaging-handoff-2026-04-16
**Audit target:** The packaged .dmg installed on a fresh Mac with no prior BDE setup.

## Scope

What breaks when a user downloads BDE-*.dmg, installs it on a clean macOS box, and launches it for the first time. Not the dev repo clone — the packaged app.

## Out of Scope (already fixed)

- Work-machine dev setup: proxy env vars, CLI detection via `which`, `gh auth status`, single-instance lock, .nvmrc, Xcode CLT preflight (PRs #685, #686 merged)
- Stale IDE path recovery on new machine (fs.stat validation in `useIDEStateRestoration`)
- Repo path validation at startup with warning toast
- Plaintext credential re-encryption at startup
- Agent event output cap (50K chars)

## Teams & Lenses

### Team 1: Build & Package Integrity

- **L1.1 `builder`** — electron-builder.yml config, ASAR inclusion/exclusion, entitlements, icon/plist, `identity: null`
- **L1.2 `native`** — better-sqlite3 + node-pty rebuild, postinstall, ABI targeting, afterPack hooks
- **L1.3 `asar-paths`** — `__dirname`/`is.dev` in ASAR, resource loading, preload path resolution

### Team 2: First-Launch Experience

- **L2.1 `onboarding`** — `Onboarding.tsx` + `components/onboarding/` correctness, preflight UX
- **L2.2 `bootstrap`** — `bootstrap.ts` + `db.ts` first-run init, migration v1, startup ordering, failure paths
- **L2.3 `gatekeeper`** — macOS unsigned UX, quarantine xattr, right-click-open, permission prompts

### Team 3: Runtime Integrity

- **L3.1 `ipc-surface`** — preload/handler coverage, channel drift, `safeHandle` audit
- **L3.2 `prod-paths`** — localhost/dev URLs, CSP in prod, `is.dev`-gated required features
- **L3.3 `credentials`** — OAuth token on fresh machine, `safeStorage` readiness, `claude login` surfacing

## Reading Findings

Each lens writes to `lens-{slug}.md` in its team folder. Finding IDs are globally unique: `F-{team}-{lens}-{n}`.

Synthesis in `SYNTHESIS.md` (written after all lens agents complete) ranks findings by `(Severity x Confidence) / Effort`.

## Finding Format

```
## F-{team}-{lens}-{n}: {short title}
**Severity:** Critical | High | Medium | Low
**Category:** {category}
**Location:** `path/to/file.ts:lines`
**Evidence:** {observation}
**Impact:** {why it matters}
**Recommendation:** {concrete fix}
**Effort:** S | M | L
**Confidence:** High | Medium | Low
```
