# WS5: Decompose SettingsView

**Date:** 2026-03-20
**Status:** Draft
**Effort:** 1-2 days
**Dependencies:** None

## Problem

`SettingsView.tsx` is 841 LOC with 30 `useState` hooks, handling 6 unrelated feature domains in a single component. Adding a new settings section requires modifying this monolith. The `ConnectionsSection` alone is 335 LOC with 3x copy-pasted credential test/save/show logic.

## Solution

Split into a tab container (~60 LOC) + 6 section components + a reusable `CredentialForm` component.

## Architecture

```
src/renderer/src/views/
  SettingsView.tsx              — Tab container (60 LOC)

src/renderer/src/components/settings/
  AppearanceSection.tsx         — Theme, accent color (~80 LOC)
  ConnectionsSection.tsx        — Gateway, GitHub, TaskRunner (~120 LOC using CredentialForm)
  CredentialForm.tsx            — Reusable credential test/save/show (~120 LOC)
  RepositoriesSection.tsx       — Repo CRUD with color picker (~170 LOC)
  TaskTemplatesSection.tsx      — Task template CRUD (~150 LOC)
  AgentRuntimeSection.tsx       — Agent binary, permission mode (~80 LOC)
  AboutSection.tsx              — App version, GitHub link (~30 LOC)
```

### SettingsView Tab Container

```typescript
// src/renderer/src/views/SettingsView.tsx (~50 LOC)
const TABS = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'connections', label: 'Connections', icon: Plug },
  { id: 'repositories', label: 'Repositories', icon: GitBranch },
  { id: 'templates', label: 'Templates', icon: FileText },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'about', label: 'About', icon: Info },
] as const

export default function SettingsView() {
  const [activeTab, setActiveTab] = useState<string>('appearance')

  return (
    <div className="settings-view">
      <TabBar tabs={TABS} active={activeTab} onChange={setActiveTab} />
      <div className="settings-content">
        {activeTab === 'appearance' && <AppearanceSection />}
        {activeTab === 'connections' && <ConnectionsSection />}
        {activeTab === 'repositories' && <RepositoriesSection />}
        {activeTab === 'templates' && <TaskTemplatesSection />}
        {activeTab === 'agent' && <AgentRuntimeSection />}
        {activeTab === 'about' && <AboutSection />}
      </div>
    </div>
  )
}
```

### CredentialForm (Reusable)

Eliminates the repeated test/save/show pattern. Supports both single-field (token) and multi-field (URL + token) credentials:

```typescript
// src/renderer/src/components/settings/CredentialForm.tsx

interface CredentialField {
  key: string // field identifier
  label: string // "URL", "Token", etc.
  type: 'url' | 'token' // Controls input type and masking
  placeholder?: string
}

interface CredentialFormProps {
  title: string // "Gateway", "GitHub", etc.
  fields: CredentialField[] // 1 field for GitHub/TaskRunner, 2 for Gateway
  values: Record<string, string> // current values keyed by field.key
  onChange: (key: string, value: string) => void
  onSave: (values: Record<string, string>) => Promise<void>
  onTest?: (values: Record<string, string>) => Promise<{ ok: boolean; message: string }>
}

export function CredentialForm({
  title,
  fields,
  values,
  onChange,
  onSave,
  onTest
}: CredentialFormProps) {
  const [showValues, setShowValues] = useState<Record<string, boolean>>({})
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [saving, setSaving] = useState(false)

  // Renders each field with show/hide toggle
  // Test button calls onTest with all field values
  // Save button calls onSave with all field values
}
```

### ConnectionsSection (Using CredentialForm)

Note: Uses actual IPC methods from the preload bridge — no new IPC channels needed.

```typescript
// src/renderer/src/components/settings/ConnectionsSection.tsx (~120 LOC)

export function ConnectionsSection() {
  // Gateway: 2 fields (URL + token) — uses window.api.testGatewayConnection(url, token)
  // GitHub: 1 field (token) — tests via window.api.github.fetch('/user')
  // Task Runner: 1 field (URL) — tests via window.api.sprint.healthCheck()

  return (
    <>
      <CredentialForm
        title="Gateway"
        fields={[
          { key: 'url', label: 'URL', type: 'url', placeholder: 'http://localhost:18789' },
          { key: 'token', label: 'Token', type: 'token' },
        ]}
        values={{ url: gwUrl, token: gwToken }}
        onChange={(key, val) => key === 'url' ? setGwUrl(val) : setGwToken(val)}
        onSave={async (vals) => { await window.api.saveGatewayConfig(vals.url, vals.token) }}
        onTest={async (vals) => {
          const res = await window.api.testGatewayConnection(vals.url, vals.token || undefined)
          return { ok: res.ok, message: res.ok ? 'Connected' : res.error }
        }}
      />
      <CredentialForm
        title="GitHub"
        fields={[{ key: 'token', label: 'Personal Access Token', type: 'token' }]}
        values={{ token: ghToken }}
        onChange={(_key, val) => setGhToken(val)}
        onSave={async (vals) => { await window.api.settings.set('github.token', vals.token) }}
        onTest={async (vals) => {
          try {
            const res = await window.api.github.fetch('/user')
            return { ok: true, message: `Authenticated as ${res.login}` }
          } catch (e) {
            return { ok: false, message: String(e) }
          }
        }}
      />
      {/* Task Runner: similar pattern using window.api.sprint.healthCheck() */}
    </>
  )
}
```

The Gateway credential has 2 fields (URL + token) while GitHub and Task Runner each have 1 field. `CredentialForm` handles both cases via the `fields` array. No new IPC channels are required — all test functions use existing preload bridge methods.

## Changes

### 1. Create `src/renderer/src/components/settings/` directory

### 2. Extract `AppearanceSection`

Move from SettingsView:

- Theme toggle (dark/light)
- Accent color picker
- `useAccentColor()` hook (move to `src/renderer/src/hooks/useAccentColor.ts` or keep inline)

### 3. Create `CredentialForm` component

New reusable component with props interface as described above.

### 4. Rewrite `ConnectionsSection`

Replace 335 LOC of 3x copy-paste with `CredentialForm` instances (~120 LOC).

### 5. Extract `RepositoriesSection`

Already somewhat self-contained in the current file (lines 71-236). Move as-is, clean up.

### 6. Extract `TaskTemplatesSection`

Move template CRUD logic (lines 240-348, currently named `TaskTemplatesSection` in the source) into its own component file. Keep the existing function name.

### 7. Extract `AgentRuntimeSection`

Move agent binary path, permission mode, and related settings.

### 8. Extract `AboutSection`

Move the About section (lines 816-838) containing app version and GitHub link into a small standalone component.

### 9. Rewrite `SettingsView.tsx`

Replace 841 LOC with ~60 LOC tab container that lazy-renders section components.

### 9. Update tests

Split existing SettingsView tests (if any) into per-section test files:

```
src/renderer/src/components/settings/__tests__/
  CredentialForm.test.tsx
  ConnectionsSection.test.tsx
  RepositoriesSection.test.tsx
  ...
```

## File Size Targets

| File                       | Target LOC | Current Equivalent         |
| -------------------------- | ---------- | -------------------------- |
| `SettingsView.tsx`         | ~60        | 841                        |
| `AppearanceSection.tsx`    | ~80        | (embedded)                 |
| `ConnectionsSection.tsx`   | ~120       | 335 (with duplication)     |
| `CredentialForm.tsx`       | ~120       | (new, replaces 3x pattern) |
| `RepositoriesSection.tsx`  | ~170       | 166                        |
| `TaskTemplatesSection.tsx` | ~150       | 108                        |
| `AgentRuntimeSection.tsx`  | ~80        | (embedded)                 |
| `AboutSection.tsx`         | ~30        | (embedded, lines 816-838)  |

Total: ~810 LOC across 8 files (down from 841 in one file, with better separation and deduplication).

## Verification

- `npm run typecheck` passes
- `npm test` passes
- SettingsView.tsx < 100 LOC
- No section component > 200 LOC
- Adding a new credential type requires only adding a `<CredentialForm>` instance to `ConnectionsSection`

## Risk

Low-medium. UI extraction with no business logic changes. Main risk is CSS/layout breakage from restructuring the component tree. Manual visual verification recommended.
