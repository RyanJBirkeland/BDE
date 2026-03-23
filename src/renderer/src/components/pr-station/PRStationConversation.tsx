import { FileCode2 } from 'lucide-react'
import type { PrComment, PrIssueComment } from '../../../../shared/types'
import { renderMarkdown } from '../../lib/render-markdown'
import { timeAgo } from '../../lib/format'

interface ConversationProps {
  reviewComments: PrComment[]
  issueComments: PrIssueComment[]
  loading: boolean
}

type TimelineItem =
  | { kind: 'issue'; comment: PrIssueComment }
  | { kind: 'review-thread'; path: string; comments: PrComment[] }

function buildTimeline(
  reviewComments: PrComment[],
  issueComments: PrIssueComment[]
): TimelineItem[] {
  const rootComments = reviewComments.filter((c) => !c.in_reply_to_id)
  const replyMap = new Map<number, PrComment[]>()
  for (const c of reviewComments) {
    if (c.in_reply_to_id) {
      const replies = replyMap.get(c.in_reply_to_id) ?? []
      replies.push(c)
      replyMap.set(c.in_reply_to_id, replies)
    }
  }

  const threads: { thread: PrComment[]; firstAt: string }[] = []
  for (const root of rootComments) {
    const thread = [root]
    const replies = replyMap.get(root.id) ?? []
    replies.sort((a, b) => a.created_at.localeCompare(b.created_at))
    thread.push(...replies)
    threads.push({ thread, firstAt: root.created_at })
  }

  const items: { sortKey: string; item: TimelineItem }[] = []

  for (const ic of issueComments) {
    items.push({ sortKey: ic.created_at, item: { kind: 'issue', comment: ic } })
  }

  for (const { thread, firstAt } of threads) {
    items.push({
      sortKey: firstAt,
      item: { kind: 'review-thread', path: thread[0].path ?? '', comments: thread }
    })
  }

  items.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
  return items.map((i) => i.item)
}

function CommentCard({
  login,
  body,
  createdAt
}: {
  login: string
  body: string
  createdAt: string
}) {
  // renderMarkdown() returns sanitized HTML (uses DOMPurify internally)
  const sanitizedHtml = renderMarkdown(body)
  return (
    <div className="pr-conversation__comment">
      <div className="pr-conversation__comment-header">
        <span className="pr-conversation__author">{login}</span>
        <span className="pr-conversation__time">{timeAgo(createdAt)}</span>
      </div>
      <div
        className="pr-conversation__body"
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      />
    </div>
  )
}

export function PRStationConversation({
  reviewComments,
  issueComments,
  loading
}: ConversationProps) {
  if (loading) {
    return (
      <div className="pr-detail__section">
        <h3 className="pr-detail__section-title">Conversation</h3>
        <div className="pr-detail__checks-loading">
          <div className="sprint-board__skeleton" style={{ height: 40 }} />
          <div className="sprint-board__skeleton" style={{ height: 40 }} />
        </div>
      </div>
    )
  }

  const timeline = buildTimeline(reviewComments, issueComments)

  if (timeline.length === 0) {
    return (
      <div className="pr-detail__section">
        <h3 className="pr-detail__section-title">Conversation</h3>
        <span className="pr-detail__no-data">No comments</span>
      </div>
    )
  }

  const totalComments = issueComments.length + reviewComments.length

  return (
    <div className="pr-detail__section">
      <h3 className="pr-detail__section-title">
        Conversation
        <span className="bde-count-badge">{totalComments}</span>
      </h3>
      <div className="pr-conversation">
        {timeline.map((item) => {
          if (item.kind === 'issue') {
            return (
              <CommentCard
                key={`ic-${item.comment.id}`}
                login={item.comment.user.login}
                body={item.comment.body}
                createdAt={item.comment.created_at}
              />
            )
          }
          const root = item.comments[0]
          return (
            <div key={`rt-${root.id}`} className="pr-conversation__thread">
              <div className="pr-conversation__thread-file">
                <FileCode2 size={12} />
                <span>{item.path}</span>
                {root.line && (
                  <span className="pr-conversation__thread-line">L{root.line}</span>
                )}
              </div>
              {item.comments.map((c) => (
                <CommentCard
                  key={c.id}
                  login={c.user.login}
                  body={c.body}
                  createdAt={c.created_at}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
