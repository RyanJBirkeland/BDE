# BDE Clean Code Audit — 2026-04-13

**Goal:** Eliminate god functions, enforce SRP, achieve Gold Standard Clean Code across BDE.

**Git SHA:** `490916caaf44fc2b1f5911ebed911fc1fa8a43a3`
**Timestamp:** 2026-04-13T21:59:42Z

## Lens Index

| ID | Team | Slug | Scope |
|----|------|------|-------|
| T1 | Function Anatomy | `godFunc` | God functions: >40 lines, multiple concerns, too many params |
| T1 | Function Anatomy | `nesting` | Deep nesting, complex conditionals, missing early returns |
| T1 | Function Anatomy | `naming` | Misleading/generic names, boolean traps, poor abstraction naming |
| T2 | Module Cohesion | `fatFiles` | Files >250 lines, multiple responsibilities per file |
| T2 | Module Cohesion | `cohesion` | Files with multiple reasons to change, loose groupings |
| T2 | Module Cohesion | `duplication` | Copy-paste code, near-duplicate logic, missing abstractions |
| T3 | Architecture Boundaries | `layers` | Layer violations, wrong-direction imports, shared leaking impl |
| T3 | Architecture Boundaries | `ipcHandlers` | Fat handler functions, handler/service conflation |
| T4 | Stores & Error Handling | `storeDesign` | Fat Zustand stores, mixed concerns in stores |
| T4 | Stores & Error Handling | `errorPatterns` | Swallowed errors, inconsistent error types, mixed throw/return |

## How to Read Findings

Each finding has ID format: `F-{team}-{lens}-{n}` (e.g. `F-t1-godFunc-3`)

Severity: **Critical** > **High** > **Medium** > **Low**
Effort: **S** (hours) | **M** (day) | **L** (days)

## Files

- `team-1-function-anatomy/lens-godFunc.md`
- `team-1-function-anatomy/lens-nesting.md`
- `team-1-function-anatomy/lens-naming.md`
- `team-2-module-cohesion/lens-fatFiles.md`
- `team-2-module-cohesion/lens-cohesion.md`
- `team-2-module-cohesion/lens-duplication.md`
- `team-3-architecture-boundaries/lens-layers.md`
- `team-3-architecture-boundaries/lens-ipcHandlers.md`
- `team-4-stores-error-handling/lens-storeDesign.md`
- `team-4-stores-error-handling/lens-errorPatterns.md`
- `SYNTHESIS.md` — ranked action roadmap (written after all lenses complete)
