# God Module Audit — 2026-04-13

**Git SHA:** deaf2413e18ef4dc92cd44e2a486c748ae7cef21  
**Timestamp:** 2026-04-13  
**Scope:** src/main/, src/renderer/src/, src/shared/, src/preload/

## Teams & Lenses

### Team 1 — Main Process
| Lens | Slug | File |
|------|------|------|
| Agent Manager Surgeon | `amgr` | team-1-main/lens-amgr.md |
| Handler Registry Inspector | `hdlr` | team-1-main/lens-hdlr.md |
| Data Layer Critic | `data` | team-1-main/lens-data.md |

### Team 2 — Renderer
| Lens | Slug | File |
|------|------|------|
| Store Cohesion Analyst | `stor` | team-2-renderer/lens-stor.md |
| Component Responsibility Auditor | `comp` | team-2-renderer/lens-comp.md |
| Hook & Utility Sprawl Detector | `hook` | team-2-renderer/lens-hook.md |

### Team 3 — Shared / Cross-Cutting
| Lens | Slug | File |
|------|------|------|
| Type System Auditor | `type` | team-3-shared/lens-type.md |
| Preload Surface Inspector | `pre` | team-3-shared/lens-pre.md |

## How to Read Findings

Finding IDs: `F-{team}-{lens}-{n}` (e.g. F-t1-amgr-1)  
Severity: Critical > High > Medium > Low  
Effort: S=small, M=medium, L=large  
Score formula: (Severity × Confidence) / Effort (higher = more urgent)
