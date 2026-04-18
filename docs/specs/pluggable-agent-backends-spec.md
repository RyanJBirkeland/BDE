# Pluggable Agent Backends — Design Proposal

**Status:** Draft / RFC
**Author:** Ryan Birkeland (with Claude)
**Date:** 2026-04-16
**Scope:** Architecture change, main process, phased

---

## 1. Problem

BDE hardcodes Claude Code (via `@anthropic-ai/claude-agent-sdk`) as the sole execution engine for all five agent types: Pipeline, Synthesizer, Copilot, Assistant, Adhoc. This is the right default — Claude Code is the strongest agent in the market — but it's also architecturally limiting:

- **Cost.** Pipeline is the highest-volume agent by a wide margin; every Pipeline run pays Anthropic prices, regardless of task complexity.
- **Lock-in.** A single-backend architecture prevents experimentation with local models, alternative frameworks (Aider, OpenHands), or future competitors.
- **Privacy.** Users who want bulk code work to stay on-machine have no path today.
- **Uniform cognition.** A 200-word "rename this function" task gets the same reasoning engine as "draft a refactor spec for the review queue." That's overkill on the low end.

The cognitive requirements of the five agent types are not uniform. Reasoning-heavy agents (Synthesizer, Copilot, Assistant, Adhoc) genuinely need frontier-model quality. The Pipeline agent — working from a tight, Synthesizer-authored spec with explicit file paths and test commands — is closer to a high-leverage edit loop than an autonomous planner.

## 2. Proposal

Introduce a **pluggable agent backend system** so each of BDE's five agent types can be routed to a different execution engine, selected by the user via settings. Default behavior is unchanged: all five types route to Claude Code.

The core idea is "Claude plans, local executes":

- Reasoning agents (Synthesizer, Copilot, Assistant, Adhoc) stay on Claude Code indefinitely — or until open-source reasoning closes the gap.
- The Pipeline agent becomes optionally routable to a local backend (LM Studio + MCP tools, or Aider as a subprocess).
- Quality of local Pipeline execution depends on Synthesizer-authored spec quality, which Claude continues to own. This is a deliberate coupling: the better Claude's specs get, the more local Pipeline becomes viable.

## 3. Non-Goals

- **Not** replacing Claude Code wholesale. Claude Code remains the default and the only path to feature parity.
- **Not** building a new local agent framework from scratch. Backends wrap existing, battle-tested runtimes.
- **Not** changing BDE's external behavior, UX, or data model. All new functionality is opt-in.
- **Not** introducing framework dependencies that leak into business logic. Backends live at the edge of the architecture.

## 4. Architectural Seam

BDE is already well-positioned for this change. The entire agent execution surface funnels through one file:

- `src/main/agent-manager/sdk-adapter.ts` — `spawnAgent()` is the single chokepoint.
- `src/main/agent-manager/types.ts:64` — `AgentHandle` is the abstraction the rest of the system depends on.
- `src/main/agent-manager/sdk-message-protocol.ts:12` — `SDKWireMessage` is the wire protocol consumed by the event mapper, cost tracker, watchdog, and playground detector.

Everything downstream (drain loop, watchdog, completion flow, worktree cleanup, cost tracking, event streaming, playground rendering) works against these two abstractions. **No business logic knows about Anthropic.** The Dependency Inversion work is already done.

This proposal adds a thin selection layer in front of `spawnAgent()`. It does not alter any other module.

## 5. Design

### 5.1 The `AgentBackend` Interface

A new interface, colocated with the existing agent types:

```ts
// src/main/agent-manager/backends/agent-backend.ts

export interface SpawnBackendOptions {
  prompt: string
  cwd: string
  model: string
  maxBudgetUsd?: number
  agentType: AgentType
  logger: Logger
}

export interface AgentBackend {
  readonly id: string                       // "claude-code" | "local-mcp" | "aider"
  readonly displayName: string              // for Settings UI
  readonly supportedAgentTypes: AgentType[] // e.g. aider → ['pipeline'] only
  spawn(opts: SpawnBackendOptions): Promise<AgentHandle>
  healthCheck(): Promise<BackendHealth>     // used by Settings UI to show status
}

export interface BackendHealth {
  ok: boolean
  message: string                           // "LM Studio reachable at localhost:1234"
}
```

**Contract requirement:** every backend must produce an `AgentHandle` whose `messages` iterable emits objects matching `SDKWireMessage` for the five message shapes BDE consumes today (`system`, `assistant`, `user`/`tool_result`, `result`, error frames). Backends that don't speak this protocol natively (Aider, local tool-use loops) implement a translation layer internally — that translation is the backend's problem, not BDE's.

### 5.2 Backend Registry

```ts
// src/main/agent-manager/backends/backend-registry.ts

export function registerBackend(backend: AgentBackend): void
export function resolveBackend(agentType: AgentType): AgentBackend
export function listBackends(): AgentBackend[]
```

Resolution order:
1. User-configured backend for the given `agentType` from settings.
2. Fall back to `claude-code` backend if the configured backend doesn't support the agent type (e.g. Aider selected for Synthesizer).
3. Fall back to `claude-code` backend if health check fails at spawn time (with a warning event surfaced to the UI).

### 5.3 Settings Schema

New setting key: `agentBackends` (JSON, stored in `settings` table):

```ts
interface AgentBackendsSetting {
  pipeline:    BackendId
  synthesizer: BackendId
  copilot:     BackendId
  assistant:   BackendId
  adhoc:       BackendId
  localMcp?: {
    baseUrl: string      // "http://localhost:1234/v1"
    model: string        // "qwen2.5-coder-32b-instruct"
  }
  aider?: {
    executablePath: string  // resolved from PATH by default
    model: string           // passed as --model
  }
}

type BackendId = 'claude-code' | 'local-mcp' | 'aider'

const DEFAULT_BACKENDS: AgentBackendsSetting = {
  pipeline:    'claude-code',
  synthesizer: 'claude-code',
  copilot:     'claude-code',
  assistant:   'claude-code',
  adhoc:       'claude-code'
}
```

### 5.4 Settings UI

New tab: **Settings → Agent Backends**. Adds a tenth settings tab.

Layout (three sections):

1. **Per-agent routing.** Five dropdowns (Pipeline, Synthesizer, Copilot, Assistant, Adhoc). Each dropdown is populated from `listBackends()`, filtered to backends whose `supportedAgentTypes` includes that agent type. Default `claude-code` for all.

2. **Local MCP backend configuration.** Base URL, model name, live connection indicator (green/red dot polling `healthCheck()` every 10s). Disabled/greyed until any agent type is routed to `local-mcp`.

3. **Aider backend configuration.** Executable path, model name, version detection. Disabled/greyed until any agent type is routed to `aider`.

Above all of this, a persistent warning banner when any non-Claude backend is selected: *"Non-default backends are experimental. Task quality may degrade. See docs/specs/pluggable-agent-backends-spec.md."*

### 5.5 Refactor `sdk-adapter.ts`

Current (simplified):

```ts
export async function spawnAgent(opts) {
  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk')
    return spawnViaSdk(sdk, opts, env, token, logger)
  } catch { /* fall through */ }
  return spawnViaCli(opts, env, token, logger)
}
```

After:

```ts
export async function spawnAgent(opts: SpawnBackendOptions) {
  const backend = resolveBackend(opts.agentType)
  return backend.spawn(opts)
}
```

The existing Claude-SDK-and-CLI logic moves into `ClaudeCodeBackend.spawn()` unchanged. No behavior change in this step. All existing tests continue to pass.

### 5.6 Callers that need `agentType`

Callers of `spawnAgent` / `spawnWithTimeout` currently pass `(prompt, cwd, model, logger, maxBudgetUsd)`. They will need to pass `agentType` as well. Known call sites (incomplete list — full audit in implementation phase):

- `src/main/agent-manager/run-agent.ts` → `'pipeline'`
- `src/main/handlers/adhoc-agent.ts` → `'adhoc'` / `'assistant'` (depending on mode)
- `src/main/handlers/workbench-*.ts` (copilot streaming, synthesizer) → `'copilot'` / `'synthesizer'`

This is a mechanical change. All call sites already know their agent type — they currently select it via prompt composition (`prompt-composer.ts`).

## 6. Backend Implementations (Phased)

### 6.1 Phase 1 — `ClaudeCodeBackend` (refactor only)

Extract existing logic from `sdk-adapter.ts`, `spawn-sdk.ts`, `spawn-cli.ts` into `backends/claude-code-backend.ts`. Register as the only backend. All five agent types route to it.

**Acceptance:** all existing tests pass; no behavior change; `AgentBackend` interface is exercised by a real implementation.

### 6.2 Phase 2 — `AiderBackend` (pipeline-only)

Wrap Aider as a subprocess backend for the Pipeline agent only. `supportedAgentTypes = ['pipeline']`.

- Spawn `aider --model <config.model> --yes --message <prompt>` in the worktree.
- Parse Aider's stream (line-oriented) into `SDKWireMessage`-shaped events.
- Emit a synthetic `system` message on start with a generated `session_id`.
- Emit `assistant` messages for each of Aider's reasoning turns.
- Emit `tool_use` / `tool_result` pairs for each file edit (translating Aider's diff output).
- Emit `result` with `exit_code` on termination. Cost is `0.0` (local).

**Why Aider first:** it's the most reliable open-source coder with local models today, it's explicitly designed for the edit-loop pattern Pipeline tasks fit, and it already knows how to work in a git worktree. The translation layer is mostly output parsing — no custom tool-use loop to build.

**Acceptance:** a Pipeline task with a well-formed spec (explicit file paths + `## How to Test`) completes successfully using Aider + a local model, producing commits visible in Code Review Station.

### 6.3 Phase 3 — `LocalMcpBackend` (pipeline-only, initially)

Native backend built on MCP + an OpenAI-compatible client pointed at LM Studio. `supportedAgentTypes = ['pipeline']` initially; `['pipeline', 'adhoc', 'assistant']` once proven.

Architecture:

- OpenAI-compatible HTTP client (LM Studio exposes `/v1/chat/completions`).
- Tool use loop: read file, write file, bash, edit — exposed as MCP servers.
- Translation layer: `OpenAIChatMessage` ↔ `SDKWireMessage`.
- Session management: in-memory (local models don't have Claude's built-in session resumption — document this limitation).

**Why native MCP later:** it's the right long-term architecture (matches how Claude Code works internally and aligns with the industry-standard tool protocol), but it's more work than wrapping Aider. Ship Aider first for working end-to-end local execution; build `LocalMcpBackend` once the seam is proven.

**Acceptance:** same as Phase 2, plus support for the richer session types once stable.

### 6.4 Phase 4 — Reasoning-agent local support (deferred)

Only revisit once local models (Qwen 3, Llama 4, DeepSeek V3 or successors) demonstrably close the gap on structured spec authoring. Expected timeframe: 6–12 months. Gate this phase behind explicit user opt-in and strong warning copy.

## 7. Cost & Telemetry Implications

- `cost_events` table entries from non-Claude backends should record `cost_usd = 0` and `model` = the configured local model name (e.g. `local:qwen2.5-coder-32b`). This keeps the dashboard honest: the cost chart visibly shows which agent runs were free.
- A new derived metric ("% of runs on local backends") becomes interesting for the Dashboard. Not required for initial ship.
- `agent_runs.executor_id` remains `bde-embedded`. No schema change needed — the backend identity is implicit in the model string.

## 8. Failure Modes & Mitigations

| Failure | Mitigation |
|---|---|
| LM Studio not running when Pipeline spawns local | `healthCheck()` at spawn time; fall back to Claude with a UI warning event |
| Local model produces malformed tool calls | Translation layer validates; backend emits `is_error: true` tool_result so the existing retry/watchdog path handles it |
| Aider process hangs | Existing watchdog (`WATCHDOG_INTERVAL_MS = 10_000`, `maxRuntimeMs = 1h`) applies to all backends uniformly — kill via `AgentHandle.abort()` |
| Local model quality regressions land silently | Per-backend success-rate metric on Dashboard; alert on sharp drops |
| User selects `aider` for Synthesizer | Backend registry rejects at resolve time (`supportedAgentTypes` check) and falls back to `claude-code` with a toast |
| Bug in translation layer corrupts event stream | Contract tests: snapshot of each `SDKWireMessage` shape the existing Claude backend emits; new backends must produce byte-compatible equivalents for the same operations |

## 9. Testing Strategy

- **Unit tests per backend.** Each backend gets its own test suite. Mock the underlying runtime (SDK, Aider subprocess, LM Studio HTTP).
- **Contract conformance tests.** A shared test fixture verifies every registered backend emits `SDKWireMessage`-shaped events for a canonical "read a file, write a file, exit" scenario.
- **Integration tests against real local models.** Optional, opt-in (env var `BDE_TEST_LOCAL=1`). Skipped in CI by default — local-backend tests need a running LM Studio.
- **Existing test coverage is preserved.** Phase 1 is a pure refactor and must not change any assertion.

## 10. Risks

- **Quality regression on local Pipeline runs.** Mitigated by: opt-in, warning copy, per-backend success-rate tracking, fast fallback path to Claude via Request Revision.
- **Scope creep.** "Just one more backend" is the killer of modular systems. Policy: each backend requires its own ADR and a demonstrated user need. No speculative backends.
- **Protocol drift.** If Claude Code's `SDKWireMessage` shape evolves, every backend's translation layer must keep up. Mitigated by contract tests and by keeping the `SDKWireMessage` interface in one file (`sdk-message-protocol.ts`).
- **Synthesizer quality is load-bearing.** Local Pipeline viability depends on spec quality. If Synthesizer regresses, local Pipeline will regress harder. Invest in Synthesizer evals before shipping Phase 2 widely.
- **User confusion.** "Why is this task slow / failing?" becomes ambiguous with multiple backends. Mitigated by: clear per-run backend labeling in the Agents view and Code Review Station; backend identity included in agent events.

## 11. Open Questions

1. Should the backend selection be per-task override (task row has a `backend_override` column) or strictly per-agent-type? **Recommendation:** per-agent-type only for v1. Per-task adds UX complexity without clear demand. Revisit if users ask.
2. How should Copilot streaming work if/when routed to local? Copilot uses `workbench:chatStream` IPC — the backend interface needs a streaming variant. **Recommendation:** defer. Copilot stays on Claude for the foreseeable future.
3. Should we expose a plugin API so third parties can register backends? **Recommendation:** no, not for v1. Built-in backends only. Plugin API is a much larger scope and a separate proposal.
4. Should the MCP tool set be user-configurable (add/remove tools per backend)? **Recommendation:** no, not for v1. Ship with a fixed BDE-curated tool set mirroring Claude Code's defaults (Read, Write, Edit, Bash). Configurability is a follow-up.

## 12. Success Criteria

- Phase 1 merged with zero behavior change; all existing tests pass; code quality matches BDE standards (Clean Code + Clean Architecture).
- Phase 2 ships a working Aider backend that can complete a canonical Pipeline task against a local model (e.g. Qwen 2.5-Coder 32B in LM Studio) and have the result appear in Code Review Station indistinguishable from a Claude run.
- Documented quality expectations: user-facing copy explains when local is appropriate (well-scoped edits, doc updates, scaffolding) and when it isn't (exploratory refactors, debugging, cross-file reasoning).
- Cost dashboard accurately reflects local runs as `$0`.
- Zero regressions in Claude-backed flows.

## 13. Rollout

- **Phase 1** (refactor): single feature branch, standard PR review, merge behind no flag — pure refactor.
- **Phase 2+** (new backends): each behind the `agentBackends` setting, default off. No migration required — users opt in explicitly via Settings UI.
- **Documentation:** update `docs/architecture.md`, `docs/BDE_FEATURES.md` (new Agent Backends section), and add an ADR in `docs/architecture-decisions/`.
- **Feature announcement:** README + release notes when Phase 2 ships. Emphasize opt-in, experimental status.

## 14. Alternatives Considered

- **Per-task backend override.** Rejected for v1 (see Open Question 1).
- **Replace Claude Code entirely with a local backend.** Rejected outright — Claude Code is the product's strongest dependency and the reason it works.
- **Fork OpenHands as the full replacement.** Rejected — inherits their sandbox opinions, their tool set, and their agent loop; fights BDE's existing worktree + review model. Better to own a thin backend than inherit a fat one.
- **Let the model itself route (prompt Claude to decide when to delegate to local).** Rejected — too much unpredictability; users should control cost and privacy, not the model.

---

## Appendix A — File-by-File Change Summary

**New files:**
- `src/main/agent-manager/backends/agent-backend.ts` — interface + types
- `src/main/agent-manager/backends/backend-registry.ts` — registration + resolution
- `src/main/agent-manager/backends/claude-code-backend.ts` — wraps existing spawn logic
- `src/main/agent-manager/backends/aider-backend.ts` — Phase 2
- `src/main/agent-manager/backends/local-mcp-backend.ts` — Phase 3
- `src/renderer/src/components/settings/AgentBackendsTab.tsx` — new Settings tab
- `docs/architecture-decisions/pluggable-agent-backends.md` — ADR

**Modified files:**
- `src/main/agent-manager/sdk-adapter.ts` — delegates to registry
- `src/main/agent-manager/types.ts` — adds `AgentType` to `SpawnBackendOptions`
- All callers of `spawnAgent` / `spawnWithTimeout` — pass `agentType`
- `src/shared/types/settings-types.ts` — new `agentBackends` setting shape
- `src/renderer/src/views/SettingsView.tsx` — register new tab
- `docs/architecture.md` — update agent-manager section
- `docs/BDE_FEATURES.md` — new Agent Backends section

**Unchanged:**
- Drain loop, watchdog, completion flow, retry logic, worktree management, cost tracking, event persistence, playground detection, Code Review Station. None of these know or care which backend produced the `AgentHandle`.
