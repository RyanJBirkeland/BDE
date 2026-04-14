/**
 * Typed IPC channel map — re-exported from domain-grouped modules.
 * Single source of truth for channel names and payloads.
 *
 * Each entry maps a channel name to its `args` tuple and `result` type.
 * Both `safeHandle()` (main) and `typedInvoke()` (preload) derive their
 * types from this map, giving end-to-end compile-time safety.
 *
 * ─────────────────────────────────────────────────────────────────────
 * IPC Channel Naming Convention
 * ─────────────────────────────────────────────────────────────────────
 *
 * All channels follow the pattern `domain:action` or, for sub-domains,
 * `domain:entity` (e.g. `agent-manager:status`).
 *
 * Handler types (defined in src/main/ipc-utils.ts):
 *
 *   safeHandle  (request/reply)   Used for queries and mutations that
 *                                  return a value. Renderer calls
 *                                  `typedInvoke(channel, ...args)` and
 *                                  awaits a result. This is the default
 *                                  for all channels in IpcChannelMap.
 *
 *   safeOn      (one-way)         Fire-and-forget messages from renderer
 *                                  → main that need no reply. Used
 *                                  sparingly (e.g. `terminal:write`,
 *                                  `window:setTitle`).
 *
 *   onBroadcast (main→renderer)   Server-push events broadcast from main
 *                                  to all renderer windows. Defined in
 *                                  BroadcastChannels (broadcast-channels.ts)
 *                                  and registered via the `onBroadcast<T>`
 *                                  factory in src/preload/index.ts.
 *
 * Naming patterns by semantic:
 *
 *   Queries:    `domain:get<Entity>`   or  `domain:list`
 *               e.g. `settings:get`, `cost:summary`, `agents:list`,
 *                    `groups:get`, `pr:getList`
 *
 *   Mutations:  `domain:<verb>` or `domain:<verb><Entity>`
 *               e.g. `sprint:create`, `sprint:update`, `sprint:delete`,
 *                    `git:commit`, `git:push`, `review:mergeLocally`
 *
 *   Streams:    `domain:<action>Stream`  (initiates; result is a streamId)
 *               Chunks arrive via BroadcastChannels under a matching key.
 *               e.g. `workbench:chatStream` → broadcast `workbench:chatChunk`
 *                    `review:chatStream`    → broadcast `review:chatChunk`
 *                    `synthesizer:generate` → broadcast `synthesizer:chunk`
 *
 *   Broadcasts: named as noun or past-tense verb to signal push semantics
 *               e.g. `sprint:externalChange`, `sprint:mutation`,
 *                    `pr:listUpdated`, `agent:event`, `fs:dirChanged`
 *
 * Legacy / irregular patterns (kept for backward compatibility):
 *
 *   - `local:*`      — early agent-spawn channels that predate the
 *                       `agent:*` / `agents:*` split (`local:spawnClaudeAgent`,
 *                       `local:getAgentProcesses`, `local:tailAgentLog`).
 *   - `agent:*` vs `agents:*`  — singular used for per-agent actions
 *                       (`agent:steer`, `agent:kill`), plural for
 *                       collection ops (`agents:list`, `agents:readLog`).
 *                       New channels should follow this singular/plural rule.
 *   - `dashboard:completionsPerHour`, `dashboard:recentEvents` — dashboard queries
 *                       that live in DashboardChannels but use the `agent:`
 *                       prefix instead of `dashboard:`.
 *   - `clipboard:readImage` — lives inside SystemChannels despite having
 *                       its own `clipboard:` prefix.
 *
 * Adding new channels:
 *   1. Add the channel to the appropriate domain file in this directory.
 *   2. Export the interface from this index file.
 *   3. Intersect the interface into `IpcChannelMap` below.
 *   4. For broadcast-only channels add to BroadcastChannels instead.
 * ─────────────────────────────────────────────────────────────────────
 */

// Agent channels
export type {
  AgentChannels,
  AgentEventChannels,
  AgentManagerChannels,
  CostChannels
} from './agent-channels'

// Broadcast channels
export type { BroadcastChannels } from './broadcast-channels'

// Sprint channels
export type {
  SprintChannels,
  ReviewChannels,
  ReviewPartnerChannels,
  TemplateChannels,
  SynthesizerChannels,
  GroupChannels,
  PlannerChannels
} from './sprint-channels'

// Git channels
export type {
  GitChannels,
  PrChannels,
  GitHubApiChannels,
  GitHubFetchInit,
  GitHubFetchResult
} from './git-channels'

// Settings channels
export type { SettingsChannels, ClaudeConfigChannels, AuthChannels } from './settings-channels'

// UI channels
export type {
  WindowChannels,
  TearoffChannels,
  DashboardChannels,
  CompletionBucket,
  DashboardEvent,
  DailySuccessRate
} from './ui-channels'

// FS channels
export type { FsChannels, MemoryChannels } from './fs-channels'

// System channels
export type {
  TerminalChannels,
  TerminalDataPayload,
  WorkbenchChannels,
  WebhookChannels,
  SystemChannels,
  RepoDiscoveryChannels,
  Webhook,
  LoadSample,
  LoadSnapshot,
  LocalRepoInfo,
  GithubRepoInfo,
  CloneProgressEvent
} from './system-channels'

// Composite channel map — intersection of all domain maps
export type IpcChannelMap = import('./settings-channels').SettingsChannels &
  import('./git-channels').GitChannels &
  import('./git-channels').PrChannels &
  import('./agent-channels').AgentChannels &
  import('./git-channels').GitHubApiChannels &
  import('./agent-channels').CostChannels &
  import('./sprint-channels').SprintChannels &
  import('./ui-channels').WindowChannels &
  import('./fs-channels').MemoryChannels &
  import('./fs-channels').FsChannels &
  import('./agent-channels').AgentEventChannels &
  import('./sprint-channels').TemplateChannels &
  import('./settings-channels').AuthChannels &
  import('./agent-channels').AgentManagerChannels &
  import('./system-channels').TerminalChannels &
  import('./system-channels').WorkbenchChannels &
  import('./ui-channels').DashboardChannels &
  import('./sprint-channels').SynthesizerChannels &
  import('./sprint-channels').ReviewChannels &
  import('./sprint-channels').ReviewPartnerChannels &
  import('./ui-channels').TearoffChannels &
  import('./settings-channels').ClaudeConfigChannels &
  import('./system-channels').WebhookChannels &
  import('./sprint-channels').GroupChannels &
  import('./sprint-channels').PlannerChannels &
  import('./system-channels').SystemChannels &
  import('./system-channels').RepoDiscoveryChannels
