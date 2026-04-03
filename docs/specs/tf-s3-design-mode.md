# TF-S3: Design Mode — Conversational Spec Design with Paul

**Epic:** Ticket Flow  
**Phase:** 3 of 3  
**Depends on:** TF-S1 + TF-S2 merged  
**Status:** Ready to implement

## Problem

Designing a non-trivial feature requires thinking through tradeoffs, edge cases, file impacts, and scope before writing a spec. Today, Ryan does this alone — in his head or in a text file — then pastes the result into the modal. Design Mode makes Paul a product thinking partner, turning ticket creation into a collaborative design conversation that produces an agent-ready spec.

## Solution

Replace the Design Mode placeholder tab with a split-panel conversational UI. Left panel: chat thread with Paul. Right panel: live spec preview that updates as Paul proposes and refines the spec. Conversation is ephemeral. Output is a `{ title, spec, prompt }` that creates a Backlog task.

## Component Architecture

```
NewTicketModal (mode='design')
└── DesignModeContent (new file: DesignModeContent.tsx)
    ├── DesignChatPanel (inline — left 55% of split)
    │   ├── message list (scrollable div)
    │   │   ├── AssistantMessage (inline component)
    │   │   └── UserMessage (inline component)
    │   └── input bar (textarea + send button)
    └── DesignSpecPanel (inline — right 45% of split)
        ├── spec preview header ("Spec Preview" label + copy button)
        └── rendered markdown (same renderer as SpecDrawer uses)
```

All conversation state lives in `DesignModeContent`. No new Zustand store. No new IPC handlers.

## Data / RPC Shapes

### AI transport (existing IPC, new usage)

Uses `window.api.invokeTool('sessions_send', ...)` — same as current "Ask Paul" in NewTicketModal.

```typescript
// Call shape (matches existing invokeTool usage):
const result = await window.api.invokeTool('sessions_send', {
  sessionKey: 'bde-design-mode', // dedicated session — NOT 'main'
  message: fullConversationPrompt,
  timeoutSeconds: 45
})
const responseText: string = result?.result?.content?.[0]?.text ?? ''
```

**Why `sessions_send` not WebSocket chat:** One-shot request/response is sufficient. Design Mode responses are 2-4 paragraphs. No streaming needed in v1. Zero new infrastructure required.

**Why `sessionKey: 'bde-design-mode'`:** Isolates conversation from the main agent session. The gateway creates this session lazily on first message. Ephemeral — Design Mode conversations are never persisted.

### Spec extraction from responses

Paul is instructed to wrap the spec in a `~~~spec` fence. Extraction:

```typescript
function extractSpecFromResponse(text: string): string | null {
  const match = text.match(/~~~spec\n([\s\S]*?)~~~/s)
  return match?.[1]?.trim() ?? null
}
```

### Title extraction from responses

Paul is instructed to include a title suggestion in his spec proposal. Extraction:

```typescript
function extractTitleFromResponse(text: string): string | null {
  const match = text.match(/(?:Ticket Title|Title|Suggested title):\s*["']?([^\n"']+)["']?/i)
  return match?.[1]?.trim() ?? null
}
```

## Conversation State

```typescript
interface DesignMessage {
  role: 'user' | 'assistant'
  content: string // raw markdown/text — rendered in the UI
  timestamp: number
}

// In DesignModeContent component state:
const [messages, setMessages] = useState<DesignMessage[]>([OPENING_MESSAGE])
const [specDraft, setSpecDraft] = useState<string>('')
const [suggestedTitle, setSuggestedTitle] = useState<string>('')
const [input, setInput] = useState<string>('')
const [sending, setSending] = useState<boolean>(false)
```

**`OPENING_MESSAGE`** — static, no AI call:

```typescript
const OPENING_MESSAGE: DesignMessage = {
  role: 'assistant',
  content:
    "What are you thinking about building? Describe the feature or problem in your own words — I'll help shape the spec.",
  timestamp: Date.now()
}
```

## System Prompt

```typescript
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
```

## Full Prompt Construction (per message sent)

```typescript
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
```

## Exact Component Implementation

### New File: `src/renderer/src/components/sprint/DesignModeContent.tsx`

```typescript
import { useState, useRef, useEffect, useCallback } from 'react'

interface DesignMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

interface DesignModeContentProps {
  repo: string
  priority: number
  onSave: (args: { title: string; spec: string; prompt: string; repo: string; priority: number }) => void
  onClose: () => void
}

const OPENING_MESSAGE: DesignMessage = {
  role: 'assistant',
  content: "What are you thinking about building? Describe the feature or problem in your own words — I'll help shape the spec.",
  timestamp: Date.now(),
}

export function DesignModeContent({ repo, priority, onSave, onClose }: DesignModeContentProps) {
  const [messages, setMessages] = useState<DesignMessage[]>([OPENING_MESSAGE])
  const [specDraft, setSpecDraft] = useState('')
  const [suggestedTitle, setSuggestedTitle] = useState('')
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const chatBottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const extractSpec = useCallback((text: string): string | null => {
    const match = text.match(/~~~spec\n([\s\S]*?)~~~/s)
    return match?.[1]?.trim() ?? null
  }, [])

  const extractTitle = useCallback((text: string): string | null => {
    const match = text.match(/(?:Ticket Title|Title|Suggested title):\s*["']?([^\n"']+)["']?/i)
    return match?.[1]?.trim() ?? null
  }, [])

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
      const result = await window.api.invokeTool('sessions_send', {
        sessionKey: 'bde-design-mode',
        message: fullPrompt,
        timeoutSeconds: 45,
      })

      const responseText: string = result?.result?.content?.[0]?.text ?? ''
      if (!responseText) throw new Error('Empty response')

      setMessages((prev) => [...prev, { role: 'assistant', content: responseText, timestamp: Date.now() }])

      // Extract spec if present
      const spec = extractSpec(responseText)
      if (spec) {
        setSpecDraft(spec)
        // Extract suggested title from spec
        const title = extractTitle(spec)
        if (title && !suggestedTitle) setSuggestedTitle(title)
      }
    } catch {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: "Sorry, I couldn't reach the gateway. Check your connection and try again.",
        timestamp: Date.now(),
      }])
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }, [input, sending, messages, repo, extractSpec, extractTitle, suggestedTitle])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }, [sendMessage])

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
                <span>●</span><span>●</span><span>●</span>
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
            →
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
      </div>
    </div>
  )
}
```

**Note on `renderMarkdown`:** Import it from wherever SpecDrawer currently imports it. If it's inline in SpecDrawer, extract it to `src/renderer/src/lib/render-markdown.ts` first, then import from both places.

**Note on `buildDesignSystemPrompt` and `buildFullPrompt`:** Define these as module-level functions in `DesignModeContent.tsx` (not inside the component). See the exact implementations in the Data / RPC Shapes section above.

### Changes to `NewTicketModal.tsx` — Wire Design Mode

Replace the placeholder `{mode === 'design' && (...)}` block from TF-S2 with:

```tsx
{
  mode === 'design' && (
    <DesignModeContent
      repo={repo}
      priority={priority}
      onSave={(args) => {
        onCreate(args)
        onClose()
      }}
      onClose={() => {
        if (window.confirm('Discard this design conversation?')) onClose()
      }}
    />
  )
}
```

Also update the footer: when `mode === 'design'`, **hide** the Cancel/Save buttons entirely. `DesignModeContent` handles its own save trigger. Add:

```tsx
{
  mode !== 'design' && (
    <div className="new-ticket-modal__footer">
      <button className="btn btn--ghost" onClick={handleClose}>
        Cancel
      </button>
      <button className="btn btn--primary" onClick={handleSubmit} disabled={!title.trim()}>
        {mode === 'quick' ? '⚡ Save — Paul writes the spec' : 'Save to Backlog'}
      </button>
    </div>
  )
}
```

Update the modal close (ESC handler and ✕ button) to check if design mode has a conversation in progress:

```typescript
const handleClose = useCallback(() => {
  if (mode === 'design') {
    // DesignModeContent handles its own discard confirmation
    return
  }
  onClose()
}, [mode, onClose])
```

## CSS — Design Mode Layout

Append to `sprint.css`:

```css
/* ─── Design Mode ──────────────────────────────────────────────── */

.design-mode {
  display: grid;
  grid-template-columns: 55% 45%;
  height: 520px;
  overflow: hidden;
}

/* Chat panel */
.design-mode__chat {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--bde-border);
  overflow: hidden;
}

.design-mode__messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.design-mode__message {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 100%;
}

.design-mode__message--user {
  align-items: flex-end;
}

.design-mode__message--assistant {
  align-items: flex-start;
}

.design-mode__message-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--bde-text-dim);
}

.design-mode__message-content {
  margin: 0;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  max-width: 90%;
  white-space: pre-wrap;
}

.design-mode__message--user .design-mode__message-content {
  background: color-mix(in srgb, var(--bde-accent) 20%, transparent);
  border: 1px solid color-mix(in srgb, var(--bde-accent) 40%, transparent);
  color: var(--bde-text);
}

.design-mode__message--assistant .design-mode__message-content {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--bde-border);
  color: var(--bde-text);
}

/* Typing indicator */
.design-mode__typing {
  display: flex;
  gap: 4px;
  align-items: center;
}

.design-mode__typing span {
  animation: typing-dot 1.2s ease-in-out infinite;
  opacity: 0.3;
  font-size: 16px;
  line-height: 1;
}

.design-mode__typing span:nth-child(2) {
  animation-delay: 0.2s;
}
.design-mode__typing span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing-dot {
  0%,
  100% {
    opacity: 0.3;
  }
  50% {
    opacity: 1;
  }
}

/* Input bar */
.design-mode__input-bar {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--bde-border);
  align-items: flex-end;
}

.design-mode__input {
  flex: 1;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--bde-border);
  border-radius: 8px;
  color: var(--bde-text);
  font-size: 13px;
  line-height: 1.4;
  resize: none;
  outline: none;
  font-family: inherit;
}

.design-mode__input:focus {
  border-color: var(--bde-accent);
}

.design-mode__input:disabled {
  opacity: 0.5;
}

.design-mode__send-btn {
  padding: 8px 14px;
  background: var(--bde-accent);
  border: none;
  border-radius: 8px;
  color: white;
  font-size: 16px;
  cursor: pointer;
  flex-shrink: 0;
  transition: opacity 0.15s ease;
}

.design-mode__send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Spec preview panel */
.design-mode__spec-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.design-mode__spec-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--bde-border);
  flex-shrink: 0;
}

.design-mode__spec-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--bde-text-dim);
}

.design-mode__copy-btn {
  font-size: 11px;
  background: none;
  border: 1px solid var(--bde-border);
  border-radius: 4px;
  color: var(--bde-text-dim);
  padding: 3px 8px;
  cursor: pointer;
}

.design-mode__copy-btn:hover {
  color: var(--bde-text);
  border-color: var(--bde-text-dim);
}

.design-mode__spec-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.design-mode__spec-empty {
  color: var(--bde-text-dim);
  font-size: 13px;
  text-align: center;
  margin-top: 60px;
}

/* Override modal width for design mode — needs more space */
.glass-modal:has(.design-mode) {
  width: min(900px, 95vw);
  max-height: 720px;
}
```

**Note on `.glass-modal:has(.design-mode)`:** `:has()` is supported in Chromium 105+ (the app is Electron/Chromium 134+). This is safe to use. It widens the modal only when Design Mode is active.

## Files to Change

| File                                                       | What Changes                                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/components/sprint/DesignModeContent.tsx` | **NEW** — full implementation                                                                           |
| `src/renderer/src/components/sprint/NewTicketModal.tsx`    | Replace Design placeholder with `<DesignModeContent>`, hide footer in design mode, update close handler |
| `src/renderer/src/assets/sprint.css`                       | Design Mode layout CSS                                                                                  |
| `src/renderer/src/lib/render-markdown.ts`                  | **NEW** if needed — extract `renderMarkdown()` from SpecDrawer if it's currently inline there           |
| `src/renderer/src/components/sprint/SpecDrawer.tsx`        | Update import to use extracted `render-markdown.ts` (if extracting)                                     |

## Out of Scope

- Streaming Paul's response text (v2 — requires WebSocket chat path)
- Repo context injection (file tree in Paul's system prompt) — v2
- Persisting design conversations — ephemeral by design in v1
- "Resume last conversation" — v2
- Section-by-section refinement (granular highlighting) — v2
- Spec quality scoring — v2

## Test Plan

1. Open modal → click "Design with Paul" tab
2. Verify Paul's opening message appears without any AI call (static)
3. Type "I want to add a cost tracking dashboard" → send
4. Verify Paul asks 2-3 clarifying questions (not a spec yet)
5. Answer questions → verify Paul produces a spec inside ~~~spec fence
6. Verify spec appears in right panel (rendered markdown)
7. Request a change: "Add a note about debouncing the refresh" → verify spec updates in right panel
8. Click "Save Spec to Backlog" → verify task appears in Backlog with correct spec
9. Start a conversation, then close modal → verify "Discard?" confirm dialog appears
10. Verify modal widens for Design Mode and normal size for Quick/Template

## PR Command

```bash
git add -A && git commit -m "feat: Design Mode — conversational spec design with Paul (split-panel chat + live spec preview)" && git push origin HEAD && gh api repos/RyanJBirkeland/BDE/pulls --method POST -f title="feat: Design Mode — co-design features with Paul in a conversational split-panel UI" -f body="Implements the Design Mode tab in NewTicketModal. Split-panel layout: chat with Paul on the left, live spec preview on the right. Paul asks clarifying questions then proposes a spec. User can refine conversationally. Save creates a Backlog task with the finalized spec. Uses dedicated ephemeral session (bde-design-mode) to avoid polluting main agent history." -f head="\$(git branch --show-current)" -f base=main --jq ".html_url"
```
