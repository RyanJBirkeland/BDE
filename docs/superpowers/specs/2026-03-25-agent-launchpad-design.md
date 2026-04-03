# Agent Launchpad Design Spec

## Overview

Replace the unstyled `SpawnModal` (modal overlay with no CSS) with an **Agent Launchpad** — a full-pane view inside the Agents view that provides a tile-grid of quick-action prompt templates, a chat-style configuration flow, and a review screen before spawning. Styled with the neon design system.

## Goals

- Replace modal with an in-view launchpad experience (like a browser new-tab page)
- Quick-action tiles for common tasks (Clean Code Audit, Fix Bug, etc.)
- Chat-style question flow per template to build a detailed prompt/spec
- Review assembled prompt before spawning, with ability to edit
- User-customizable templates (add, edit, delete, save-from-review)
- Full neon design system integration (CSS vars, tokens, glass morphism)

## Non-Goals

- No changes to the actual spawn mechanism (`spawnAgent()` in `localAgents` store)
- No changes to agent runtime, SDK adapter, or worktree management
- No server-side template storage (all local: SQLite settings + localStorage)
- No AI-powered question generation (questions are static per template)

---

## Architecture

### Phase-Based Flow

The launchpad has three phases, managed by local React state (`phase: 'grid' | 'configure' | 'review'`):

```
┌─────────────────────────────────────────────────────┐
│ AgentsView                                          │
│  ├── AgentLaunchpad (when no agent selected or +)   │
│  │   ├── Phase: grid      → LaunchpadGrid           │
│  │   ├── Phase: configure → LaunchpadConfigure       │
│  │   └── Phase: review    → LaunchpadReview          │
│  ├── AgentList + AgentConsole (when agent selected)  │
│  └── AgentTimeline                                   │
└─────────────────────────────────────────────────────┘
```

**Phase transitions:**

- Grid → Configure: user clicks a quick-action tile
- Grid → Review: user types a custom prompt and hits Enter/Spawn (skip configure)
- Configure → Review: all required questions answered
- Review → Spawn: user clicks "Spawn Agent" → calls `spawnAgent()`, transitions to agent console
- Review → Grid: user clicks "Back" twice or the launchpad header
- Any phase → Grid: user clicks back arrow to launchpad root

### Component Tree

```
AgentLaunchpad
├── LaunchpadGrid
│   ├── TemplateGrid (tile grid of PromptTemplates)
│   ├── RecentsList (recent task history from localStorage)
│   └── PromptBar (custom input + repo selector + model pills)
├── LaunchpadConfigure
│   ├── ConfigHeader (back arrow + template badge + step counter)
│   ├── ChatMessages (question/answer message bubbles)
│   │   ├── SystemMessage (question + choice chips)
│   │   └── UserMessage (selected answer)
│   └── ChatInputBar (text input + send button)
└── LaunchpadReview
    ├── ReviewHeader (back arrow + template badge)
    ├── ParamGrid (2-column grid of param summary cards)
    ├── SpecBlock (editable generated prompt)
    └── ReviewActions (Back, Save as Template, Spawn)
```

---

## Data Model

### PromptTemplate

Stored in SQLite `settings` table under key `prompt_templates` as a JSON array.

```ts
interface PromptTemplate {
  id: string // crypto.randomUUID()
  name: string // "Clean Code Audit"
  icon: string // emoji: "🧹"
  accent: NeonAccent // 'cyan' | 'pink' | 'blue' | 'purple' | 'orange' | 'red'
  description: string // "Audit & remediate"
  questions: TemplateQuestion[]
  promptTemplate: string // "Perform a {{action}} on {{scope}}..."
  defaults?: {
    model?: ClaudeModelId // optional default model override
    repo?: string // optional default repo
  }
  builtIn?: boolean // true = shipped default, cannot be deleted (only hidden)
  hidden?: boolean // user hid this built-in template
  order: number // display sort position
}

interface TemplateQuestion {
  id: string // variable name: "scope", "focus", "action"
  label: string // "Which area should I focus on?"
  type: 'choice' | 'text' | 'multi-choice'
  choices?: string[] // for choice/multi-choice: ["Entire repo", "Specific directory", ...]
  default?: string // pre-selected answer
  required?: boolean // defaults true
}
```

### Built-In Templates

Ship 6 defaults (stored in code, merged with user overrides on load):

1. **Clean Code Audit** (cyan) — scope, focus areas, action mode (report/auto-fix)
2. **Fix Bug** (pink) — bug description, reproduction steps, suspected area
3. **New Feature** (blue) — feature description, target files/area, test requirements
4. **Write Tests** (orange) — target area, test type (unit/integration/e2e), coverage goal
5. **Code Review** (cyan) — PR number or branch, review focus, strictness level
6. **Refactor** (red) — target code, refactoring type, scope constraints

Each has 2-4 questions. Full question definitions will be specified in the implementation plan.

### Prompt Assembly

After the configure phase, answers are interpolated into the template's `promptTemplate` string using `{{variableId}}` syntax. Simple string replacement — no template engine dependency needed.

```ts
function assemblePrompt(template: PromptTemplate, answers: Record<string, string>): string {
  let prompt = template.promptTemplate
  for (const [key, value] of Object.entries(answers)) {
    prompt = prompt.replaceAll(`{{${key}}}`, value)
  }
  return prompt
}
```

### Task History

Recent tasks stored in `localStorage` under key `bde-spawn-history` (same key as current SpawnModal for migration). Array of:

```ts
interface RecentTask {
  prompt: string // the full assembled prompt text
  templateId?: string // which template was used (if any)
  repo: string
  model: string
  timestamp: number // Date.now()
}
```

Display truncation happens at render time, not storage time. Capped at 20 entries to limit localStorage usage.

Migrating from old format: old history is `string[]`. On first load, detect array-of-strings and convert to `RecentTask[]` with timestamp = 0.

---

## UI Design

### Screen 1: Launchpad Grid

```
┌──────────────────────────────────────────────────┐
│ ● NEW AGENT SESSION                              │
├──────────────────────────────────────────────────┤
│ QUICK ACTIONS                                    │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐            │
│ │  🧹  │ │  🐛  │ │  ✨  │ │  🧪  │            │
│ │Clean │ │ Fix  │ │ New  │ │Write │            │
│ │Code  │ │ Bug  │ │Feat  │ │Tests │            │
│ └──────┘ └──────┘ └──────┘ └──────┘            │
│ ┌──────┐ ┌──────┐ ┌──────┐                      │
│ │  🔍  │ │  📦  │ │  +   │                      │
│ │Review│ │Refac │ │ Add  │                      │
│ └──────┘ └──────┘ └──────┘                      │
│                                                  │
│ RECENT                                           │
│ ○ Explain the purpose of BDE in 200...    2h ago │
│ ○ Fix the light theme header and na...    5h ago │
│ ○ Research how to make the life os...     1d ago │
│                                                  │
│──────────────────────────────────────────────────│
│ [Or describe a custom task...  ] ● BDE ▾ [S] ⚡ │
└──────────────────────────────────────────────────┘
```

- Tile grid: `auto-fill, minmax(160px, 1fr)` responsive grid
- Each tile: neon-accented gradient background, icon, name, description
- Hover: lift + glow effect
- "+ Add" tile: dashed border, opens inline template editor
- Recent list: click to fill prompt bar and go straight to review
- Bottom bar: custom prompt input, repo dropdown, model pills (Haiku/Sonnet/Opus)
- Custom prompt + Enter or click Spawn → skip configure, go to review

### Screen 2: Configure (Chat Flow)

```
┌──────────────────────────────────────────────────┐
│ ← 🧹 CLEAN CODE AUDIT              Step 2 of 3  │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌─ AGENT SETUP ──────────────────────┐          │
│  │ Which area should I focus on?      │          │
│  │ [Entire repo] [Specific dir] [Changed]│       │
│  └────────────────────────────────────┘          │
│                                                  │
│                    ┌──────────────────────┐       │
│                    │ Entire repo          │       │
│                    └──────────────────────┘       │
│                                                  │
│  ┌─ AGENT SETUP ──────────────────────┐          │
│  │ What should I prioritize?          │          │
│  │ [Dead code] [Naming] [SOLID] [All] │          │
│  └────────────────────────────────────┘          │
│                                                  │
│──────────────────────────────────────────────────│
│ [Type an answer or pick above...       ] [Send]  │
└──────────────────────────────────────────────────┘
```

- Back arrow returns to grid
- Template badge shows icon + name
- Step counter: "Step N of M" (M = number of questions)
- System messages: left-aligned, cyan-tinted, with label "AGENT SETUP"
- Choice chips: pill buttons, clickable, accent-colored on select
- User messages: right-aligned, purple-tinted
- Text input for free-form answers (type: 'text' questions)
- Answering the last question auto-advances to review

### Screen 3: Review & Spawn

```
┌──────────────────────────────────────────────────┐
│ ← 🧹 REVIEW — CLEAN CODE AUDIT                  │
├──────────────────────────────────────────────────┤
│ ┌─────────────┐ ┌─────────────┐                  │
│ │ Repository  │ │ Model       │                  │
│ │ BDE         │ │ Sonnet 4.6  │                  │
│ └─────────────┘ └─────────────┘                  │
│ ┌─────────────┐ ┌─────────────┐                  │
│ │ Scope       │ │ Action      │                  │
│ │ Entire repo │ │ Auto-fix    │                  │
│ └─────────────┘ └─────────────┘                  │
│                                                  │
│ ┌─ GENERATED PROMPT ─────────────────── [Edit] ─┐│
│ │ Perform a comprehensive clean code audit on   ││
│ │ the entire BDE repository. Focus on all       ││
│ │ quality dimensions: dead code removal,        ││
│ │ naming and readability improvements...        ││
│ └────────────────────────────────────────────────┘│
│                                                  │
│──────────────────────────────────────────────────│
│              [← Back] [Save as Template] [⚡ Spawn]│
└──────────────────────────────────────────────────┘
```

- Param grid: 2-column, summarizes repo, model, and key answers
- Spec block: full generated prompt, glass panel, "Edit" button toggles textarea mode
- Edit mode: prompt becomes a textarea, user can modify before spawning
- "Save as Template": saves current config as a new user template
- "Spawn Agent": resolves repo name → path via `window.api.getRepoPaths()` (same as SpawnModal does today), then calls `spawnAgent({ task, repoPath, model })`
- After spawn: transition to agent console with the new agent selected

---

## Styling

All styles in `agent-launchpad-neon.css`. Uses:

- `var(--neon-*)` CSS custom properties from `neon.css`
- `tokens.*` from `design-system/tokens.ts` for inline styles in components
- Glass morphism for panels and the spec block
- Tile colors via per-tile CSS variables (`--tile-accent`, etc.) mapped from `NeonAccent`
- `neonVar()` helper for accent-based styling
- Animations: `neon-breathe` for status dot, subtle hover lifts on tiles
- `prefers-reduced-motion` respected (no lifts/glows, instant transitions)

---

## State Management

### New: `promptTemplatesStore` (Zustand)

```ts
interface PromptTemplatesState {
  templates: PromptTemplate[]
  loading: boolean
  loadTemplates: () => Promise<void>
  saveTemplate: (template: PromptTemplate) => Promise<void>
  deleteTemplate: (id: string) => Promise<void>
  reorderTemplates: (ids: string[]) => Promise<void>
  hideBuiltIn: (id: string) => Promise<void>
}
```

- Loads from `settings` table on init, merges with `DEFAULT_TEMPLATES`
- Built-in templates are in-code constants; user overrides stored in DB
- Single store, one domain concern (per convention)

### Existing stores used:

- `localAgentsStore.spawnAgent()` — spawn call
- `localAgentsStore.fetchProcesses()` — refresh after spawn
- `uiStore` — view management

---

## Settings Integration

New section in Settings view: **"Prompt Templates"**

- List of all templates (built-in + custom)
- Drag-to-reorder (or up/down arrows)
- Built-in: toggle visibility (show/hide), cannot delete
- Custom: edit all fields, delete
- "Add Template" button opens same form as "+ Add" tile
- Template editor fields: name, icon (emoji text input), accent (6-color picker), description, questions (add/remove/reorder), prompt template (textarea with `{{variable}}` highlighting)

---

## Migration

- `SpawnModal.tsx` and its test file are deleted
- `AgentsView.tsx` updated to show `AgentLaunchpad` instead of `SpawnModal`
- `bde:open-spawn-modal` custom event (from CommandPalette) updated: navigates to Agents view + deselects current agent to show launchpad grid. Event name stays the same for backwards compat.
- Old localStorage key `bde-spawn-history` (string array) migrated to new `RecentTask[]` format on first load
- No database migration needed — `prompt_templates` is a new settings key

---

## Testing Strategy

- **Unit tests per component**: LaunchpadGrid, LaunchpadConfigure, LaunchpadReview
- **Integration test**: full flow from tile click → configure → review → spawn call
- **Store tests**: promptTemplatesStore CRUD, merge with built-ins, reorder
- **Utility tests**: `assemblePrompt()` interpolation, history migration
- All tests use existing patterns: vitest + testing-library, mock `window.api`, mock stores

---

## File Map

| File                                                               | Action | Purpose                                                                                                        |
| ------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/components/agents/AgentLaunchpad.tsx`            | Create | Phase orchestrator                                                                                             |
| `src/renderer/src/components/agents/LaunchpadGrid.tsx`             | Create | Tile grid + recents + prompt bar                                                                               |
| `src/renderer/src/components/agents/LaunchpadConfigure.tsx`        | Create | Chat-style question flow                                                                                       |
| `src/renderer/src/components/agents/LaunchpadReview.tsx`           | Create | Review + edit + spawn                                                                                          |
| `src/renderer/src/assets/agent-launchpad-neon.css`                 | Create | All launchpad styling                                                                                          |
| `src/renderer/src/stores/promptTemplates.ts`                       | Create | Template CRUD store                                                                                            |
| `src/renderer/src/lib/prompt-assembly.ts`                          | Create | Template interpolation + history migration                                                                     |
| `src/renderer/src/lib/default-templates.ts`                        | Create | Built-in template definitions                                                                                  |
| `src/renderer/src/views/AgentsView.tsx`                            | Modify | Replace SpawnModal with AgentLaunchpad                                                                         |
| `src/renderer/src/components/agents/SpawnModal.tsx`                | Delete | Replaced                                                                                                       |
| `src/renderer/src/components/agents/__tests__/SpawnModal.test.tsx` | Delete | Replaced                                                                                                       |
| `src/renderer/src/components/settings/PromptTemplatesSection.tsx`  | Create | Prompt template management UI (separate from existing TaskTemplatesSection which handles sprint task prefixes) |
