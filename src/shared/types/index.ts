/**
 * Shared types — re-exported from domain-grouped modules for backward compatibility.
 * Single source of truth — do not redefine these elsewhere.
 */

// Agent types
export type {
  AgentType,
  AgentMeta,
  SpawnLocalAgentArgs,
  SpawnLocalAgentResult,
  AgentRunCostRow,
  AgentRunSummary,
  CostSummary,
  AgentCostRecord,
  UnifiedAgentSource,
  UnifiedAgentStatus,
  LocalAgent,
  HistoryAgent,
  UnifiedAgent,
  Attachment,
  AgentManagerConcurrencyState,
  AgentManagerActiveAgent,
  AgentManagerStatus,
  MetricsSnapshot,
  AgentEventType,
  AgentEvent,
  AgentSpawnOptions,
  AgentHandle,
  AgentProvider,
  PlaygroundContentType
} from './agent-types'
export { PLAYGROUND_CONTENT_TYPE_LABELS } from './agent-types'

// Task types
export type {
  TaskDependency,
  EpicDependency,
  TaskGroup,
  RevisionFeedbackEntry,
  FailureReason,
  SprintTask,
  SprintTaskCore,
  SprintTaskSpec,
  SprintTaskExecution,
  SprintTaskPR,
  ReviewDiffSnapshot,
  Sprint,
  TaskTemplate,
  ClaimedTask,
  SynthesizeRequest,
  ReviseRequest,
  BatchOperation,
  BatchResult,
  BatchImportTask,
  TaskOutputEventType,
  TaskOutputEvent,
  AutoReviewRule,
  SpecTypeSuccessRate,
  Result
} from './task-types'

export { GENERAL_PATCH_FIELDS } from './task-types'

// Git types
export type {
  OpenPr,
  CheckStatus,
  CheckRunSummary,
  PrListPayload,
  PrReview,
  PrComment,
  PrIssueComment
} from './git-types'

// Review Partner types
export type {
  FindingSeverity,
  FindingCategory,
  InlineComment,
  FileFinding,
  ReviewFindings,
  ReviewResult,
  PartnerMessage,
  ChatChunk
} from './review-types'

// Agent prompt input
export type { BuildPromptInput } from './agent-prompt'

// Revision feedback
export type { RevisionFeedback, RevisionDiagnostic } from './revision'
