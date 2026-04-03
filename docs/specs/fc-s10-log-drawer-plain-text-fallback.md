# FC-S10: LogDrawer — render plain text output from task runner agents

## Problem

Task runner agents are spawned with `--print` (plain text output). BDE's own "Spawn Agent" button uses `--output-format stream-json --verbose`, which produces newline-delimited JSON that `parseStreamJson` + `ChatThread` can render.

When a task runner agent's log is opened in `LogDrawer`, `parseStreamJson` finds zero parseable JSON events → `chatItemsToMessages([])` returns `[]` → `ChatThread` renders nothing. The drawer opens but shows a completely blank content area, even while the agent is actively writing output.

## Solution

### Option A — Switch task runner to stream-json (preferred)

In `life-os/scripts/task-runner.js`, change the spawn args from:

```js
'--permission-mode', 'bypassPermissions',
'--print',
```

to:

```js
'--permission-mode', 'bypassPermissions',
'--output-format', 'stream-json',
'--verbose',
```

This makes all task runner output compatible with the existing `parseStreamJson` + `ChatThread` pipeline. No changes needed in BDE itself. Log files will be stream-json just like native agents.

**Tradeoff:** Slightly larger log files (JSON wrapping). Still perfectly readable in Sessions view.

### Option B — Plain text fallback in LogDrawer (defensive, add regardless)

In `LogDrawer.tsx`, after `parseStreamJson(logContent)`, check if `items` is empty but `logContent` is non-empty. If so, render a `<pre>` block with the raw text instead of `<ChatThread>`:

```tsx
const { items, isStreaming } = useMemo(() => parseStreamJson(logContent), [logContent])
const messages = useMemo(() => chatItemsToMessages(items), [items])

const hasStreamJson = items.length > 0
const hasPlainText = !hasStreamJson && logContent.trim().length > 0
```

In the body:

```tsx
{
  task.agent_run_id ? (
    hasStreamJson ? (
      <ChatThread messages={messages} isStreaming={agentStatus === 'running' && isStreaming} />
    ) : hasPlainText ? (
      <pre className="log-drawer__plain-text">{logContent}</pre>
    ) : (
      <div className="log-drawer__empty">Agent is starting up...</div>
    )
  ) : (
    <div className="log-drawer__no-session">No agent session linked to this task.</div>
  )
}
```

Add CSS for `.log-drawer__plain-text`:

```css
.log-drawer__plain-text {
  padding: 12px 16px;
  font-family: var(--bde-font-mono);
  font-size: 12px;
  color: var(--bde-text);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-y: auto;
  flex: 1;
  margin: 0;
}

.log-drawer__empty {
  padding: 16px;
  color: var(--bde-text-muted);
  font-size: 12px;
  text-align: center;
}
```

## Recommended approach: Do BOTH

1. Switch task runner to `--output-format stream-json --verbose` (Option A) — this fixes the core issue and makes logs render richly.
2. Add the plain text fallback in LogDrawer (Option B) — defensive guard for any future log format mismatches.

## Files to Change

| File                                               | Change                                                        |
| -------------------------------------------------- | ------------------------------------------------------------- |
| `life-os/scripts/task-runner.js`                   | Change spawn flags to `--output-format stream-json --verbose` |
| `src/renderer/src/components/sprint/LogDrawer.tsx` | Add plain text fallback render path                           |
| `src/renderer/src/assets/sprint.css`               | Add `.log-drawer__plain-text` + `.log-drawer__empty` styles   |

> Note: `task-runner.js` lives in the `life-os` repo — the agent will need `--add-dir` to reach it. The prompt should include the full path: `~/Documents/Repositories/life-os/scripts/task-runner.js`.

## Acceptance Criteria

- Clicking "View Output" on an in-progress task runner task shows content (not blank)
- If the log is stream-json format, `ChatThread` renders it (rich, existing behaviour)
- If the log is plain text, a `<pre>` block renders it with mono font
- "Agent is starting up..." placeholder shown when log exists but is still empty (< 3s grace)
- No regression on BDE-native-spawned agents (still render via ChatThread)

## Out of Scope

- Retroactively re-running old agents with stream-json
- Syntax highlighting in plain text view
- Log download / export

## Size: S — ~40 lines changed
