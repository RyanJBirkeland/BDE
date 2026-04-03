# Feature Spec: File & Image Attachments in Chat

**Date:** 2026-03-16
**Requested by:** Ryan
**Area:** SessionsView → ChatPane / MessageInput

---

## Problem

Currently there's no way to share images, screenshots, or files with an agent in the Sessions chat view. Ryan wants to drop a screenshot of a bug or a file into the chat and have it sent as context to the agent — the same way you'd attach something in any modern chat app.

---

## How Attachments Work Per Agent Type

BDE has two agent types. Each needs different attachment handling:

### Local agents (Claude Code CLI, spawned via `local-agents.ts`)

- **Images:** Claude Code CLI supports `--image <path>` flag. For mid-conversation image sharing, we need to include the image inline. Best approach: convert to base64 and prepend to the stdin message as a markdown image reference, or pass as a follow-up `--image` flag on next invocation.
- **Text/code files:** Read content, wrap in a fenced code block with filename, prepend to stdin message.
- **Other files:** Read as text if readable; otherwise show as file chip with path reference.

### Gateway sessions (OpenClaw sessions via WebSocket/HTTP)

- Images and files can be base64-encoded and sent as part of the message payload to the gateway API.
- Gateway already handles multimodal content (images passed to Claude API).

---

## UI Design

### MessageInput changes

Add an **attachment button** (paperclip icon) to the left of the send button in `MessageInput.tsx`.

```
┌─────────────────────────────────────────────────────┐
│  📎  Type a message...                          [↑]  │
└─────────────────────────────────────────────────────┘
```

Clicking 📎 opens native file dialog (`dialog.showOpenDialog` via IPC).
Supported types: images (png, jpg, gif, webp), text files (ts, tsx, js, md, txt, json, py, etc.)

### Attachment preview chips (above input, below chat)

After selecting a file, show a chip row above the input:

```
┌──────────────────────────────────────┐
│ [🖼 screenshot.png ✕] [📄 types.ts ✕] │
└──────────────────────────────────────┘
│  📎  Type a message...          [↑]  │
```

- Image files: show thumbnail preview (32×32px)
- Text files: show filename chip with file icon
- Click ✕ to remove before sending

### In chat bubble

When message is sent with attachments:

- Images: render inline as `<img>` with max-width 100% in the message bubble
- Text files: show as a glass-styled code block preceded by `📄 filename.ts`

---

## Implementation Plan

### New IPC channels needed

```typescript
// In preload/index.ts
openFileDialog: (opts?: { filters?: FileFilter[] }) => Promise<string[] | null>
readFileAsBase64: (path: string) => Promise<{ data: string; mimeType: string; name: string }>
readFileAsText: (path: string) => Promise<{ content: string; name: string }>
```

### Main process handlers (`src/main/handlers/fs-handlers.ts` or `src/main/fs.ts`)

```typescript
// openFileDialog — uses Electron dialog API
safeHandle('open-file-dialog', async (_e, opts) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: opts?.filters ?? [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      {
        name: 'Text Files',
        extensions: ['ts', 'tsx', 'js', 'jsx', 'md', 'txt', 'json', 'py', 'sh', 'css', 'html']
      },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  return result.canceled ? null : result.filePaths
})

// readFileAsBase64 — for images
safeHandle('read-file-as-base64', async (_e, filePath: string) => {
  validateSafePath(filePath) // no path traversal
  const data = await fs.readFile(filePath)
  const ext = path.extname(filePath).toLowerCase().replace('.', '')
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp'
  }
  return {
    data: data.toString('base64'),
    mimeType: mimeMap[ext] ?? 'application/octet-stream',
    name: path.basename(filePath)
  }
})

// readFileAsText — for code/text files
safeHandle('read-file-as-text', async (_e, filePath: string) => {
  validateSafePath(filePath) // no path traversal
  const content = await fs.readFile(filePath, 'utf-8')
  return { content, name: path.basename(filePath) }
})
```

### Attachment state in MessageInput

```typescript
type Attachment = {
  path: string
  name: string
  type: 'image' | 'text'
  preview?: string // base64 data URL for images
  content?: string // text content for text files
}

// State in MessageInput component
const [attachments, setAttachments] = useState<Attachment[]>([])
```

### Sending with attachments

**Local agents (stdin):**

```
// Build the message to send via stdin
let fullMessage = ''

// Prepend text file contents
for (const att of textAttachments) {
  fullMessage += `\`\`\`${getLanguage(att.name)}\n// ${att.name}\n${att.content}\n\`\`\`\n\n`
}

// Append user message
fullMessage += message

// For images: include as markdown reference with base64
for (const att of imageAttachments) {
  fullMessage += `\n\n![${att.name}](data:${att.mimeType};base64,${att.data})`
}

window.api.sendToAgent(pid, fullMessage)
```

**Gateway sessions:**
Build message payload with `content` array (Anthropic multimodal format):

```typescript
;[
  { type: 'text', text: message },
  ...imageAttachments.map((a) => ({
    type: 'image',
    source: { type: 'base64', media_type: a.mimeType, data: a.data }
  }))
]
```

---

## Files to Change

| File                                                    | Action     | What                                                                                    |
| ------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| `src/renderer/src/components/sessions/MessageInput.tsx` | **MODIFY** | Add 📎 button, attachment state, chip row, modify send to include attachments           |
| `src/renderer/src/components/sessions/ChatThread.tsx`   | **MODIFY** | Render image attachments inline in message bubbles; render text file code blocks        |
| `src/preload/index.ts`                                  | **MODIFY** | Add `openFileDialog`, `readFileAsBase64`, `readFileAsText`                              |
| `src/main/fs.ts`                                        | **MODIFY** | Add handlers for the 3 new IPC channels                                                 |
| `src/renderer/src/assets/sessions.css`                  | **MODIFY** | Styles for attachment chips, chip thumbnail, attachment preview row                     |
| `src/shared/types.ts`                                   | **MODIFY** | Add `Attachment` type, update `SendMessageArgs` to include `attachments?: Attachment[]` |

---

## Security Notes

- **Path validation required** on `readFileAsBase64` and `readFileAsText` — do NOT allow arbitrary path traversal
- **File size limit:** reject files > 10MB (images > 5MB)
- **MIME type validation:** verify actual file header, not just extension
- **No execution:** files are read-only, never executed

---

## Success Criteria

- [ ] 📎 button in MessageInput opens native file picker
- [ ] Images show as thumbnail chips before sending
- [ ] Text files show as filename chips before sending
- [ ] Multiple attachments supported (up to 5)
- [ ] Clicking ✕ on chip removes attachment
- [ ] Sending message with image attachment renders image inline in chat bubble
- [ ] Sending message with text file renders fenced code block with filename
- [ ] Works for both local agents and gateway sessions
- [ ] Files > 10MB rejected with toast error
- [ ] Path validation prevents traversal attacks
- [ ] npm test passes

---

## Dependencies

- None — this is standalone. Can be built independently of other in-progress work.
- Assumes `src/main/fs.ts` exists (it does — path traversal fix from AX epic may touch same file, coordinate)

---

## Estimated Size: L
