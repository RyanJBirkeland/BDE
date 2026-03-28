import { useState, useEffect } from 'react'
import { GitBranch, FilePlus2, FileEdit, FileX2, FileCode2 } from 'lucide-react'
import {
  getCheckRunsList,
  type PRDetail as PRDetailData,
  type PRFile,
  type CheckRun
} from '../../lib/github-api'
import {
  cachedGetPRDetail,
  cachedGetPRFiles,
  cachedGetReviews,
  cachedGetReviewComments,
  cachedGetIssueComments
} from '../../lib/github-cache'
import type { OpenPr, PrReview, PrComment, PrIssueComment } from '../../../../shared/types'
import { useRepoOptions } from '../../hooks/useRepoOptions'
import { renderMarkdown } from '../../lib/render-markdown'
import { PRStationChecks } from './PRStationChecks'
import { PRStationConflictBanner } from './PRStationConflictBanner'
import { PRStationReviews } from './PRStationReviews'
import { PRStationConversation } from './PRStationConversation'
import { MergeButton } from './MergeButton'
import { CloseButton } from './CloseButton'
import type { PrMergeability } from '../../lib/github-api'

interface PRStationDetailProps {
  pr: OpenPr
  mergeability?: PrMergeability | null
  onMerged?: (pr: OpenPr) => void
}

function FileStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'added':
      return <FilePlus2 size={14} className="pr-detail__file-icon--added" />
    case 'removed':
      return <FileX2 size={14} className="pr-detail__file-icon--removed" />
    default:
      return <FileEdit size={14} className="pr-detail__file-icon--modified" />
  }
}

function fileStatusLabel(status: string): string {
  switch (status) {
    case 'added':
      return 'A'
    case 'removed':
      return 'D'
    case 'renamed':
      return 'R'
    default:
      return 'M'
  }
}

function fileStatusBadgeClass(status: string): string {
  switch (status) {
    case 'added':
      return 'pr-detail__file-badge--added'
    case 'removed':
      return 'pr-detail__file-badge--removed'
    default:
      return 'pr-detail__file-badge--modified'
  }
}

export function PRStationDetail({ pr, mergeability, onMerged }: PRStationDetailProps) {
  const repoOptions = useRepoOptions()
  const [detail, setDetail] = useState<PRDetailData | null>(null)
  const [files, setFiles] = useState<PRFile[]>([])
  const [checks, setChecks] = useState<CheckRun[]>([])
  const [reviews, setReviews] = useState<PrReview[]>([])
  const [reviewComments, setReviewComments] = useState<PrComment[]>([])
  const [issueComments, setIssueComments] = useState<PrIssueComment[]>([])
  const [loading, setLoading] = useState(true)
  const [checksLoading, setChecksLoading] = useState(true)
  const [reviewsLoading, setReviewsLoading] = useState(true)
  const [commentsLoading, setCommentsLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()

    async function fetchAll() {
      const repo = repoOptions.find((r) => r.label === pr.repo)
      if (!repo) return

      setLoading(true)
      setChecksLoading(true)
      setReviewsLoading(true)
      setCommentsLoading(true)

      try {
        const [
          detailResult,
          filesResult,
          reviewsResult,
          reviewCommentsResult,
          issueCommentsResult
        ] = await Promise.allSettled([
          cachedGetPRDetail(repo.owner, repo.label, pr.number),
          cachedGetPRFiles(repo.owner, repo.label, pr.number),
          cachedGetReviews(repo.owner, repo.label, pr.number),
          cachedGetReviewComments(repo.owner, repo.label, pr.number),
          cachedGetIssueComments(repo.owner, repo.label, pr.number)
        ])
        if (controller.signal.aborted) return

        const prDetail = detailResult.status === 'fulfilled' ? detailResult.value : null
        const prFiles = filesResult.status === 'fulfilled' ? filesResult.value : []
        const prReviews = reviewsResult.status === 'fulfilled' ? reviewsResult.value : []
        const prReviewComments =
          reviewCommentsResult.status === 'fulfilled' ? reviewCommentsResult.value : []
        const prIssueComments =
          issueCommentsResult.status === 'fulfilled' ? issueCommentsResult.value : []

        setDetail(prDetail)
        setFiles(prFiles)
        setReviews(prReviews)
        setReviewComments(prReviewComments)
        setIssueComments(prIssueComments)
        setCommentsLoading(false)
        setReviewsLoading(false)
        setLoading(false)

        if (prDetail) {
          const checkRuns = await getCheckRunsList(repo.owner, repo.label, prDetail.head.sha)
          if (controller.signal.aborted) return
          setChecks(checkRuns)
        }
      } catch {
        if (!controller.signal.aborted) setDetail(null)
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
          setChecksLoading(false)
        }
      }
    }

    fetchAll()
    return () => {
      controller.abort()
    }
  }, [pr.repo, pr.number, repoOptions])

  if (loading) {
    return (
      <div className="pr-detail">
        <div className="pr-detail__skeleton-header">
          <div className="sprint-board__skeleton" style={{ height: 24, width: '60%' }} />
          <div className="sprint-board__skeleton" style={{ height: 16, width: '40%' }} />
        </div>
        <div className="pr-detail__skeleton-body">
          <div className="sprint-board__skeleton" style={{ height: 120 }} />
        </div>
        <div className="pr-detail__skeleton-body">
          <div className="sprint-board__skeleton" style={{ height: 28 }} />
          <div className="sprint-board__skeleton" style={{ height: 28 }} />
          <div className="sprint-board__skeleton" style={{ height: 28 }} />
        </div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="pr-detail pr-detail--error">
        <FileCode2 size={24} />
        <span>Failed to load PR details</span>
      </div>
    )
  }

  const mergeableState = detail?.mergeable_state ?? null

  return (
    <div className="pr-detail">
      {/* Header */}
      <div className="pr-detail__header">
        <h2 className="pr-detail__title">
          <span className="pr-detail__number">#{detail.number}</span>
          {detail.title}
        </h2>
        <div className="pr-detail__meta">
          <span className="pr-detail__author">{detail.user.login}</span>
          {detail.draft && <span className="pr-detail__draft">draft</span>}
          <span className="pr-detail__branches">
            <GitBranch size={12} />
            {detail.head.ref}
            <span className="pr-detail__branch-arrow">&larr;</span>
            {detail.base.ref}
          </span>
        </div>
        {detail.labels.length > 0 && (
          <div className="pr-detail__labels">
            {detail.labels.map((label) => (
              <span
                key={label.name}
                className="pr-detail__label"
                style={{ background: `#${label.color}` }}
              >
                {label.name}
              </span>
            ))}
          </div>
        )}
        <div className="pr-detail__stats">
          <span className="pr-detail__stat pr-detail__stat--add">+{detail.additions}</span>
          <span className="pr-detail__stat pr-detail__stat--del">-{detail.deletions}</span>
        </div>
        {mergeability !== undefined && mergeability !== null && (
          <div className="pr-detail__actions">
            <MergeButton pr={pr} mergeability={mergeability} onMerged={onMerged} />
            <CloseButton pr={pr} onClosed={onMerged} />
          </div>
        )}
      </div>

      <PRStationConflictBanner pr={pr} mergeableState={mergeableState} />

      {/* PR Body */}
      <div className="pr-detail__section">
        <h3 className="pr-detail__section-title">Description</h3>
        {detail.body ? (
          <div
            className="pr-detail__body"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(detail.body) }}
          />
        ) : (
          <span className="pr-detail__no-data">No description provided</span>
        )}
      </div>

      {/* CI Checks */}
      <PRStationChecks checks={checks} loading={checksLoading} />

      {/* Reviews */}
      <PRStationReviews reviews={reviews} loading={reviewsLoading} />

      {/* Conversation */}
      <PRStationConversation
        reviewComments={reviewComments}
        issueComments={issueComments}
        loading={commentsLoading}
      />

      {/* Changed Files */}
      <div className="pr-detail__section">
        <h3 className="pr-detail__section-title">
          Changed Files
          <span className="bde-count-badge">{files.length}</span>
        </h3>
        {files.length === 0 ? (
          <span className="pr-detail__no-data">No changed files</span>
        ) : (
          <ul className="pr-detail__files">
            {files.map((file) => (
              <li key={file.filename} className="pr-detail__file">
                <FileStatusIcon status={file.status} />
                <span className="pr-detail__filename">{file.filename}</span>
                <span className={`pr-detail__file-badge ${fileStatusBadgeClass(file.status)}`}>
                  {fileStatusLabel(file.status)}
                </span>
                <span className="pr-detail__file-diff">
                  <span className="pr-detail__file-add">+{file.additions}</span>
                  <span className="pr-detail__file-del">-{file.deletions}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
