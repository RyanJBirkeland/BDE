# Agent model routing — release notes (2026-04-20)

**Branch:** `feat/agent-model-routing`
**Spec:** `docs/superpowers/specs/2026-04-20-finish-agent-model-routing-design.md`
**Plan:** `docs/superpowers/plans/2026-04-20-finish-agent-model-routing.md`

## Summary

Settings → Models now drives the Claude model for every agent type — not just Pipeline. Pick per-type models for Synthesizer, Copilot, Assistant, Adhoc, and Reviewer; the main process resolves the value on every spawn and stream.

## Breaking change — Reviewer quality default

The code review agent previously hardcoded `claude-opus-4-6`. After upgrade, installs that have never touched Settings → Models run reviews on `claude-sonnet-4-5` (the unified settings default for every agent type).

**Action for users who want Opus reviews:**

1. Open Settings → Models.
2. Locate the Reviewer row in the "Active routing" card.
3. Change the model picker to Opus.
4. Save.

Settings persist across app restarts. Once set, the preference is respected on every review.

## UI change — Settings → Models

- The "Not yet routed" card is gone. All six agent-type rows now live in a single "Active routing" card.
- Every row's model picker is interactive (was disabled on all rows except Pipeline).
- The Local backend toggle stays Pipeline-only for now. On the other five rows, the Local radio is greyed out with a tooltip explaining the current limitation — the Claude side of the toggle is fully functional.

## UI change — Agents view launchpad

The `LaunchpadGrid` model picker (the Haiku/Sonnet/Opus pills on the Agents view) is now display-only. Routing for Adhoc and Assistant sessions comes from Settings → Models, not from the launchpad. Pills render without an "active" highlight to avoid implying they control the spawn. Change the model in Settings → Models.

## Non-breaking internal changes

- `resolveBackend` was renamed to `resolveAgentRuntime`. The old name is a `@deprecated` alias kept for one release; it will be removed in a follow-up.
- `SdkStreamingOptions.model` is now a required field. Any future integration that calls `runSdkStreaming` or `runSdkOnce` must resolve a model via `resolveAgentRuntime(type).model`.
- `spawnAdhocAgent`, `getCopilotSdkOptions`, and `SpawnLocalAgentArgs` no longer accept a caller-supplied `model` — settings are the single source of truth.

## What this feature does NOT route

- **Spec-quality validators** (`src/main/services/spec-quality/validators/`) still pin Haiku directly. They run as part of the Task Workbench "Check spec" flow, not as a user-facing agent, and the Haiku pin is a deliberate latency/cost choice. These validators are not exposed in Settings → Models.
- **`agentManager.defaultModel` and per-task `task.model`** remain vestigial in the default Claude backend — `resolveAgentRuntime('pipeline').model` takes precedence over both. Cleaning those up is a separate concern tracked outside this feature.
