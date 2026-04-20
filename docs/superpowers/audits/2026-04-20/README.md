# Audit 2026-04-20 — install-readiness pass

Pre-install audit across install-critical surfaces of BDE: main entry, bootstrap,
DB + 25 migrations, auth-guard, onboarding, settings (incl. uncommitted),
agent spawning, MCP server, plus `package.json` and `electron-builder.yml`.
~60 files audited across six lenses (clean-code, architecture, security,
performance, testing, type-safety).

Full findings: 4 P0 · 19 P1 · 19 P2 · 17 P3 (73 tasks total after cross-lens dedup).
Only P0 + P1 are queued into the pipeline from this audit — 23 tasks across six epics.
P2/P3 remain in the audit report for follow-up.

## Epics

1. **epic-1-install-path** — uncommitted `index.ts` cleanup and `MAX_TURNS` resolution (6 tasks: T-1, T-21, T-22, T-23, T-24, T-25)
2. **epic-2-mcp-server** — DNS rebinding protection, `cancelTask` service extraction, schema/type reconciliation, atomic `setDependencies`, integration-test rigor (6 tasks: T-33, T-37, T-40, T-41, T-43, T-45)
3. **epic-3-composition-di** — relocate `settings-events`, lift `EpicGroupService` to the composition root (2 tasks: T-18, T-19)
4. **epic-4-migration-hygiene** — replace `'Add '` placeholder descriptions in v017 and v020; per-migration test policy starting with v038 (3 tasks: T-29, T-31, T-32)
5. **epic-5-agent-auth-safety** — unify worktree base path, preserve typed rows from `getQueuedTasks`, validate keychain payload (3 tasks: T-4, T-5, T-8)
6. **epic-6-first-launch-tests** — test coverage for `LocalMcpServerSection`, onboarding steps (Welcome/Git/Repo), and `SAMPLE_FIRST_TASK` readiness (3 tasks: T-50, T-62, T-63)

## How these were queued

Specs live under this directory for audit trail. Tasks were queued via the local
MCP server (`tasks.create`) with `group_id` wiring to the epic records created by
`epics.create`. All tasks entered the pipeline with `status='queued'` and were
picked up by the agent manager drain loop.
