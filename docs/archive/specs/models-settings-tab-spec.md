# Models Settings Tab — Design Spec

> **Status: SHIPPED (verified 2026-04-21). See `docs/release-notes/2026-04-20-agent-model-routing.md` and `SettingsView.tsx` — the Models tab lists per-agent-type model pickers.**

**Status:** draft — awaiting approval
**Author:** Claude (designed autonomously per user request on 2026-04-17)
**Depends on:** M8 (`docs/specs/rbt-backend-integration-spec.md`) — shipped 2026-04-18

## Motivation

M8 shipped per-agent-type backend routing end-to-end: `BackendSettings` in
`src/main/agent-manager/backend-selector.ts` already stores per-type
`{ backend: 'claude' | 'local', model: string }` plus a shared `localEndpoint`.
The dogfood session on 2026-04-18 validated the runtime path — the only way to
change these values today is `UPDATE settings SET value = ... WHERE key =
'agents.backendConfig'` directly in SQLite.

This spec designs a settings tab that exposes that config to users.

## Goals

- **G1.** A user can see, for each of the six agent types, whether it routes
  to Claude or a local model, and which model ID is in effect.
- **G2.** A user can change the Pipeline routing (the one type that's wired
  end-to-end today) without touching SQLite.
- **G3.** A user can set the shared `localEndpoint` and verify it's reachable
  before committing a change.
- **G4.** The UI honestly reflects that five of six agent types are *not yet
  wired* through `spawnAgent` — no silent no-ops.
- **G5.** Zero behaviour change for existing users: an unmodified install
  renders the tab showing `{ backend: 'claude', model: defaultModel }` for
  all six types and saves nothing until the user clicks Save.

## Non-goals

- Rerouting any non-Pipeline agent type through `spawnAgent`. That's a
  separate workstream; this tab surfaces the *future* config, not the wiring.
- Auto-populating local model IDs from `GET /v1/models`. Nice-to-have, not
  MVP. Deferred to **Future work**.
- Per-agent-type local endpoints. The backend stores one shared
  `localEndpoint`; keep it shared.
- Migrating or removing `agentManager.defaultModel`. That setting has been
  superseded by the per-type config but may still be read by legacy code
  paths; investigation and cleanup is a separate pass.

## User experience

### Placement

New sidebar entry under the existing **Pipeline** category:

| id | label | icon | category |
| --- | --- | --- | --- |
| `models` | Models | `Network` (lucide-react) | Pipeline |

Ordering in `SECTIONS` (array in `src/renderer/src/views/SettingsView.tsx`):
Connections / Repositories / Templates / **Agents / Models** / Memory /
Appearance / About. Models sits directly under Agents — the two are
conceptually adjacent (Agents = concurrency, runtime, permissions; Models =
per-type backend + model routing).

### Page layout

Page title: **Models**
Subtitle: *Route each agent type to Claude or a local model.*

Three stacked sections inside `.settings-cards-list` (existing class):

```
┌─────────────────────────────────────────────────────────┐
│ Local backend                                           │
│ ─────────────────────────────────────────────────────── │
│ Endpoint URL: [ http://localhost:1234/v1            ]  │
│ [ Test connection ]   ✓ Reachable — 3 models loaded     │
│ LM Studio, Ollama, or any OpenAI-compatible server.     │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Active routing                                          │
│ ─────────────────────────────────────────────────────── │
│ Pipeline                                                │
│ The agent that executes sprint tasks end-to-end.        │
│ Backend: ( ● Claude  ○ Local )                          │
│ Model:   [ claude-sonnet-4-5 ▾ ]                        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Not yet routed                         (disabled state) │
│ These agent types still go straight to Claude SDK.      │
│ Pre-configuring here is preserved; it takes effect as   │
│ each type is wired through spawnAgent.                  │
│ ─────────────────────────────────────────────────────── │
│ Synthesizer  Backend: ( Claude | Local )  Model: [...]  │
│ Copilot      Backend: ( Claude | Local )  Model: [...]  │
│ Assistant    Backend: ( Claude | Local )  Model: [...]  │
│ Adhoc        Backend: ( Claude | Local )  Model: [...]  │
│ Reviewer     Backend: ( Claude | Local )  Model: [...]  │
└─────────────────────────────────────────────────────────┘

                                              [ Save changes ]
```

A single **Save** button lives below the third card, right-aligned, in its
own row (outside any `SettingsCard`). It saves the entire form — endpoint
plus all six routing rows — in one atomic `setSettingJson` call. Per-card
save buttons would split one `BackendSettings` object into N round-trip
writes; a single form Save keeps it simple. Rationale for departing from
`AgentManagerSection`'s in-footer Save: that component edits five
independent settings keys, so a per-card Save matches its data model;
this component edits one composite key.

### Interactions

**Row state machine.** Each agent-type row has two controls:

1. **Backend** — segmented control with two options, `Claude` and `Local`.
   Renders as a pair of `role="radio"` buttons inside a
   `role="radiogroup"` (accessible segmented control pattern). Claude is
   the default.

2. **Model** — conditional on backend:
   - `backend === 'claude'` → `<select>` with three options:
     `claude-sonnet-4-5`, `claude-opus-4-7`, `claude-haiku-4-5`.
     Placeholder / default: `claude-sonnet-4-5`.
   - `backend === 'local'` → `<input type="text">` with placeholder
     `openai/qwen/qwen3.6-35b-a3b`.

When the user toggles `backend`, model resets to that backend's default:
Claude → `claude-sonnet-4-5`; Local → `''` (empty; user must fill). No
cross-backend memoisation in MVP — keeps the state model trivial.

**Disabled rows.** The five "Not yet routed" rows render all controls
disabled. A muted inline note under each row's label reads *"Not yet
routed — configuration preserved for when this agent type is wired."*
The save payload still includes these rows (the backend stores them, the
runtime ignores them).

**Test connection.** Click triggers `window.api.agents.testLocalEndpoint(
endpoint)` → IPC → main-process HTTP GET. Four visible states:

| State | Indicator |
| --- | --- |
| Idle (pre-click) | Nothing |
| In-flight | Spinner + "Testing…" |
| Ok | Green checkmark + "Reachable — {n} models loaded" |
| Fail | Red X + concise error (e.g. `ECONNREFUSED`, `timeout after 2s`) |

The state is transient — it clears when the user edits the endpoint
field or switches tabs. It is *not* persisted.

**Dirty tracking.** Follow the pattern in
`AgentManagerSection.tsx:25,78-80,92`: local `dirty` boolean, set in every
`onChange`, gates Save's `disabled`, reset on successful save. Discarding
changes is a page-navigation-only operation (no Reset button in MVP —
consistent with `AgentManagerSection`).

## Data model

### Settings schema (reused as-is)

From `src/main/agent-manager/backend-selector.ts`:

```ts
export interface BackendSettings {
  pipeline: AgentBackendConfig
  synthesizer: AgentBackendConfig
  copilot: AgentBackendConfig
  assistant: AgentBackendConfig
  adhoc: AgentBackendConfig
  reviewer: AgentBackendConfig
  localEndpoint: string
}
export interface AgentBackendConfig {
  backend: 'claude' | 'local'
  model: string
}
```

Persisted under `SETTING_BACKEND_CONFIG = 'agents.backendConfig'`. Load
via `loadBackendSettings()`, save via `saveBackendSettings(next)`. The UI
shell imports neither directly; it calls IPC (below).

### IPC surface

Two existing channels, one new.

**Existing — reused unchanged:**
- `settings:getJson` via `window.api.settings.getJson('agents.backendConfig')`
- `settings:setJson` via `window.api.settings.setJson('agents.backendConfig', next)`

**New:**

```ts
// src/shared/ipc-channels/local-channels.ts (or similar)
'agents:testLocalEndpoint': {
  args: { endpoint: string }
  result: {
    ok: true
    latencyMs: number
    modelCount: number
  } | {
    ok: false
    error: string        // human-readable; safe to render inline
  }
}
```

Main-process handler: register in `src/main/handlers/agent-handlers.ts`
via the existing `safeHandle('agents:testLocalEndpoint', …)` pattern
(see `agent-handlers.ts:100-106` for the sibling `agents:list` / `agents:
readLog` / `agents:import` registrations). Implementation:
`GET ${endpoint}/models` with `AbortSignal.timeout(2000)`. On success,
parse the response (OpenAI models list envelope: `{ data: [...] }`) and
return `data.length`. On failure, return a short error string — never
throw across the IPC boundary.

Preload addition (`src/preload/api-agents.ts`, inside the existing
`agents` object):

```ts
testLocalEndpoint: (endpoint: string):
  Promise<IpcChannelMap['agents:testLocalEndpoint']['result']> =>
  typedInvoke('agents:testLocalEndpoint', { endpoint })
```

Wire the channel into `IpcChannelMap` in `src/shared/ipc-channels/` — the
existing typed-channel pattern (see `api-agents.ts:37-48`) handles the rest.

## Component structure

One new file, two internal sub-components, following the stepdown ladder
convention used by `AgentManagerSection`:

```
ModelsSection.tsx           (entry; layout + state + save orchestration)
  └─ LocalEndpointCard      (shared endpoint + test connection)
  └─ AgentTypeRow           (label + description + backend toggle + model picker)
      └─ ModelPicker        (conditional select / input)
```

All three sub-components live inside `ModelsSection.tsx` as non-exported
functions. If any grows past ~80 lines, split into its own file.

**Reference pattern.** Read `AgentManagerSection.tsx` top-to-bottom before
writing `ModelsSection.tsx`. Match its:
- `useState` + `dirty` + `saving` triad
- `useEffect` one-shot load on mount
- `useCallback` for `handleSave`
- `SettingsCard` wrapping with `footer={<Button>}`
- `.settings-field` / `.settings-field__label` / `.settings-field__input`
  class conventions

No new CSS if it can be avoided. The segmented control (backend toggle) is
the one element without prior art in this codebase; if no existing UI
primitive fits, add the two pill-buttons inline with minimal styles in
`ModelsSection.css` (scoped, small).

## Agent type labels & descriptions

Keyed by `AgentType` (see
`src/main/agent-system/personality/types.ts`):

| id | Label | One-line description |
| --- | --- | --- |
| `pipeline` | Pipeline | Executes sprint tasks end-to-end. |
| `synthesizer` | Synthesizer | Drafts spec documents from task titles. |
| `copilot` | Copilot | Interactive pair-programming agent. |
| `assistant` | Assistant | One-shot Q&A over the repo. |
| `adhoc` | Adhoc | Freeform agent runs outside the sprint pipeline. |
| `reviewer` | Reviewer | Reviews PRs before merge. |

Copy lives as a const in `ModelsSection.tsx`. Intentionally terse.

## File changes

### Create

| File | Purpose |
| --- | --- |
| `src/renderer/src/components/settings/ModelsSection.tsx` | Main component |
| `src/renderer/src/components/settings/ModelsSection.css` | (if needed) segmented-control styles only |
| `src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx` | RTL tests (see Testing) |
| `src/main/__tests__/testLocalEndpoint.test.ts` | Unit tests for the IPC handler |

### Modify

| File | Change |
| --- | --- |
| `src/renderer/src/views/SettingsView.tsx` | Add `models` entry to `SECTIONS`, `SECTION_MAP`, `SECTION_META`; import `Network` icon |
| `src/renderer/src/stores/settingsNav.ts` | Add `'models'` to `SettingsSectionId` union |
| `src/preload/api-agents.ts` | Add `testLocalEndpoint` to the `agents` object |
| `src/shared/ipc-channels/*.ts` | Add `agents:testLocalEndpoint` to `IpcChannelMap` (follow existing pattern) |
| `src/main/` | Register IPC handler for `agents:testLocalEndpoint` — colocate with sibling `agents:*` handlers |
| `docs/modules/agent-manager/index.md` | Add `backend-selector.ts` row reference if not already present (out of scope strictly, but a drive-by polish) |

### Not modified (deliberate)

- `AgentManagerSection.tsx` — the "Default model" field stays for MVP. See
  Non-goals. A follow-up pass can remove it once the per-type config is
  confirmed to cover every call site.
- `src/main/agent-manager/backend-selector.ts` — no schema changes.

## Testing

### Unit tests — `ModelsSection.test.tsx`

1. Renders all six agent-type rows with correct labels.
2. Rows except `pipeline` render with `disabled` controls and the
   "Not yet routed" inline note.
3. Loading state: while `window.api.settings.getJson` pending, fields are
   empty / placeholders shown, Save is disabled.
4. Loaded state: values from storage populate each row.
5. Backend toggle on Pipeline row flips the model picker between `<select>`
   (Claude) and `<input>` (Local); model value resets to that backend's
   default.
6. Editing any field enables the Save button.
7. Save calls `window.api.settings.setJson` with the composed
   `BackendSettings` object exactly once and clears the dirty flag.
8. Test connection: ok state renders "{n} models loaded"; fail state
   renders the error string.
9. Test connection: in-flight state shows a spinner and disables the
   button.
10. Endpoint field edit clears any stale test-connection result.

### Unit tests — `testLocalEndpoint.test.ts`

1. Returns `{ ok: true, latencyMs, modelCount }` for a 200 response with
   a well-formed `{ data: [...] }` body.
2. Returns `{ ok: false, error: 'timeout after 2s' }` on slow response
   (use `AbortSignal.timeout` mock).
3. Returns `{ ok: false, error: 'ECONNREFUSED' }` on connection refusal.
4. Returns `{ ok: false, error: ... }` for non-JSON or non-`{data: []}`
   responses (e.g. proxy HTML).
5. Does not throw across the IPC boundary for any input shape.

No integration test against a real LM Studio — `RBT_TEST_LOCAL`-style
gating is overkill for a 10-line fetch wrapper.

### Existing tests not impacted

- `SettingsView.test.tsx` — add an assertion that the `models` section
  renders when `activeSection === 'models'`.
- `SettingsSidebar.test.tsx` — add an assertion that the `models` entry
  appears under `Pipeline`.
- `backend-selector.test.ts` — no change (schema unchanged).

## Accessibility

- All form controls have a visible label associated via the `.settings-field`
  wrapper pattern.
- Segmented control uses `role="radiogroup"` with two `role="radio"`
  children, arrow-key navigation between them.
- Disabled rows set `aria-disabled="true"` on the row container and
  `disabled` on individual controls; the "Not yet routed" note is
  linked via `aria-describedby`.
- Test-connection status area is an `aria-live="polite"` region so screen
  readers announce ok / fail transitions.
- Save button disabled state reflects `dirty || saving` accurately.

## Open questions / future work

1. **Auto-populate local models from `/v1/models`.** Replace the free-text
   input with a combobox that fetches the endpoint's model list on mount
   and on endpoint change. Needs debouncing and stale-response handling.
   Defer until a user asks.
2. **"Not yet routed" rows — disabled or editable?** Currently disabled.
   If users want to pre-configure to reduce friction when each type gets
   wired, flip to *editable but with a "preview" badge*. Low-cost change.
3. **Move all agent-lifecycle settings to one tab.** `AgentManagerSection`
   (concurrency, runtime, permissions) and `ModelsSection` both speak to
   agent behaviour. A future consolidation into a two-pane "Agents" tab
   with left-nav sub-sections is a natural simplification if the count
   grows.
4. **Remove `agentManager.defaultModel`.** Audit for live readers, remove
   the field from `AgentManagerSection`, and simplify
   `DEFAULT_SETTINGS` in `backend-selector.ts` to inline the default
   string. One focused follow-up commit.

## Out of scope

- Model validation (e.g. "this model ID isn't reachable"). Preflight in
  `rbt-coding-agent` already handles this at spawn time — the UI trusts
  the user's input and lets the runtime report failure through the
  existing warning-broadcast pipeline.
- Per-workspace overrides. Settings are app-global.
- A "Reset to defaults" button. Navigate away without saving to discard.
