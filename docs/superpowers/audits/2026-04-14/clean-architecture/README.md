# Clean Architecture & Code Principles Audit

**Date:** 2026-04-14T21:25:17Z
**Git SHA:** a5f67d828d61caf4f8bb8bddfa6b796e546a9bf6
**Codebase:** BDE (Birkeland Development Environment)
**Topic:** Clean Architecture & Clean Code Principles (Uncle Bob)

## Teams & Lenses

### Team 1 — Architecture Boundaries (`team-1-architecture-boundaries/`)
| File | Slug | Scope |
|------|------|-------|
| `lens-dep-rule.md` | `dep-rule` | Dependency Rule violations — import direction, layer pollution |
| `lens-ipc-thin.md` | `ipc-thin` | IPC handler thinness — business logic leaking into handlers |
| `lens-proc-bound.md` | `proc-bound` | Process boundary separation — main/preload/renderer/shared |

### Team 2 — Clean Code: Function & Naming Quality (`team-2-clean-code/`)
| File | Slug | Scope |
|------|------|-------|
| `lens-srp.md` | `srp` | Single Responsibility — functions/classes doing more than one thing |
| `lens-naming.md` | `naming` | Vocabulary — abbreviations, misleading names, wrong abstractions |
| `lens-complexity.md` | `complexity` | Complexity — long functions, nesting, magic numbers, stepdown rule |

### Team 3 — Module & Component Design (`team-3-module-component-design/`)
| File | Slug | Scope |
|------|------|-------|
| `lens-cohesion.md` | `cohesion` | Module cohesion — files >500 LOC, multiple subjects, barrel abuse |
| `lens-react-comp.md` | `react-comp` | React component quality — size, business logic, decomposition |
| `lens-stores.md` | `stores` | Zustand store design — domain violations, computed-as-state, coupling |

## Synthesis

See `SYNTHESIS.md` for ranked action roadmap.

## Finding ID Convention

`F-{team}-{lens}-{n}` — e.g. `F-t1-dep-rule-1`
- Teams: `t1`, `t2`, `t3`
- Lenses: see slug column above
- `n`: monotonic per lens

## Scoring Formula

`Score = (Severity × Confidence) / Effort`
- Severity: Critical=4, High=3, Medium=2, Low=1
- Confidence: High=3, Medium=2, Low=1
- Effort: S=1, M=2, L=4
