# LCHC Audit — Low Coupling / High Cohesion
**Date:** 2026-04-13  
**Git SHA:** 727ccc1ea91a2e795ee55f6ee0a56f69b9a9592b  
**Timestamp:** 2026-04-14T05:26:22Z  
**Theme:** Every finding measured against one standard — does this increase or decrease coupling/cohesion?

## Active Work (Baseline Exclusions)
The following areas are actively being refactored at audit time and should not be re-reported:
- `src/main/agent-manager/sdk-adapter.ts` — adhoc agent SDK options (settingSources, maxBudgetUsd, maxTurns) being fixed
- `src/main/agent-manager/adhoc-agent.ts` — same work in progress
- `src/main/services/review-service.ts` — settingSources fix pending (blocked)
- `src/main/services/prescriptiveness-validator.ts` — settingSources fix pending (blocked)

## Teams & Lenses

### Team 1 — Coupling in Main Process
| File | Lens | Slug |
|------|------|------|
| `team-1-main-coupling/lens-hub.md` | Hub Modules & Fan-In | `hub` |
| `team-1-main-coupling/lens-depdir.md` | Dependency Direction | `depdir` |
| `team-1-main-coupling/lens-ipc-coupling.md` | IPC Channel Proliferation | `ipc-coupling` |

### Team 2 — Cohesion in Main Process
| File | Lens | Slug |
|------|------|------|
| `team-2-main-cohesion/lens-handler-coh.md` | Handler Cohesion | `handler-coh` |
| `team-2-main-cohesion/lens-agent-coh.md` | Agent Manager Cohesion | `agent-coh` |
| `team-2-main-cohesion/lens-svc-coh.md` | Service Layer Cohesion | `svc-coh` |

### Team 3 — Coupling in Renderer
| File | Lens | Slug |
|------|------|------|
| `team-3-renderer-coupling/lens-store-coupling.md` | Store-to-Store Coupling | `store-coupling` |
| `team-3-renderer-coupling/lens-comp-coupling.md` | Component Fan-Out | `comp-coupling` |

### Team 4 — Cohesion in Renderer & Shared
| File | Lens | Slug |
|------|------|------|
| `team-4-renderer-shared-cohesion/lens-store-coh.md` | Store Cohesion | `store-coh` |
| `team-4-renderer-shared-cohesion/lens-shared-coh.md` | Shared Module Integrity | `shared-coh` |

## How to Read Findings
Each finding is tagged `F-{team}-{lens}-{n}` for global uniqueness.  
SYNTHESIS.md contains ranked actions, cross-cutting themes, and quick wins.
