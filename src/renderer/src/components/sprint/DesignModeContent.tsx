import { useState, useRef, useEffect, useCallback } from 'react'
import { renderMarkdown } from '../../lib/render-markdown'

interface DesignMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

interface DesignModeContentProps {
  repo: string
  priority: number
  onSave: (args: { title: string; spec: string; prompt: string; repo: string; priority: number }) => void
}

const OPENING_MESSAGE: DesignMessage = {
  role: 'assistant',
  content:
    "What are you thinking about building? Describe the feature or problem in your own words — I'll help shape the spec.",
  timestamp: Date.now(),
}

function buildDesignSystemPrompt(repo: string): string {
  return `You are Paul, a senior product engineer at BDE (an AI agent IDE for solo developers).

Your job: help the user design a coding task, then produce an agent-executable spec.

CONVERSATION FLOW:
1. After the user's first message: ask 2-3 targeted clarifying questions. Focus on:
   - Scope (what's in, what's explicitly out)
   - Data model (types, schemas, API shapes involved)
   - Files affected (which specific files in the ${repo} repo)
   - Edge cases or failure modes
   Ask all questions in one message. Do NOT ask one question at a time.
2. After the user answers: propose a full spec. Include it in a ~~~spec fence.
3. After the spec: ask "Does this look right? Anything to add or change?"
4. On refinement requests: output the FULL updated spec in a new ~~~spec fence.

SPEC FORMAT (inside ~~~spec fence):
~~~spec
Ticket Title: [concise, verb-first title]

## Problem
[what's broken or missing — 2-3 sentences max]

## Solution
[what will be built — be specific]

## Files to Change
- path/to/file.tsx — [what changes]
- path/to/other.ts — [what changes]

## Out of Scope
- [what is explicitly NOT being built]
~~~

RULES:
- Be concise. 2-3 sentences per section max.
- Name exact file paths relative to the ${repo} repo root.
- "Files to Change" must list specific files, not "update the component."
- Do NOT pad responses. If you're proposing a spec, just propose it.
- Do NOT ask for confirmation before proceeding.
- Target repo: ${repo}`
}

function buildFullPrompt(
  systemPrompt: string,
  messages: DesignMessage[],
  newUserMessage: string
): string {
  const history = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Paul'}: ${m.content}`)
    .join('\n\n')

  return `${systemPrompt}

---

Conversation history:
${history}

User: ${newUserMessage}

Paul:`
}

function extractSpec(text: string): string | null {
  const match = text.match(/~~~spec\n([\s\S]*?)~~~/s)
  return match?.[1]?.trim() ?? null
}

function extractTitle(text: string): string | null {
  const match = text.match(/(?:Ticket Title|Title|Suggested title):\s*["']?([^\n"']+)["']?/i)
  return match?.[1]?.trim() ?? null
}

export function DesignModeContent({ repo, priority, onSave }: DesignModeContentProps) {
  const [messages, setMessages] = useState<DesignMessage[]>([OPENING_MESSAGE])
  const [specDraft, setSpecDraft] = useState('')
  const [suggestedTitle, setSuggestedTitle] = useState('')
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const chatBottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = useCallback(async () => {
    const userText = input.trim()
    if (!userText || sending) return

    const newUserMessage: DesignMessage = { role: 'user', content: userText, timestamp: Date.now() }
    const updatedMessages = [...messages, newUserMessage]
    setMessages(updatedMessages)
    setInput('')
    setSending(true)

    const systemPrompt = buildDesignSystemPrompt(repo)
    const fullPrompt = buildFullPrompt(systemPrompt, messages, userText)

    try {
      const result = (await window.api.invokeTool('sessions_send', {
        sessionKey: 'bde-design-mode',
        message: fullPrompt,
        timeoutSeconds: 45,
      })) as {
        ok?: boolean
        result?: { content?: Array<{ type: string; text: string }> }
      } | null

      const responseText: string = result?.result?.content?.[0]?.text ?? ''
      if (!responseText) throw new Error('Empty response')

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: responseText, timestamp: Date.now() },
      ])

      const spec = extractSpec(responseText)
      if (spec) {
        setSpecDraft(spec)
        const title = extractTitle(spec)
        if (title) setSuggestedTitle(title)
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: "Sorry, I couldn't reach the gateway. Check your connection and try again.",
          timestamp: Date.now(),
        },
      ])
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }, [input, sending, messages, repo])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
      }
    },
    [sendMessage]
  )

  const handleSave = useCallback(() => {
    const finalTitle = suggestedTitle || 'Untitled feature'
    onSave({
      title: finalTitle,
      spec: specDraft,
      prompt: specDraft,
      repo,
      priority,
    })
  }, [suggestedTitle, specDraft, repo, priority, onSave])

  return (
    <div className="design-mode">
      {/* Left: Chat panel */}
      <div className="design-mode__chat">
        <div className="design-mode__messages">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`design-mode__message design-mode__message--${msg.role}`}
            >
              {msg.role === 'assistant' && (
                <span className="design-mode__message-label">Paul</span>
              )}
              <p className="design-mode__message-content">{msg.content}</p>
            </div>
          ))}
          {sending && (
            <div className="design-mode__message design-mode__message--assistant">
              <span className="design-mode__message-label">Paul</span>
              <p className="design-mode__message-content design-mode__typing">
                <span>●</span>
                <span>●</span>
                <span>●</span>
              </p>
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>

        <div className="design-mode__input-bar">
          <textarea
            ref={inputRef}
            className="design-mode__input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your response... (Enter to send, Shift+Enter for newline)"
            rows={3}
            disabled={sending}
          />
          <button
            className="design-mode__send-btn"
            onClick={sendMessage}
            disabled={!input.trim() || sending}
          >
            &rarr;
          </button>
        </div>
      </div>

      {/* Right: Spec preview panel */}
      <div className="design-mode__spec-panel">
        <div className="design-mode__spec-header">
          <span className="design-mode__spec-label">Spec Preview</span>
          {specDraft && (
            <button
              className="design-mode__copy-btn"
              onClick={() => navigator.clipboard.writeText(specDraft)}
            >
              Copy
            </button>
          )}
        </div>
        <div className="design-mode__spec-content">
          {specDraft ? (
            <div
              className="spec-drawer__rendered"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(specDraft) }}
            />
          ) : (
            <p className="design-mode__spec-empty">
              Spec will appear here as Paul drafts it.
            </p>
          )}
        </div>
        {specDraft && (
          <div className="design-mode__spec-footer">
            <button className="btn btn--primary" onClick={handleSave}>
              Save Spec to Backlog
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
