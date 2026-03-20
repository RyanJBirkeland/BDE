/**
 * TicketEditor — inline editable ticket list rendered inside chat
 * when an agent outputs a ```tickets-json fenced code block.
 *
 * Allows editing title, prompt, repo, and priority for each ticket.
 * "Create All" sends each ticket to the sprint store's createTask().
 * "Dismiss" collapses back to raw JSON.
 */
import { useState, useEffect } from 'react'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useUIStore } from '../../stores/ui'
import { toast } from '../../stores/toasts'
import { tokens } from '../../design-system/tokens'

export interface TicketDraft {
  title: string
  prompt: string
  repo: string
  priority: number
}

interface TicketWithId extends TicketDraft {
  _id: string
}

interface TicketEditorProps {
  initialTickets: TicketDraft[]
}

type EditorState = 'editing' | 'creating' | 'done' | 'dismissed'

export function TicketEditor({ initialTickets }: TicketEditorProps): React.JSX.Element {
  const [tickets, setTickets] = useState<TicketWithId[]>(() =>
    initialTickets.map(({ title, prompt, repo, priority }) => ({
      _id: crypto.randomUUID(),
      title: title ?? '',
      prompt: prompt ?? '',
      repo: repo ?? '',
      priority: priority ?? 3,
    }))
  )
  const [state, setState] = useState<EditorState>('editing')
  const [repoPaths, setRepoPaths] = useState<Record<string, string>>({})
  const [expandedPrompts, setExpandedPrompts] = useState<Set<string>>(new Set())

  useEffect(() => {
    window.api.getRepoPaths().then((paths) => setRepoPaths(paths))
  }, [])

  const repoKeys = Object.keys(repoPaths)

  const updateTicket = (idx: number, patch: Partial<TicketDraft>): void => {
    setTickets((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)))
  }

  const removeTicket = (idx: number): void => {
    setTickets((prev) => prev.filter((_, i) => i !== idx))
  }

  const addTicket = (): void => {
    setTickets((prev) => [
      ...prev,
      { _id: crypto.randomUUID(), title: '', prompt: '', repo: repoKeys[0] ?? '', priority: 3 },
    ])
  }

  const moveTicket = (idx: number, direction: -1 | 1): void => {
    const target = idx + direction
    if (target < 0 || target >= tickets.length) return
    setTickets((prev) => {
      const next = [...prev]
      const temp = next[idx]
      next[idx] = next[target]
      next[target] = temp
      return next
    })
  }

  const togglePrompt = (id: string): void => {
    setExpandedPrompts((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const createAll = async (): Promise<void> => {
    setState('creating')
    try {
      for (const { _id: _, ...ticket } of tickets) {
        await useSprintTasks.getState().createTask({
          title: ticket.title,
          repo: ticket.repo,
          prompt: ticket.prompt,
          priority: ticket.priority,
          spec: ticket.prompt,
        })
      }
      toast.success(`${tickets.length} tickets created in backlog`)
      setState('done')
    } catch (err) {
      toast.error(`Failed to create tickets: ${err instanceof Error ? err.message : String(err)}`)
      setState('editing')
    }
  }

  const dismiss = (): void => {
    setState('dismissed')
  }

  // Dismissed state — show raw JSON
  if (state === 'dismissed') {
    return (
      <pre className="chat-msg__code-block">
        <code>{JSON.stringify(initialTickets, null, 2)}</code>
      </pre>
    )
  }

  // Done state — confirmation
  if (state === 'done') {
    return (
      <div className="ticket-editor ticket-editor--done" style={styles.container}>
        <div style={styles.doneMessage}>
          <span style={styles.doneText}>
            {tickets.length} ticket{tickets.length !== 1 ? 's' : ''} created in backlog
          </span>
          <button
            className="bde-btn bde-btn--sm btn-glass"
            style={styles.viewLink}
            onClick={() => useUIStore.getState().setView('sprint')}
          >
            View Sprint Board
          </button>
        </div>
      </div>
    )
  }

  // Editing / creating state
  return (
    <div className="ticket-editor" style={styles.container}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>
          {tickets.length} ticket{tickets.length !== 1 ? 's' : ''}
        </span>
        <button
          className="bde-btn bde-btn--sm btn-glass"
          onClick={dismiss}
          disabled={state === 'creating'}
        >
          Dismiss
        </button>
      </div>

      <div style={styles.ticketList}>
        {tickets.map((ticket, idx) => (
          <div key={ticket._id} style={styles.card}>
            <div style={styles.cardHeader}>
              <span style={styles.cardNumber}>#{idx + 1}</span>
              <div style={styles.cardActions}>
                <button
                  className="bde-btn bde-btn--sm bde-btn--icon btn-glass"
                  onClick={() => moveTicket(idx, -1)}
                  disabled={idx === 0 || state === 'creating'}
                  title="Move up"
                >
                  &#9650;
                </button>
                <button
                  className="bde-btn bde-btn--sm bde-btn--icon btn-glass"
                  onClick={() => moveTicket(idx, 1)}
                  disabled={idx === tickets.length - 1 || state === 'creating'}
                  title="Move down"
                >
                  &#9660;
                </button>
                <button
                  className="bde-btn bde-btn--sm bde-btn--icon btn-glass"
                  onClick={() => removeTicket(idx)}
                  disabled={state === 'creating'}
                  title="Remove ticket"
                  style={{ color: tokens.color.danger }}
                >
                  &#10005;
                </button>
              </div>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Title</label>
              <input
                className="bde-input__field"
                style={styles.input}
                type="text"
                value={ticket.title}
                onChange={(e) => updateTicket(idx, { title: e.target.value })}
                placeholder="Short descriptive title"
                disabled={state === 'creating'}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>
                <button
                  style={styles.promptToggle}
                  onClick={() => togglePrompt(ticket._id)}
                >
                  {expandedPrompts.has(ticket._id) ? '\u25BE' : '\u25B8'} Prompt
                </button>
              </label>
              {expandedPrompts.has(ticket._id) ? (
                <textarea
                  className="bde-textarea"
                  style={styles.textarea}
                  value={ticket.prompt}
                  onChange={(e) => updateTicket(idx, { prompt: e.target.value })}
                  placeholder="Detailed prompt for the coding agent"
                  disabled={state === 'creating'}
                  rows={4}
                />
              ) : (
                <span
                  style={styles.promptPreview}
                  onClick={() => togglePrompt(ticket._id)}
                >
                  {ticket.prompt.split('\n')[0] || '(empty)'}
                </span>
              )}
            </div>

            <div style={styles.fieldRow}>
              <div style={styles.fieldSmall}>
                <label style={styles.label}>Repo</label>
                <select
                  className="bde-input__field"
                  style={styles.select}
                  value={ticket.repo}
                  onChange={(e) => updateTicket(idx, { repo: e.target.value })}
                  disabled={state === 'creating'}
                >
                  {repoKeys.length === 0 && (
                    <option value={ticket.repo}>{ticket.repo}</option>
                  )}
                  {repoKeys.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              </div>
              <div style={styles.fieldSmall}>
                <label style={styles.label}>Priority</label>
                <input
                  className="bde-input__field"
                  style={styles.priorityInput}
                  type="number"
                  min={1}
                  max={10}
                  value={ticket.priority}
                  onChange={(e) =>
                    updateTicket(idx, { priority: Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)) })
                  }
                  disabled={state === 'creating'}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={styles.footer}>
        <button
          className="bde-btn bde-btn--sm btn-glass"
          onClick={addTicket}
          disabled={state === 'creating'}
        >
          + Add Ticket
        </button>
        <button
          className="bde-btn bde-btn--md bde-btn--primary btn-primary"
          onClick={createAll}
          disabled={state === 'creating' || tickets.length === 0}
        >
          {state === 'creating' ? 'Creating...' : `Create All (${tickets.length})`}
        </button>
      </div>
    </div>
  )
}

/** Inline styles using design tokens for consistency */
const styles: Record<string, React.CSSProperties> = {
  container: {
    margin: '8px 0',
    padding: tokens.space[3],
    background: tokens.color.surface,
    border: `1px solid ${tokens.color.border}`,
    borderRadius: tokens.radius.md,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: tokens.space[3],
  },
  headerTitle: {
    fontSize: tokens.size.lg,
    fontWeight: 600,
    color: tokens.color.text,
  },
  ticketList: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.space[2],
  },
  card: {
    padding: tokens.space[3],
    background: tokens.color.surfaceHigh,
    border: `1px solid ${tokens.color.border}`,
    borderRadius: tokens.radius.sm,
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: tokens.space[2],
  },
  cardNumber: {
    fontSize: tokens.size.sm,
    color: tokens.color.textMuted,
    fontWeight: 500,
  },
  cardActions: {
    display: 'flex',
    gap: tokens.space[1],
  },
  field: {
    marginBottom: tokens.space[2],
  },
  fieldRow: {
    display: 'flex',
    gap: tokens.space[3],
  },
  fieldSmall: {
    flex: 1,
  },
  label: {
    display: 'block',
    fontSize: tokens.size.xs,
    color: tokens.color.textMuted,
    marginBottom: tokens.space[1],
    fontWeight: 500,
  },
  input: {
    width: '100%',
    background: tokens.color.bg,
    border: `1px solid ${tokens.color.border}`,
    borderRadius: tokens.radius.sm,
    padding: `${tokens.space[1]} ${tokens.space[2]}`,
    color: tokens.color.text,
    fontSize: tokens.size.md,
    boxSizing: 'border-box' as const,
  },
  textarea: {
    width: '100%',
    background: tokens.color.bg,
    border: `1px solid ${tokens.color.border}`,
    borderRadius: tokens.radius.sm,
    padding: `${tokens.space[1]} ${tokens.space[2]}`,
    color: tokens.color.text,
    fontSize: tokens.size.sm,
    fontFamily: tokens.font.code,
    resize: 'vertical' as const,
    boxSizing: 'border-box' as const,
  },
  select: {
    width: '100%',
    background: tokens.color.bg,
    border: `1px solid ${tokens.color.border}`,
    borderRadius: tokens.radius.sm,
    padding: `${tokens.space[1]} ${tokens.space[2]}`,
    color: tokens.color.text,
    fontSize: tokens.size.md,
    boxSizing: 'border-box' as const,
  },
  priorityInput: {
    width: '100%',
    background: tokens.color.bg,
    border: `1px solid ${tokens.color.border}`,
    borderRadius: tokens.radius.sm,
    padding: `${tokens.space[1]} ${tokens.space[2]}`,
    color: tokens.color.text,
    fontSize: tokens.size.md,
    boxSizing: 'border-box' as const,
  },
  promptToggle: {
    background: 'none',
    border: 'none',
    color: tokens.color.textMuted,
    fontSize: tokens.size.xs,
    fontWeight: 500,
    cursor: 'pointer',
    padding: 0,
  },
  promptPreview: {
    display: 'block',
    fontSize: tokens.size.sm,
    color: tokens.color.textDim,
    cursor: 'pointer',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: tokens.space[3],
  },
  doneMessage: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.space[3],
    padding: tokens.space[2],
  },
  doneText: {
    fontSize: tokens.size.md,
    color: tokens.color.success,
    fontWeight: 500,
  },
  viewLink: {
    color: tokens.color.accent,
  },
}
