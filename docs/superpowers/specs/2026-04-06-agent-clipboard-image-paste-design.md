# Agent Clipboard Image Paste — Design Spec

**Date:** 2026-04-06
**Status:** Approved

## Goal

Allow users to paste images from the clipboard (Cmd+V) directly into the agent CommandBar. A thumbnail preview appears above the input so users can confirm the image before sending. On Enter, the image travels alongside the text message to the agent.

## Background

The attachment infrastructure already exists in the codebase:

- `src/renderer/src/lib/attachments.ts` — `buildLocalAgentMessage(text, attachments)` formats text + image as a single string embedding base64 markdown
- `src/shared/types.ts` — `Attachment` type with `path`, `name`, `type`, `data` (base64), `mimeType`, `preview` (data-URL)

The only missing pieces are: paste event handling in the UI, thumbnail rendering, and formatting the attachment into the message string before the steer IPC call.

## User Flow

1. User types or focuses the CommandBar input
2. User copies an image (screenshot, browser image, etc.) then presses Cmd+V
3. A thumbnail strip appears above the input showing the image (~64×64px) with an ✕ remove button
4. User types their message (optional — can send with image only)
5. User presses Enter — image + text are sent to the agent as a formatted string
6. Thumbnail clears; CommandBar returns to normal state
7. Pasting a second image replaces the first (single image at a time)
8. Non-image clipboard content (text) passes through to the textarea normally

## Architecture

### No IPC changes needed

ALL formatting happens in the renderer before the IPC call. `buildLocalAgentMessage(text, [attachment])` is called in `AgentsView.handleSteer` when an attachment is present, producing a single string that is passed to `window.api.steerAgent(selectedId, formattedMessage)`. The `agent:steer` channel signature remains `{ agentId: string; message: string }`.

`buildLocalAgentMessage` lives in `src/renderer/src/lib/attachments.ts` (renderer-only). This architecture keeps it there — no main-process import required.

### Data flow (authoritative)

Attachment state lives **locally in `CommandBar`**. It travels upward through callback parameters only — no prop drilling down:

```
CommandBar (local state: attachment)
  → onSend(message: string, attachment?: Attachment)   ← NEW: carries attachment
  → AgentConsole.handleSteer(message, attachment?)
  → onSteer(message: string, attachment?: Attachment)  ← prop, updated signature
  → AgentsView.handleSteer(message, attachment?)
  → buildLocalAgentMessage(message, [attachment])      ← called only when attachment present
  → window.api.steerAgent(selectedId, formattedMessage)
```

All intermediate layers pass a single optional `Attachment` (not `Attachment[]`) — conversion to array happens only at the `buildLocalAgentMessage` call site in `AgentsView`.

## Files to Change

| File                                                                 | Change                                                                                                                                                                                          |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/components/agents/CommandBar.tsx`                  | Add `onPaste` handler, `attachment` state, thumbnail strip UI, fix submit guard for image-only sends, update `onSend` signature to `(message: string, attachment?: Attachment) => void`         |
| `src/renderer/src/components/agents/AgentConsole.tsx`                | Update `onSteer` prop and internal `handleSteer` to `(message: string, attachment?: Attachment) => void`; thread attachment from `CommandBar.onSend` through to `onSteer` caller                |
| `src/renderer/src/views/AgentsView.tsx`                              | Update `handleSteer` to accept `attachment?`; call `buildLocalAgentMessage(message, [attachment])` when attachment present; other command call sites (`/focus`, `/test`, etc.) remain unchanged |
| `src/renderer/src/components/agents/__tests__/CommandBar.test.tsx`   | Add paste tests; test image-only submit; test ✕ button                                                                                                                                          |
| `src/renderer/src/components/agents/__tests__/AgentConsole.test.tsx` | Update mock and existing assertion to match new `onSend(message, attachment?)` signature                                                                                                        |

No main-process or IPC changes required.

## Implementation Details

### CommandBar

**New state:**

```typescript
const [attachment, setAttachment] = useState<Attachment | null>(null)
```

**Updated `onSend` prop signature:**

```typescript
onSend: (message: string, attachment?: Attachment) => void
```

(Previously `(message: string) => void`)

**Submit guard fix** — allow image-only sends:

```typescript
// Before:
if (!trimmed || disabled) return
// After:
if ((!trimmed && !attachment) || disabled) return
```

**Updated submit call:**

```typescript
onSend(trimmed, attachment ?? undefined)
setAttachment(null)
setValue('')
```

**Paste handler** (on `<input>` element — `React.ClipboardEvent<HTMLInputElement>`):

```typescript
const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
  const items = Array.from(e.clipboardData.items)
  const imageItem = items.find((item) => item.type.startsWith('image/'))
  if (!imageItem) return // non-image: default paste through
  e.preventDefault()
  const blob = imageItem.getAsFile()
  if (!blob) return
  if (blob.size > 5 * 1024 * 1024) {
    toast.error('Image too large (max 5MB)')
    return
  }
  const reader = new FileReader()
  reader.onerror = () => toast.error('Failed to read clipboard image')
  reader.onload = () => {
    const dataUrl = reader.result as string
    setAttachment({
      path: '',
      name: `paste-${Date.now()}.png`,
      type: 'image',
      mimeType: blob.type,
      data: dataUrl.split(',')[1],
      preview: dataUrl
    })
  }
  reader.readAsDataURL(blob)
}
```

Note: `blob.size` is checked synchronously before the `FileReader` is instantiated, avoiding reading large binaries into memory.

**Thumbnail strip** — rendered above the input, shown when `attachment !== null`:

```tsx
{
  attachment && (
    <div className="command-bar-attachment-strip">
      <img src={attachment.preview} alt="attachment preview" />
      <button onClick={() => setAttachment(null)}>✕</button>
    </div>
  )
}
```

Small fixed-size preview (~64×64px), dark background, thin border — consistent with neon terminal aesthetic.

### AgentConsole

Internal `handleSteer` signature update:

```typescript
const handleSteer = (message: string, attachment?: Attachment) => {
  // existing command routing (/stop, /retry, etc.) stays the same — commands have no attachment
  onSteer(message, attachment)
}
```

`CommandBar` is called with `onSend={handleSteer}` — no new props to `CommandBar`.

`onSteer` prop type:

```typescript
onSteer: (message: string, attachment?: Attachment) => void
```

Existing test in `AgentConsole.test.tsx` at the `expect(onSteer).toHaveBeenCalledWith('test message')` assertion: update to `toHaveBeenCalledWith('test message', undefined)`.

### AgentsView

```typescript
const handleSteer = (message: string, attachment?: Attachment) => {
  if (!selectedId) return
  const formattedMessage = attachment ? buildLocalAgentMessage(message, [attachment]) : message
  window.api.steerAgent(selectedId, formattedMessage)
}
```

Import `buildLocalAgentMessage` from `../../lib/attachments` and `Attachment` from `../../../../shared/types`.

Other command handlers that call `window.api.steerAgent(selectedId, ...)` directly remain unchanged — they pass text strings with no attachment.

`AgentsView` tests: test `handleSteer` as a direct function unit test (not via component render, since `AgentConsole` is mocked as a static div in the existing test file). Verify `buildLocalAgentMessage` is called when attachment present and not called for text-only steers.

### `buildLocalAgentMessage` with empty text

When the user sends image-only (no text), `buildLocalAgentMessage('', [attachment])` will produce output starting with empty lines before the image markdown. This is acceptable — the agent receives the image regardless. No special handling needed.

## Testing

### CommandBar unit tests

- Paste image → attachment state set, thumbnail shown
- Paste text (non-image) → attachment state unchanged, text in input
- ✕ button → attachment cleared
- Submit with image + text → `onSend('text', attachment)` called, attachment cleared
- Submit with image only (no text) → `onSend('', attachment)` called (not blocked)
- Submit with text only (no image) → `onSend('text', undefined)` called
- Paste image > 5MB → error toast, no attachment set
- FileReader error → error toast
- Paste second image → first replaced

### AgentConsole unit tests

- Update `expect(onSteer).toHaveBeenCalledWith('test message')` → `toHaveBeenCalledWith('test message', undefined)`
- New: `onSend` called with attachment → `onSteer` called with same attachment

### AgentsView unit tests (direct function tests, not rendered)

- `handleSteer('message', attachment)` → `buildLocalAgentMessage` called, `steerAgent` called with formatted string
- `handleSteer('message', undefined)` → `buildLocalAgentMessage` not called, `steerAgent` called with raw message

## Constraints

- **Single image at a time** — second paste replaces first
- **Images only** — non-image clipboard content passes through to textarea as normal text
- **5MB limit** — checked synchronously on `blob.size` before reading; error toast shown
- **No new npm packages** — `FileReader` is a standard browser API
- **No IPC changes** — formatting happens in renderer, steer channel unchanged

## Out of Scope

- File picker button (can be added later)
- Drag-and-drop
- Multiple simultaneous images
- Displaying pasted images in the agent console event stream
