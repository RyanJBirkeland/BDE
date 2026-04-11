// src/shared/review-types.ts

export type FindingSeverity = 'high' | 'medium' | 'low'
export type FindingCategory = 'security' | 'performance' | 'correctness' | 'style'

export interface InlineComment {
  /** Right-side (post-change) line number in the diff. */
  line: number
  severity: FindingSeverity
  category: FindingCategory
  /** Single-sentence finding. */
  message: string
}

export interface FileFinding {
  path: string
  status: 'clean' | 'issues'
  commentCount: number
  /** Stored in v1, rendered in a v2 follow-up. */
  comments: InlineComment[]
}

export interface ReviewFindings {
  perFile: FileFinding[]
  /** Git branch the review was run against. Populated at review time by the service. */
  branch?: string
}

export interface ReviewResult {
  /** 0-100, higher is better. */
  qualityScore: number
  /** Server-computed aggregate of high+medium severity comments across files. */
  issuesCount: number
  /** Server-computed aggregate — `findings.perFile.length`. */
  filesCount: number
  /** 2-4 sentence summary used to seed the chat thread. */
  openingMessage: string
  findings: ReviewFindings
  /** Model identifier, e.g. 'claude-opus-4-6'. */
  model: string
  /** Milliseconds since epoch. */
  createdAt: number
}

export interface PartnerMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  /** True while chunks are still arriving for this message. */
  streaming?: boolean
}

/** Wire shape pushed over the `review:chatChunk` IPC channel. */
export interface ChatChunk {
  streamId: string
  chunk?: string
  done?: boolean
  fullText?: string
  error?: string
  toolUse?: { name: string; input: Record<string, unknown> }
}
