import { useState, useEffect } from 'react'
import { GitBranch, FilePlus2, FileEdit, FileX2, FileCode2 } from 'lucide-react'
import {
  getPRDetail,
  getPRFiles,
  getCheckRunsList,
  type PRDetail as PRDetailData,
  type PRFile,
  type CheckRun
} from '../../lib/github-api'
import type { OpenPr } from '../../../../shared/types'
import { REPO_OPTIONS } from '../../lib/constants'
import { renderMarkdown } from '../../lib/render-markdown'
import { PRStationChecks } from './PRStationChecks'

interface PRStationDetailProps {
  pr: OpenPr
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
    case 'added': return 'A'
    case 'removed': return 'D'
    case 'renamed': return 'R'
    default: return 'M'
  }
}

function fileStatusBadgeClass(status: string): string {
  switch (status) {
    case 'added': return 'pr-detail__file-badge--added'
    case 'removed': return 'pr-detail__file-badge--removed'
    default: return 'pr-detail__file-badge--modified'
  }
}

export function PRStationDetail({ pr }: PRStationDetailProps) {
  const [detail, setDetail] = useState<PRDetailData | null>(null)
  const [files, setFiles] = useState<PRFile[]>([])
  const [checks, setChecks] = useState<CheckRun[]>([])
  const [loading, setLoading] = useState(true)
  const [checksLoading, setChecksLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function fetchAll() {
      const repo = REPO_OPTIONS.find((r) => r.label === pr.repo)
      if (!repo) return

      setLoading(true)
      setChecksLoading(true)

      try {
        const [prDetail, prFiles] = await Promise.all([
          getPRDetail(repo.owner, repo.label, pr.number),
          getPRFiles(repo.owner, repo.label, pr.number)
        ])
        if (cancelled) return
        setDetail(prDetail)
        setFiles(prFiles)
        setLoading(false)

        const checkRuns = await getCheckRunsList(repo.owner, repo.label, prDetail.head.sha)
        if (cancelled) return
        setChecks(checkRuns)
      } catch {
        if (!cancelled) setDetail(null)
      } finally {
        if (!cancelled) {
          setLoading(false)
          setChecksLoading(false)
        }
      }
    }

    fetchAll()
    return () => { cancelled = true }
  }, [pr.repo, pr.number])

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
      </div>

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
