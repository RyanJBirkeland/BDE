/**
 * Git and pull request types — PRs, reviews, comments, and check statuses.
 */

/** Open PR returned by the main-process PR poller. */
export interface OpenPr {
  number: number
  title: string
  html_url: string
  state: string
  draft: boolean
  created_at: string
  updated_at: string
  head: { ref: string; sha: string }
  base: { ref: string }
  user: { login: string }
  merged: boolean
  merged_at: string | null
  repo: string
}

export type CheckStatus = 'pending' | 'pass' | 'fail' | 'unknown'

export interface CheckRunSummary {
  status: CheckStatus
  total: number
  passed: number
  failed: number
  pending: number
}

export interface PrListPayload {
  prs: OpenPr[]
  checks: Record<string, CheckRunSummary>
  repoErrors?: Record<string, string>
}

export interface PrReview {
  id: number
  user: { login: string; avatar_url: string }
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
  body: string | null
  submitted_at: string
  html_url: string
}

export interface PrComment {
  id: number
  user: { login: string; avatar_url: string }
  body: string
  created_at: string
  updated_at: string
  html_url: string
  path?: string
  line?: number | null
  original_line?: number | null
  side?: 'LEFT' | 'RIGHT'
  start_line?: number | null
  start_side?: 'LEFT' | 'RIGHT'
  diff_hunk?: string
  in_reply_to_id?: number | null
  pull_request_review_id?: number | null
}

export interface PrIssueComment {
  id: number
  user: { login: string; avatar_url: string }
  body: string
  created_at: string
  html_url: string
}
