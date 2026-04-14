# BDE Full Codebase Lensed Audit

**Date:** 2026-04-14T16:05:29Z
**Git SHA:** e88a99ce5fa8da1baea103f8b053d501813f6c4d
**Scope:** Full BDE codebase

## Teams & Lenses

### Team 1 — Architecture & Clean Code
| File | Lens | Slug | Scope |
|------|------|------|-------|
| `team-1-architecture/lens-arch.md` | Dependency Rule Auditor | `arch` | Clean Architecture violations, handler bloat, service layer bypass |
| `team-1-architecture/lens-clean.md` | Clean Code Inspector | `clean` | Function SRP, naming, magic numbers, abstraction levels |
| `team-1-architecture/lens-ipc.md` | IPC Surface Auditor | `ipc` | IPC channel design, preload API surface, handler registration |

### Team 2 — Security
| File | Lens | Slug | Scope |
|------|------|------|-------|
| `team-2-security/lens-inject.md` | Injection Hunter | `inject` | Shell injection, path traversal, exec patterns |
| `team-2-security/lens-sandbox.md` | Sandbox Inspector | `sandbox` | DOMPurify, CSP, playground iframe security |
| `team-2-security/lens-oauth.md` | Credential Auditor | `oauth` | OAuth token handling, auth bypass, credential exposure |

### Team 3 — Performance & Reliability
| File | Lens | Slug | Scope |
|------|------|------|-------|
| `team-3-performance/lens-perf.md` | Frontend Performance | `perf` | Polling, Zustand subscriptions, re-renders, memory leaks |
| `team-3-performance/lens-sqlite.md` | SQLite & Data Layer | `sqlite` | Query patterns, indices, migration safety, WAL mode |

### Team 4 — Agent System & Testing
| File | Lens | Slug | Scope |
|------|------|------|-------|
| `team-4-agent-testing/lens-agent.md` | Agent Lifecycle Auditor | `agent` | Watchdog, worktree cleanup, retry logic, drain loop races |
| `team-4-agent-testing/lens-test.md` | Test Quality Inspector | `test` | Coverage gaps, mock brittleness, behavior vs implementation |

## Finding ID Format

`F-{team}-{slug}-{n}` — e.g. `F-t1-arch-1`, `F-t2-inject-3`

## How to Read

1. Start with `SYNTHESIS.md` for ranked actions and themes
2. Drill into individual lens files for full evidence and recommendations
3. Finding severity: Critical > High > Medium > Low
4. Scoring: `(Severity × Confidence) / Effort` — higher = act sooner
