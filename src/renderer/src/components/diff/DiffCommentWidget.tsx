import { useState } from 'react'
import './DiffCommentWidget.css'
import { ChevronDown, ChevronRight, MessageSquare } from 'lucide-react'
import type { PrComment } from '../../../../shared/types'
import { renderMarkdown } from '../../lib/render-markdown'
import { timeAgo } from '../../lib/format'

interface DiffCommentWidgetProps {
  comments: PrComment[]
}

export function DiffCommentWidget({ comments }: DiffCommentWidgetProps): React.JSX.Element | null {
  const [collapsed, setCollapsed] = useState(false)

  if (comments.length === 0) return null

  return (
    <div className="diff-comment-widget">
      <button className="diff-comment-widget__toggle" onClick={() => setCollapsed((c) => !c)}>
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <MessageSquare size={12} />
        <span>
          {comments.length} comment{comments.length > 1 ? 's' : ''}
        </span>
      </button>
      {!collapsed && (
        <div className="diff-comment-widget__thread">
          {comments.map((c) => (
            <div key={c.id} className="diff-comment-widget__comment">
              <div className="diff-comment-widget__header">
                <span className="diff-comment-widget__author">{c.user.login}</span>
                <span className="diff-comment-widget__time">{timeAgo(c.created_at)}</span>
              </div>
              {/* Content is sanitized via DOMPurify inside renderMarkdown */}
              <div
                className="diff-comment-widget__body"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(c.body) }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
