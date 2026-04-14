# BDE Lensed Audit — Architecture · Security · Reliability

**Date:** 2026-04-13  
**Git SHA:** b7e731957f68e50b0258dc9a50a310ec877f720d  
**Timestamp:** 2026-04-14T02:06:53Z  

## Teams & Lenses

### Team 1 — Architecture
| File | Lens | Scope |
|------|------|-------|
| `team-1-architecture/lens-boundaries.md` | Process Boundaries (`boundaries`) | IPC surface sprawl, preload bridge discipline, renderer↔main coupling |
| `team-1-architecture/lens-cohesion.md` | Module Cohesion (`cohesion`) | God files, SRP violations, oversized modules |
| `team-1-architecture/lens-coupling.md` | Abstraction Coupling (`coupling`) | Bypassed abstractions, circular deps, leaking internals |

### Team 2 — Security
| File | Lens | Scope |
|------|------|-------|
| `team-2-security/lens-injection.md` | Injection Risks (`injection`) | Shell injection, path traversal, unvalidated file paths |
| `team-2-security/lens-ipc-trust.md` | IPC Trust Boundary (`ipc-trust`) | Missing safeHandle wrappers, unvalidated renderer-supplied data |
| `team-2-security/lens-csp-sandbox.md` | Sandbox & CSP (`csp-sandbox`) | Electron CSP headers, iframe sandbox, DOMPurify gaps |

### Team 3 — Reliability
| File | Lens | Scope |
|------|------|-------|
| `team-3-reliability/lens-errors.md` | Error Handling (`errors`) | Swallowed errors, unhandled rejections, missing error boundaries |
| `team-3-reliability/lens-lifecycle.md` | Agent Lifecycle (`lifecycle`) | Watchdog gaps, worktree cleanup races, retry edge cases |
| `team-3-reliability/lens-statesync.md` | State Synchronization (`statesync`) | Optimistic update conflicts, polling races, stale state |

## How to Read Findings

Finding IDs: `F-{team}-{lens}-{n}` (e.g. `F-t1-boundaries-1`)

Severity: **Critical** | **High** | **Medium** | **Low**  
Effort: **S** (small) | **M** (medium) | **L** (large)  
Score: `(Severity × Confidence) / Effort` — used for synthesis ranking

See `SYNTHESIS.md` for ranked actions after all lenses complete.
