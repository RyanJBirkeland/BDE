# sdk-streaming

**Layer:** main (shared utility)
**Source:** `src/main/sdk-streaming.ts`

## Purpose

Shared SDK streaming utilities for one-shot and streaming Claude Agent SDK queries. Used by the workbench (copilot/synthesizer) and code-review auto-review paths. Does not handle cost aggregation — that responsibility lives in `agent-telemetry.ts` and `message-consumer.ts`, which process the full agent message stream produced by the pipeline agent drain loop.

## Public API

- `runSdkStreaming(prompt, onChunk, activeStreams, streamId, timeoutMs, options)` — streams a query, firing `onChunk` per text chunk; returns the full text on completion. Cancellable via `activeStreams`.
- `runSdkOnce(prompt, options, timeoutMs)` — single-shot wrapper over `runSdkStreaming` with a no-op chunk callback. Used when JSON-mode output is collected all at once (e.g. structured reviewer pass).
- `SdkStreamingOptions` — option bag for both entry points (model, cwd, tools, maxTurns, maxBudgetUsd, onToolUse, settingSources, permissionMode, allowDangerouslySkipPermissions).
- `ToolUseEvent` — `{ name, input }` delivered to `onToolUse` when the model invokes a tool.

## Key Dependencies

- `env-utils.ts` — `buildAgentEnvWithAuth`, `getClaudeCliPath` for subprocess environment setup
- `sdk-adapter.ts` — `asSDKMessage` to type-narrow raw SDK messages before extracting text and tool-use blocks
