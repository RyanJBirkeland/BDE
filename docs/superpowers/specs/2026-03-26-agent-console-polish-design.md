# Agent Console Polish — Design Spec

## Summary

Polish the agent details console with four improvements: markdown rendering in agent text, tool-specific icons, rich completion summary card, and consecutive text grouping. All styling uses the V2 neon design system (`agents-neon.css` + `var(--neon-*)` tokens). No new dependencies.

## 1. Render Markdown in Agent Text

### Problem

Agent `[agent]` text blocks contain markdown (`**bold**`, `` `code` ``, `## headings`) that renders as raw text. Formatting is lost.

### Solution

Create `src/renderer/src/lib/render-agent-markdown.tsx` — a lightweight JSX renderer that handles:

- `**bold**` → `<strong className="console-md-bold">`
- `` `code` `` → `<code className="console-md-code">`
- `## heading` (line-start only) → `<span className="console-md-heading">`
- Unicode emojis pass through unchanged (already render natively)

**Why JSX return values**: Agent text is untrusted (comes from LLM output). Returning React elements (not raw HTML strings) avoids XSS by design — React auto-escapes all text content.

**Regex pipeline**: Process in order — headings (line-start `##`), then bold, then inline code. Each pass splits text into alternating literal/matched segments and wraps matched segments in styled spans.

### CSS additions (`agents-neon.css`)

```css
.console-md-bold {
  font-weight: 700;
  color: var(--neon-text);
}
.console-md-code {
  background: var(--neon-cyan-surface);
  color: var(--neon-cyan);
  padding: 1px 5px;
  border-radius: var(--bde-radius-sm, 4px);
  font-size: 11px;
}
.console-md-heading {
  font-weight: 700;
  color: var(--neon-text);
  font-size: 13px;
  display: block;
  margin-top: 4px;
}
```

### Usage in ConsoleLine

Replace `<span style={contentStyle}>{block.text}</span>` with `<span className="console-line__content">{renderAgentMarkdown(block.text)}</span>` for `text` type blocks.

## 2. Differentiate Tool Calls Visually

### Problem

All tool calls show the same `[tool]` prefix in blue. Bash, Read, Edit, Grep, Write, Glob are indistinguishable at a glance.

### Solution

Add a small colored icon square before the `[tool]` prefix based on `block.tool` name. Map known tools to icon letter + neon color:

| Tool      | Letter | Color var       |
| --------- | ------ | --------------- |
| Bash      | `$`    | `--neon-orange` |
| Read      | `R`    | `--neon-blue`   |
| Edit      | `E`    | `--neon-cyan`   |
| Write     | `W`    | `--neon-cyan`   |
| Grep      | `G`    | `--neon-purple` |
| Glob      | `G`    | `--neon-orange` |
| Agent     | `A`    | `--neon-pink`   |
| (default) | `•`    | `--neon-blue`   |

The `[tool]` prefix text color also matches the tool's neon color instead of always being blue.

### CSS additions (`agents-neon.css`)

```css
.console-tool-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  font-size: 10px;
  flex-shrink: 0;
  font-weight: 700;
  font-family: var(--bde-font-code);
}
.console-tool-icon--bash {
  background: var(--neon-orange-surface);
  color: var(--neon-orange);
}
.console-tool-icon--read {
  background: var(--neon-blue-surface);
  color: var(--neon-blue);
}
.console-tool-icon--edit,
.console-tool-icon--write {
  background: var(--neon-cyan-surface);
  color: var(--neon-cyan);
}
.console-tool-icon--grep {
  background: var(--neon-purple-surface);
  color: var(--neon-purple);
}
.console-tool-icon--glob {
  background: var(--neon-orange-surface);
  color: var(--neon-orange);
}
.console-tool-icon--agent {
  background: var(--neon-pink-surface);
  color: var(--neon-pink);
}
.console-tool-icon--default {
  background: var(--neon-blue-surface);
  color: var(--neon-blue);
}
```

### Implementation

Create a `getToolMeta(toolName: string)` helper in `ConsoleLine.tsx` that returns `{ letter, className, prefixColor }`. Used by both `tool_call` and `tool_pair` cases.

Tool name matching: case-insensitive `toolName.toLowerCase()` check against known names. The `tool` field from events is the SDK tool name (e.g., `"Bash"`, `"Read"`, `"Edit"`, `"Write"`, `"Grep"`, `"Glob"`, `"Agent"`).

## 3. Rich Completion Summary Card

### Problem

The `[done]` line shows `$0.0000 • 0 tokens • 313.80s` — minimal, easily missed, no visual distinction from log lines.

### Solution

Replace the single-line `completed` block with a styled card that breaks out of the log line pattern. Shows:

- **Status header**: checkmark + "Agent completed successfully" (or "Agent failed" with exit code for non-zero)
- **Stats grid**: 4 columns — Duration, Cost, Tokens In, Tokens Out
- Success variant: `--neon-cyan` border/gradient
- Failed variant: `--neon-red` border/gradient

### Formatting helpers

- Duration: `formatDuration(ms)` → `"5m 14s"`, `"45s"`, `"1h 2m"`
- Cost: `$X.XX` (2 decimal places, or `$0.00` for zero)
- Tokens: `formatTokenCount(n)` → `"142K"`, `"1.2M"`, `"850"` (below 1000 show raw)

### CSS additions (`agents-neon.css`)

```css
.console-completion-card {
  margin: 12px;
  padding: 16px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--neon-cyan-surface) 0%, var(--neon-surface-deep) 100%);
  border: 1px solid var(--neon-cyan-border);
  font-family: var(--bde-font-code);
}
.console-completion-card--failed {
  background: linear-gradient(135deg, var(--neon-red-surface) 0%, var(--neon-surface-deep) 100%);
  border-color: var(--neon-red-border);
}
.console-completion-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-weight: 700;
  font-size: 13px;
}
.console-completion-card__stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.console-completion-card__stat {
  text-align: center;
}
.console-completion-card__stat-value {
  font-size: 18px;
  font-weight: 700;
}
.console-completion-card__stat-label {
  font-size: 10px;
  color: var(--neon-text-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 2px;
}
```

### Stat value colors

- Duration: `var(--neon-cyan)`
- Cost: `var(--neon-cyan)` on success, `var(--neon-red)` on failure
- Tokens In: `var(--neon-purple)`
- Tokens Out: `var(--neon-orange)`

## 4. Group Consecutive Agent Text Blocks

### Problem

Long agent messages arrive as multiple `agent:text` events, creating separate `[agent]` lines for what is logically one message. This fragments readability.

### Solution

Update `pairEvents()` in `pair-events.ts` to merge consecutive `text` blocks. When two or more adjacent events are `agent:text`, combine them into a single `text` block with joined content (newline-separated). Use the timestamp of the first event.

### Implementation

After the main event loop, add a merge pass:

```typescript
// Merge consecutive text blocks
const merged: ChatBlock[] = []
for (const block of blocks) {
  const prev = merged[merged.length - 1]
  if (block.type === 'text' && prev?.type === 'text') {
    prev.text += '\n' + block.text
  } else {
    merged.push(block)
  }
}
return merged
```

### Visual treatment

Grouped text blocks (containing newlines) render with a subtle left border to indicate they're multi-part:

```css
.console-line__content--grouped {
  border-left: 2px solid var(--neon-cyan-border);
  padding-left: 8px;
}
```

Applied conditionally when `block.text.includes('\n')`.

## Migration: Inline Styles → CSS Classes

As part of this work, migrate `ConsoleLine.tsx` from inline `tokens.*` styles to the existing CSS classes in `agents-neon.css`. The CSS file already defines `.console-line`, `.console-prefix--agent`, `.console-line__timestamp`, etc. that are currently unused.

This aligns with the CLAUDE.md convention: _"Do NOT use inline `tokens._` styles for neon views — use CSS classes."\*

## Files Changed

| File                                                 | Change                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/renderer/src/lib/render-agent-markdown.tsx`     | New — lightweight markdown JSX renderer                                     |
| `src/renderer/src/lib/pair-events.ts`                | Add consecutive text merging pass                                           |
| `src/renderer/src/components/agents/ConsoleLine.tsx` | Migrate to CSS classes, add tool icons, markdown rendering, completion card |
| `src/renderer/src/assets/agents-neon.css`            | Add markdown, tool icon, completion card, grouped text CSS classes          |

## Testing

- Unit tests for `renderAgentMarkdown()` — bold, code, headings, nested, edge cases (empty string, no markdown, XSS attempts)
- Unit tests for `pairEvents()` text merging — consecutive merge, non-consecutive preserved, single text untouched
- Update existing `ConsoleLine` tests for new rendering (CSS classes instead of inline styles, tool icons, completion card structure)
- Snapshot or assertion tests for completion card success/failed variants

## No New Dependencies

All four features are implemented with existing React/TypeScript. The markdown renderer is ~40 lines of regex-based JSX generation. No new packages needed.
