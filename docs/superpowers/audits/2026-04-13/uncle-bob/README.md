# Uncle Bob Clean Code & Architecture Audit

**Date:** 2026-04-13  
**Git SHA:** 0d5bc3bb5f7db59171158e2e8eba6cfce6224195  
**Scope:** Full BDE codebase (`src/main/`, `src/renderer/src/`, `src/shared/`, `src/preload/`)  
**Goal:** Assess BDE against Uncle Bob's Clean Code + Clean Architecture principles. Gold-standard target.

## Teams & Lenses

### Team 1: Clean Code Fundamentals (`team-1-clean-code/`)
| File | Lens | Scope |
|------|------|-------|
| `lens-naming.md` | Naming & Clarity | Intention-revealing names, magic numbers, disinformation |
| `lens-funcs.md` | Function Design | Do one thing, abstraction levels, CQS, arg lists |
| `lens-comments.md` | Comments & Dead Code | Noise comments, dead code, misleading docs |

### Team 2: Clean Architecture — Boundaries & Dependencies (`team-2-boundaries/`)
| File | Lens | Scope |
|------|------|-------|
| `lens-deprule.md` | Dependency Rule | Outer→inner violations, plugin rule, flow of control |
| `lens-bounds.md` | Boundary Integrity | IPC surface discipline, preload bridge width |
| `lens-abstracts.md` | Abstractions & Ports | Repository gaps, interface vs concrete coupling |

### Team 3: SOLID Principles (`team-3-solid/`)
| File | Lens | Scope |
|------|------|-------|
| `lens-srp.md` | SRP Violations | God classes, fat modules, mixed responsibilities |
| `lens-ocplsp.md` | OCP + LSP | Hardcoded switches, substitutability, extension points |
| `lens-ispdip.md` | ISP + DIP | Fat interfaces, high-level→low-level concrete coupling |

### Team 4: Error Handling & Test Quality (`team-4-errors-tests/`)
| File | Lens | Scope |
|------|------|-------|
| `lens-errors.md` | Error Handling | Null returns, swallowing, exception vs error-code patterns |
| `lens-smells.md` | DRY & Code Smells | Duplication, feature envy, data clumps, long param lists |
| `lens-tests.md` | Test Quality | F.I.R.S.T, isolation, AAA structure, tests as docs |

## How to Read Findings

Each finding has a globally unique ID: `F-{team}-{lens}-{n}`  
Severity: Critical > High > Medium > Low  
Effort: S (hours) | M (days) | L (weeks)  

See `SYNTHESIS.md` for ranked action roadmap and letter grade.
