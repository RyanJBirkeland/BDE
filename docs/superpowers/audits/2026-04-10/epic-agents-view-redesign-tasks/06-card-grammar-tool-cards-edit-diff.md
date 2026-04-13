# Card grammar — tool cards + EditDiffCard

## Problem

After tasks 04 and 05, the tool card files (`ToolCallCard`, `ToolPairCard`, `ToolGroupCard`) still render with single-letter "icons" (`$`, `R`, `E`, `W`, `?`, `F`, `A`) in colored boxes — and clicking expand on an `edit` tool shows raw JSON instead of an inline diff. This task replaces tool icons with `lucide-react` components, applies card chrome to the tool cards, and adds a new `EditDiffCard` for the Edit/Write tool expanded view.

## Solution

### Tool icon replacement

In `cards/util.ts`, rewrite `getToolMeta()` and `TOOL_MAP`:

```typescript
import {
  Terminal,
  FileText,
  Edit3,
  FilePlus,
  Search,
  Folder,
  Bot,
  List,
  Wrench,
  type LucideIcon
} from 'lucide-react'

interface ToolMeta {
  Icon: LucideIcon
  color: string
}

const TOOL_MAP: Record<string, ToolMeta> = {
  bash: { Icon: Terminal, color: 'var(--bde-warning)' },
  read: { Icon: FileText, color: 'var(--bde-status-review)' },
  edit: { Icon: Edit3, color: 'var(--bde-accent)' },
  write: { Icon: FilePlus, color: 'var(--bde-accent)' },
  grep: { Icon: Search, color: 'var(--bde-status-active)' },
  glob: { Icon: Folder, color: 'var(--bde-warning)' },
  agent: { Icon: Bot, color: 'var(--bde-status-done)' },
  task: { Icon: Bot, color: 'var(--bde-status-done)' },
  list: { Icon: List, color: 'var(--bde-text-muted)' }
}
export function getToolMeta(name: string): ToolMeta {
  return TOOL_MAP[name.toLowerCase()] ?? { Icon: Wrench, color: 'var(--bde-text-muted)' }
}
```

### Tool cards

- **`ToolCallCard.tsx`** and **`ToolPairCard.tsx`**: render `<meta.Icon size={16} style={{ color: meta.color }} />` in the card header instead of the letter-in-box. Apply `.console-card` chrome. Header row: icon + tool name + summary + (for tool_pair) success/failure badge. Click → expand via `CollapsibleBlock`. **For Edit/Write tools, the expanded slot renders `<EditDiffCard input={block.input} />`. For Bash, render the command + output as a code block. For Read, no expansion (one-line card). For everything else, fall back to existing JSON pretty-print.**
- **`ToolGroupCard.tsx`**: replace the text `5 tool calls (3 read, 2 edit)` with an icon row — render each tool's lucide icon (14px) in execution order, followed by a one-line summary derived from the existing `breakdown` logic. Click → expand to nested action cards.

### EditDiffCard (new)

Create `src/renderer/src/components/agents/cards/EditDiffCard.tsx` (~80 LOC). Reads `input` from the parent card's tool block:

- For `edit` tool: `input.old_string` and `input.new_string` exist. Build a synthetic git-format diff string:
  ```
  diff --git a/file b/file
  --- a/file
  +++ b/file
  @@ -1,N +1,M @@
  -<old_string lines>
  +<new_string lines>
  ```
  Then call `parseDiff(raw)` from `src/renderer/src/lib/diff-parser.ts`. Render the resulting `DiffFile[]` as a list of `DiffLine` rows: `add` rows green-tinted, `del` rows red-tinted, `ctx` rows neutral.
- For `write` tool: `input.content` exists. Render as a code block with line numbers (no diff — it's a whole new file).

CSS class names: `.edit-diff-card`, `.edit-diff-card__row`, `.edit-diff-card__row--add`, `.edit-diff-card__row--del`, `.edit-diff-card__row--ctx`. Add to `cards/ConsoleCard.css` or a new `cards/EditDiffCard.css`.

## Files to Change

- `src/renderer/src/components/agents/cards/util.ts`
- `src/renderer/src/components/agents/cards/ToolCallCard.tsx`
- `src/renderer/src/components/agents/cards/ToolPairCard.tsx`
- `src/renderer/src/components/agents/cards/ToolGroupCard.tsx`
- `src/renderer/src/components/agents/cards/ConsoleCard.css` (tool card chrome + diff styles, OR new `EditDiffCard.css`)
- NEW: `src/renderer/src/components/agents/cards/EditDiffCard.tsx`

## How to Test

1. **No single-letter tool meta:**
   ```bash
   grep -n "letter:" src/renderer/src/components/agents/cards/util.ts
   ```
   Expected: 0 matches (rewritten to use lucide `Icon` field).
2. **EditDiffCard exists and uses parseDiff:**
   ```bash
   grep -n 'parseDiff' src/renderer/src/components/agents/cards/EditDiffCard.tsx
   ```
   Expected: at least 1 import and 1 call.
3. **lucide imports in util.ts:**
   ```bash
   grep -n "from 'lucide-react'" src/renderer/src/components/agents/cards/util.ts
   ```
   Expected: 1 import line.
4. **Tests pass:**
   ```bash
   npm run typecheck && npm test && npm run lint
   ```
   Add a test for `EditDiffCard` rendering with sample edit input.
5. **Manual smoke test:** spawn a quick adhoc agent, ask it to edit a small file, click expand on the edit tool — verify a colored inline diff appears (not raw JSON).

## Out of Scope

- Conversation cards (task 05)
- Bash output streaming or pseudo-terminal rendering (just code-block output)
- Diff selection / comments / hunks (that's `PlainDiffContent` territory — not reused here)
- Adding a real diff library
- Sidebar / fleet (task 02)
- Header (task 03)
- Empty state (task 07)
