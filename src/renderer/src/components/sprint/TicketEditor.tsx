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
import { usePanelLayoutStore } from '../../stores/panelLayout'
import { toast } from '../../stores/toasts'

export interface TicketDraft {
  title: string
  prompt: string
  repo: string
  priority: number
}

interface TicketWithId extends TicketDraft {
  _id: string
  created?: boolean // Track if ticket was successfully created
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
      priority: priority ?? 1
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
      { _id: crypto.randomUUID(), title: '', prompt: '', repo: repoKeys[0] ?? '', priority: 3 }
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
    const results: Array<{ id: string; success: boolean; error?: string }> = []
    let successCount = 0

    for (const ticket of tickets) {
      // Skip already created tickets
      if (ticket.created) {
        successCount++
        continue
      }

      try {
        const { _id, created: _, ...ticketData } = ticket
        await useSprintTasks.getState().createTask({
          title: ticketData.title,
          repo: ticketData.repo,
          prompt: ticketData.prompt,
          priority: ticketData.priority,
          spec: ticketData.prompt
        })

        // Mark as created
        setTickets((prev) => prev.map((t) => (t._id === _id ? { ...t, created: true } : t)))
        successCount++
        results.push({ id: _id, success: true })
      } catch (err) {
        results.push({
          id: ticket._id,
          success: false,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }

    const failCount = tickets.length - successCount
    if (failCount === 0) {
      toast.success(`${tickets.length} ticket${tickets.length !== 1 ? 's' : ''} created in backlog`)
      setState('done')
    } else {
      toast.error(`${successCount} succeeded, ${failCount} failed. Fix errors and retry.`)
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
      <div className="ticket-editor ticket-editor--done">
        <div className="ticket-editor__done-message">
          <span className="ticket-editor__done-text">
            {tickets.length} ticket{tickets.length !== 1 ? 's' : ''} created in backlog
          </span>
          <button
            className="bde-btn bde-btn--sm btn-glass ticket-editor__btn-accent"
            onClick={() => usePanelLayoutStore.getState().setView('sprint')}
          >
            View Sprint Board
          </button>
        </div>
      </div>
    )
  }

  // Editing / creating state
  return (
    <div className="ticket-editor">
      <div className="ticket-editor__header">
        <span className="ticket-editor__title">
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

      <div className="ticket-editor__list">
        {tickets.map((ticket, idx) => (
          <div key={ticket._id} className="ticket-editor__card">
            <div className="ticket-editor__card-header">
              <span className="ticket-editor__card-number">#{idx + 1}</span>
              <div className="ticket-editor__card-actions">
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
                  className="bde-btn bde-btn--sm bde-btn--icon btn-glass ticket-editor__btn-danger"
                  onClick={() => removeTicket(idx)}
                  disabled={state === 'creating'}
                  title="Remove ticket"
                >
                  &#10005;
                </button>
              </div>
            </div>

            <div className="ticket-editor__field">
              <label className="ticket-editor__label">Title</label>
              <input
                className="bde-input__field ticket-editor__input"
                type="text"
                value={ticket.title}
                onChange={(e) => updateTicket(idx, { title: e.target.value })}
                placeholder="Short descriptive title"
                disabled={state === 'creating'}
              />
            </div>

            <div className="ticket-editor__field">
              <label className="ticket-editor__label">
                <button
                  className="ticket-editor__prompt-toggle"
                  onClick={() => togglePrompt(ticket._id)}
                >
                  {expandedPrompts.has(ticket._id) ? '\u25BE' : '\u25B8'} Prompt
                </button>
              </label>
              {expandedPrompts.has(ticket._id) ? (
                <textarea
                  className="bde-textarea ticket-editor__textarea"
                  value={ticket.prompt}
                  onChange={(e) => updateTicket(idx, { prompt: e.target.value })}
                  placeholder="Detailed prompt for the coding agent"
                  disabled={state === 'creating'}
                  rows={4}
                />
              ) : (
                <span
                  className="ticket-editor__prompt-preview"
                  onClick={() => togglePrompt(ticket._id)}
                >
                  {ticket.prompt.split('\n')[0] || '(empty)'}
                </span>
              )}
            </div>

            <div className="ticket-editor__field-row">
              <div className="ticket-editor__field-small">
                <label className="ticket-editor__label">Repo</label>
                <select
                  className="bde-input__field ticket-editor__select"
                  value={ticket.repo}
                  onChange={(e) => updateTicket(idx, { repo: e.target.value })}
                  disabled={state === 'creating'}
                >
                  {repoKeys.length === 0 && <option value={ticket.repo}>{ticket.repo}</option>}
                  {repoKeys.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ticket-editor__field-small">
                <label className="ticket-editor__label">Priority</label>
                <input
                  className="bde-input__field ticket-editor__priority-input"
                  type="number"
                  min={1}
                  max={10}
                  value={ticket.priority}
                  onChange={(e) =>
                    updateTicket(idx, {
                      priority: Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1))
                    })
                  }
                  disabled={state === 'creating'}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="ticket-editor__footer">
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
