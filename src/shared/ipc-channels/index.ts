/**
 * Typed IPC channel map — re-exported from domain-grouped modules.
 * Single source of truth for channel names and payloads.
 *
 * Each entry maps a channel name to its `args` tuple and `result` type.
 * Both `safeHandle()` (main) and `typedInvoke()` (preload) derive their
 * types from this map, giving end-to-end compile-time safety.
 */

// Agent channels
export type {
  AgentChannels,
  AgentEventChannels,
  AgentManagerChannels,
  CostChannels
} from './agent-channels'

// Sprint channels
export type {
  SprintChannels,
  ReviewChannels,
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
  PlaygroundChannels,
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
  import('./ui-channels').PlaygroundChannels &
  import('./ui-channels').DashboardChannels &
  import('./sprint-channels').SynthesizerChannels &
  import('./sprint-channels').ReviewChannels &
  import('./ui-channels').TearoffChannels &
  import('./settings-channels').ClaudeConfigChannels &
  import('./system-channels').WebhookChannels &
  import('./sprint-channels').GroupChannels &
  import('./sprint-channels').PlannerChannels &
  import('./system-channels').SystemChannels &
  import('./system-channels').RepoDiscoveryChannels
