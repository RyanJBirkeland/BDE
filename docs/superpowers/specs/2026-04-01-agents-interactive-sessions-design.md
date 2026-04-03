# Agents View: Interactive Sessions Redesign

## Problem

The Agents view's Launchpad currently has a three-phase wizard (grid → configure → review) that spawns autonomous, task-like agents. This duplicates what the Task Workbench + Sprint Pipeline already does better. The result is a confusing split: two places to "make an agent do work," neither clearly differentiated.

## Decision

The Agents view is for **interactive sessions only**. If you want autonomous task execution, use Task Workbench → queue. The Launchpad becomes a single-screen conversational entry point.

## Design

### Launchpad (Single Screen)

Three vertically stacked zones replace the current three-phase wizard:

1. **Quick Actions** — Same tile grid (Clean Code, Fix Bug, New Feature, etc.). Clicking a tile immediately spawns an interactive agent session. The template's `promptTemplate` text is injected as context in the agent's opening prompt — no question wizard, no review step. Template questions are ignored.

2. **Repo / Model defaults** — Small muted row below tiles. Repo as a cycling chip button, model as pill toggles. Same controls as today, repositioned with reduced visual weight. Defaults to last-used or first configured repo.

3. **Chat Input** — Full-width input at the bottom. Placeholder: "What would you like to work on?" Enter spawns an interactive session with the typed text as the opening prompt.

### Removed

- **LaunchpadConfigure** (question wizard) — deleted entirely
- **LaunchpadReview** (review + spawn screen) — deleted entirely
- **Recent tasks section** — removed from LaunchpadGrid
- **Phase state machine** in AgentLaunchpad — no longer needed (single screen)
- `RecentTask` type, `RECENT_TASKS_KEY`, `RECENT_TASKS_LIMIT` — unused after recents removal
- `prompt-assembly.ts` / `assemblePrompt()` — template prompt used directly, no variable interpolation needed
- `migrateHistory()` — no longer needed

### Spawn Behavior

All Launchpad spawns use `spawnAdhocAgent` with `assistant: true`. This means:

- Agent is interactive (multi-turn via session resumption)
- Agent waits for user direction rather than executing autonomously
- `source: 'adhoc'` in agent history

**Store type fix**: `useLocalAgentsStore.spawnAgent` args type must be updated to include `assistant?: boolean` (currently missing). The shared `SpawnLocalAgentArgs` in `src/shared/types.ts` already has the field — the store just needs to pass it through.

**IPC consolidation**: The dedicated `agent:spawnAssistant` IPC handler becomes dead code since all spawns now go through `local:spawnClaudeAgent` with `assistant: true`. Remove it from `agent-handlers.ts` and its preload bridge.

For **quick action tiles**: the template's `promptTemplate` is sent as the opening prompt, prepended with a short framing line: "Starting interactive session with context: [template name]". Any `{{variable}}` placeholders in the template are stripped (replaced with empty string, collapsed blank lines) before sending. Keep `assemblePrompt()` from `prompt-assembly.ts` for this — call it with an empty answers object to strip placeholders cleanly.

For **custom input**: the user's typed text is sent directly as the opening prompt.

**Repo path resolution**: The Launchpad must call `window.api.getRepoPaths()` on mount (as it does today) to map repo labels to filesystem paths. The `useRepoOptions()` hook provides display labels; `getRepoPaths()` provides the `repoPath` needed by `spawnAdhocAgent`.

**Template loading**: The Launchpad still calls `usePromptTemplatesStore.loadTemplates()` on mount to populate the quick action tile grid. This is unchanged from today.

### What Stays the Same

- **Agent list sidebar** — unchanged, shows all agents (pipeline, adhoc, assistant)
- **AgentConsole** — unchanged, handles the interactive conversation
- **LiveActivityStrip** — unchanged
- **Activity chart** — unchanged
- **Backend adhoc-agent.ts** — unchanged (already supports interactive sessions)
- **Prompt templates store** — kept for template CRUD in Settings, but questions are no longer used by Launchpad
- **Template management in Settings** — users can still create/edit/hide templates

### Files Changed

| File                                                        | Change                                                                                         |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/renderer/src/components/agents/AgentLaunchpad.tsx`     | Rewrite: remove phase machine, single-screen with direct spawn                                 |
| `src/renderer/src/components/agents/LaunchpadGrid.tsx`      | Simplify: remove recents, reposition repo/model, chat-style input                              |
| `src/renderer/src/components/agents/LaunchpadConfigure.tsx` | Delete                                                                                         |
| `src/renderer/src/components/agents/LaunchpadReview.tsx`    | Delete                                                                                         |
| `src/renderer/src/lib/launchpad-types.ts`                   | Remove `RecentTask`, `RECENT_TASKS_KEY`, `RECENT_TASKS_LIMIT`                                  |
| `src/renderer/src/lib/prompt-assembly.ts`                   | Keep `assemblePrompt()` for stripping `{{variables}}`; delete `migrateHistory()`               |
| `src/main/handlers/agent-handlers.ts`                       | Remove `agent:spawnAssistant` handler (dead code)                                              |
| `src/renderer/src/stores/localAgents.ts`                    | Add `assistant?: boolean` to `spawnAgent` args type                                            |
| `src/renderer/src/assets/agent-launchpad-neon.css`          | Clean up unused classes (`.launchpad__review-*`, `.launchpad__chat-*`, `.launchpad__recent-*`) |
| Tests for deleted components                                | Delete or update                                                                               |

### Data Flow

```
User clicks tile          User types + Enter
       |                         |
       v                         v
 template.promptTemplate    raw user text
       |                         |
       +--------> spawn <--------+
                    |
                    v
         spawnAdhocAgent({
           task: prompt,
           repoPath: selectedRepo,
           model: selectedModel,
           assistant: true
         })
                    |
                    v
           AgentConsole (interactive)
```

### Edge Cases

- **Templates with `{{variables}}`**: Since questions are skipped, `assemblePrompt(template, {})` strips placeholders and collapses blank lines before sending to the agent.
- **Empty quick action click**: Template always has `promptTemplate`, so there's always content to send.
- **No repos configured**: Disable spawn, show message directing to Settings > Repositories.
