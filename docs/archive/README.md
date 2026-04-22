# Archive

Historical documentation that no longer describes current state but is retained for reference.

## Contents

- `AGENT_REPORT-2026-04-05.md` — one-off pipeline agent report from a specific run; not living documentation
- `AUDIT_FIXES_SUMMARY-2026-03-29.md` — snapshot of a completed audit-fix branch
- `specs/` — shipped, abandoned, or superseded specs (each carries a `> **Status: ...**` banner explaining its state and why)

## What lives where

| Doc category | Location |
|---|---|
| Completed/abandoned specs | `docs/archive/specs/` |
| Dated audits | `docs/audits/YYYY-MM-DD-<name>.md` |
| Dated evals (point-in-time investigations) | `docs/evals/YYYY-MM-DD-<name>.md` |
| Dogfooding session reports | `docs/dogfooding/YYYY-MM-DD-<name>.md` |
| Agent-authored session snapshots | `docs/archive/` |

Live documentation — feature reference, module docs, security posture, network requirements, release notes — stays in `docs/` (top level and `docs/modules/`).
