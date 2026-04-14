# Lensed Audit — Agent SDK Prompt Pipeline

**Date:** 2026-04-13  
**Git SHA:** afae37a0b1bd0488e1a7f3a564aecdd91e10525c  
**Timestamp:** 2026-04-14T04:38:42Z  
**Topic:** Prompt composing, injection, and everything sent to the Agent SDK  
**Focus:** Efficiency, redundancy, cost/token optimization, clean architecture, clean code

## Teams & Lenses

### Team 1 — Token Economy
| File | Lens | Scope |
|------|------|-------|
| `team-1-token-economy/lens-tok-size.md` | tok-size | Payload sizes, bloat, static content redundancy |
| `team-1-token-economy/lens-tok-cache.md` | tok-cache | Caching opportunities, dynamic vs stable content, history trimming |

### Team 2 — Architecture & Clean Code
| File | Lens | Scope |
|------|------|-------|
| `team-2-architecture/lens-comp-arch.md` | comp-arch | prompt-composer SRP, abstraction quality, cohesion |
| `team-2-architecture/lens-flow-coupling.md` | flow-coupling | Data flow task→prompt→SDK, coupling, abstraction mixing |
| `team-2-architecture/lens-naming-clarity.md` | naming-clarity | Names, comments, self-documentation |

### Team 3 — SDK Usage Patterns
| File | Lens | Scope |
|------|------|-------|
| `team-3-sdk-usage/lens-sdk-opts.md` | sdk-opts | SDK call options, settingSources, maxTurns, resume |
| `team-3-sdk-usage/lens-sdk-stream.md` | sdk-stream | Streaming consumption, error recovery, consumeMessages |

### Team 4 — Content Injection & Redundancy
| File | Lens | Scope |
|------|------|-------|
| `team-4-injection/lens-inject-content.md` | inject-content | What gets injected per agent type, SDK auto-loads, duplicates |
| `team-4-injection/lens-inject-safety.md` | inject-safety | Prompt injection risks from user-controlled content |

## How to Read Findings

Finding IDs: `F-{team}-{lens}-{n}` (e.g. `F-t1-tok-size-1`)  
Severity: Critical | High | Medium | Low  
Effort: S (< 2h) | M (half-day) | L (multi-day)

See `SYNTHESIS.md` for ranked action roadmap.
