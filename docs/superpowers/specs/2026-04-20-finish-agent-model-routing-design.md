# Finish active routing + model selection for the remaining agents

**Date:** 2026-04-20
**Status:** Draft — pending user approval before plan.
**Author:** Ryan Birkeland (w/ Claude)

## Problem

The Settings → Models tab ships a per-agent-type backend + model picker, but only the
Pipeline row is live. The five other types (Synthesizer, Copilot, Assistant, Adhoc,
Reviewer) render as "Not yet routed" — their rows are disabled, and the underlying
services still use hardcoded models (`claude-sonnet-4-5` in most places, `claude-opus-4-6`
in the reviewer). The `agents.backendConfig` settings record already has a slot for every
type; what's missing is the consumer-side wiring.

## Goals

1. All five remaining agent types read their model from `agents.backendConfig` at spawn
   time. No more hardcoded defaults inside services.
2. The Models tab collapses to a single "Active routing" card with every type editable.
3. The Local backend toggle stays Pipeline-only for now. Chat-shaped agent types
   (Copilot, Synthesizer, Reviewer) and coding agents we haven't adapted yet
   (Adhoc, Assistant) show the Local radio as disabled with a tooltip.

## Non-goals

- Adding Local backend support to any type other than Pipeline.
- Adding OpenAI-compatible chat-completion shims for Copilot/Synthesizer/Reviewer.
- Wiring `rbt-coding-agent` into the Adhoc/Assistant spawn path.
- Changing which SDK call shape each service uses (streaming vs. single-turn vs. multi-turn).

## Approach

Reuse the existing resolver in `backend-selector.ts`. Every non-pipeline spawn path
calls it, reads `.model`, and passes it to its SDK call. The `.backend` field is
authoritative only for Pipeline; non-pipeline services ignore it and always run Claude.

```
agents.backendConfig (SQLite settings, shape unchanged)
        │
        ▼
resolveAgentRuntime(type)   ← renamed from resolveBackend
        │
        ▼
returns { backend: 'claude' | 'local', model: string }
        │
        ├── Pipeline → branches on backend, as today
        └── Other 5 → reads .model, passes to its SDK call
```

This keeps business logic (what model/backend to use) in a service-layer helper and
leaves the IPC handlers thin.

## Why not a unified dispatcher

A single `spawnAgent(type, options)` that abstracts all five call shapes was
considered and rejected. Pipeline agents emit event streams; Adhoc sessions are
multi-turn with session resumption; Copilot/Synthesizer stream text chunks;
Reviewer is a single-shot JSON call. A single API over those shapes produces a
leaky union type worse than four honest functions.

## Design

### Cleanup moves (Boy Scout, bundled with this change)

1. Rename `resolveBackend` → `resolveAgentRuntime`. It returns a full runtime config
   (backend + model), not just a backend. Keep `resolveBackend` as a deprecated alias
   for one release so the diff is bounded; delete the alias in a follow-up.

2. Remove caller-overridable `model` parameters that bypass the setting:
   - `spawnAdhocAgent(args: { model?: string })` — drop the param. Settings is the
     only source of truth.
   - `runSdkStreaming` / `runSdkOnce` — make `options.model` required. Remove the
     `?? 'claude-sonnet-4-5'` default. TypeScript surfaces any caller that was
     relying on the default.

### Per-service changes

**`src/main/agent-manager/backend-selector.ts`**
- Rename function; add deprecated alias.
- Confirm `DEFAULT_CONFIG.defaultModel` is Sonnet 4.5 (it already is — sanity-check,
  no change expected).

**`src/main/adhoc-agent.ts`**
- Remove `model?: string` from `SpawnAdhocArgs`.
- At the top of `spawnAdhocAgent`: `const { model } = resolveAgentRuntime(args.assistant ? 'assistant' : 'adhoc')`.
- Pass through to `baseOptions.model` and `importAgent({ ..., model })`.
- Update the `agents:spawnLocal` IPC handler so the renderer no longer passes model.

**`src/main/services/copilot-service.ts`**
- `getCopilotSdkOptions(repoPath, extras)` gains a required `model: string` field on
  the returned options. Callers (IPC handlers) resolve via
  `resolveAgentRuntime('copilot').model` and pass in.

**`src/main/services/spec-synthesizer.ts`**
- `synthesizeSpec` and `reviseSpec` each resolve the synthesizer model at call time and
  pass it as `options.model` on their `runSdkStreaming` call.

**`src/main/services/review-service.ts`**
- Delete the `REVIEWER_MODEL` constant.
- In `reviewChanges`, resolve the reviewer runtime and pass `options.model` into
  `runSdkOnce`. Set `result.model` to the resolved value.

**`src/main/sdk-streaming.ts`**
- `SdkStreamingOptions.model` becomes required (no `?`).
- Remove `?? 'claude-sonnet-4-5'` default.

### UI changes (`src/renderer/src/components/settings/ModelsSection.tsx`)

- Replace `ACTIVE_TYPES` and `NOT_YET_ROUTED_TYPES` with a single
  `AGENT_TYPES: Array<{id, label, description, supportsLocal}>`. Only Pipeline has
  `supportsLocal: true`.
- Delete the "Not yet routed" `<SettingsCard>`.
- Render every row inside the "Active routing" card.
- `AgentTypeRow`'s `disabled: boolean` prop → `canUseLocal: boolean`.
  - Model picker is always interactive.
  - `BackendToggle` disables only the Local radio when `!canUseLocal`, with a tooltip
    saying "Claude-only for this agent type."
  - Pipeline row is unaffected (`canUseLocal: true`).
- Card subtitle updated to: "Route each agent type to Claude or a local model.
  Local backend available for Pipeline today."

### Settings schema

Unchanged. `agents.backendConfig` already has all six type slots. No migration.

## Defaults & compatibility

- `DEFAULT_SETTINGS` stays unified on Sonnet 4.5 for all types, via
  `DEFAULT_CONFIG.defaultModel`.
- **Breaking behavior change:** the Reviewer previously hardcoded Claude Opus 4.6.
  After this change, fresh installs and anyone who hasn't touched the setting will
  run reviews on Sonnet 4.5. Users who want Opus must select it in Settings → Models.
  This must be called out in the release notes. The Models tab now exposes per-type
  model choice so users can re-pin Opus.
- Stored `backend: 'local'` values for non-pipeline types (can only arrive via
  manual SQL edit; the new UI won't produce them) are ignored — services only read
  `.model` and always route through Claude.

## Testing

Unit tests:
- `backend-selector.test.ts` — rename coverage; confirm deprecated alias returns the
  same value.
- `adhoc-agent.test.ts` — settings-driven model is applied; no `model` parameter is
  accepted (compile-time guarantee).
- `spec-synthesizer.test.ts` — assert `runSdkStreaming` receives the setting's model.
- `review-service.test.ts` — assert `runSdkOnce` receives the setting's model; assert
  `ReviewResult.model` reflects it.
- `copilot-service.test.ts` — options include the resolved model.
- `ModelsSection.test.tsx` — all six rows in one card; Local radio disabled for
  non-pipeline types; model picker interactive for every row; Save persists the
  full `BackendSettings`.

Manual smoke:
- Change Reviewer model in Settings → trigger `review:checkAuto` → confirm the
  response's `model` field reflects the selection.

## Risks

1. **Reviewer quality regression on upgrade.** Opus → Sonnet on untouched installs.
   Mitigation: release note; Settings now exposes the control.
2. **Callers passing `model` to `spawnAdhocAgent` today.** TypeScript will flag
   them when the param is removed. The IPC handler is the most likely call site.
3. **SDK default removal in `runSdkStreaming`.** Any caller currently relying on
   the Sonnet fallback will fail to compile. Surface them all, add the resolved
   model at each site.

## Out of scope (explicit)

- Adding Local backend to non-pipeline agent types. If desired later, the cleanest
  shape is a separate adapter module (e.g. OpenAI-compatible chat completions for
  Copilot/Synthesizer/Reviewer) plumbed in via the existing resolver.
- Migration of existing stored values.
- Per-type defaults (Reviewer keeping Opus by default was rejected in favor of
  unified Sonnet 4.5).
