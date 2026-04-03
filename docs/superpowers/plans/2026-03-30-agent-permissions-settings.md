# Agent Permissions Settings UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Permissions" tab in Settings where users view/edit agent permissions with consent banner and presets, reading/writing `~/.claude/settings.json`.

**Architecture:** New `AgentPermissionsSection.tsx` component reads/writes `~/.claude/settings.json` via 2 new IPC channels (`claude:getConfig`, `claude:setConfig`). First-time consent banner shown until user accepts. Three presets (Recommended, Restrictive, Permissive). All changes persist to the same file Claude Code CLI reads.

**Tech Stack:** React, Zustand (none — local state), IPC, Node fs

**Spec:** `docs/superpowers/specs/2026-03-30-agent-permissions-settings-design.md`

---

## File Map

| File                                                               | Action               | Responsibility                                             |
| ------------------------------------------------------------------ | -------------------- | ---------------------------------------------------------- |
| `src/main/handlers/claude-config-handlers.ts`                      | Create               | IPC handlers for reading/writing `~/.claude/settings.json` |
| `src/main/index.ts`                                                | Modify               | Register claude-config handlers                            |
| `src/shared/ipc-channels.ts`                                       | Modify               | Add ClaudeConfigChannels                                   |
| `src/preload/index.ts`                                             | Modify               | Expose claudeConfig methods                                |
| `src/preload/index.d.ts`                                           | Modify               | Type declarations                                          |
| `src/renderer/src/components/settings/AgentPermissionsSection.tsx` | Create               | Permissions UI with banner, rules, presets                 |
| `src/renderer/src/views/SettingsView.tsx`                          | Modify (lines 19-43) | Add Permissions tab                                        |
| `src/renderer/src/assets/settings-neon.css`                        | Modify               | Add permission-specific styles                             |

**Test files:**

| File                                                                              | Tests                                        |
| --------------------------------------------------------------------------------- | -------------------------------------------- |
| `src/main/handlers/__tests__/claude-config-handlers.test.ts`                      | Read/write config, missing file, merge logic |
| `src/renderer/src/components/settings/__tests__/AgentPermissionsSection.test.tsx` | Banner, presets, toggle rules, save          |

---

### Task 1: IPC Channels + Handlers for ~/.claude/settings.json

**Files:**

- Modify: `src/shared/ipc-channels.ts`
- Create: `src/main/handlers/claude-config-handlers.ts`
- Create: `src/main/handlers/__tests__/claude-config-handlers.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: Add channel types**

In `src/shared/ipc-channels.ts`, add interface after existing channel groups:

```typescript
export interface ClaudeConfigChannels {
  'claude:getConfig': {
    args: []
    result: { permissions?: { allow?: string[]; deny?: string[] }; [key: string]: unknown }
  }
  'claude:setPermissions': {
    args: [{ allow: string[]; deny: string[] }]
    result: void
  }
}
```

Add `& ClaudeConfigChannels` to `IpcChannelMap`.

- [ ] **Step 2: Implement handlers**

Create `src/main/handlers/claude-config-handlers.ts`:

```typescript
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { safeHandle } from './safe-handle'

const CLAUDE_DIR = join(homedir(), '.claude')
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json')

export function registerClaudeConfigHandlers(): void {
  safeHandle('claude:getConfig', async () => {
    if (!existsSync(SETTINGS_PATH)) return {}
    try {
      return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'))
    } catch {
      return {}
    }
  })

  safeHandle(
    'claude:setPermissions',
    async (_e, permissions: { allow: string[]; deny: string[] }) => {
      if (!existsSync(CLAUDE_DIR)) mkdirSync(CLAUDE_DIR, { recursive: true })

      let settings: Record<string, unknown> = {}
      if (existsSync(SETTINGS_PATH)) {
        try {
          settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'))
        } catch {
          /* start fresh */
        }
      }

      settings.permissions = { allow: permissions.allow, deny: permissions.deny }
      writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n')
    }
  )
}
```

- [ ] **Step 3: Register in index.ts**

Add import and call `registerClaudeConfigHandlers()` in the handler registration block.

- [ ] **Step 4: Add preload methods**

In `src/preload/index.ts`:

```typescript
claudeConfig: {
  get: () => typedInvoke('claude:getConfig'),
  setPermissions: (permissions: { allow: string[]; deny: string[] }) =>
    typedInvoke('claude:setPermissions', permissions),
},
```

In `src/preload/index.d.ts`:

```typescript
claudeConfig: {
  get: () =>
    Promise<{ permissions?: { allow?: string[]; deny?: string[] }; [key: string]: unknown }>
  setPermissions: (permissions: { allow: string[]; deny: string[] }) => Promise<void>
}
```

- [ ] **Step 5: Write handler tests**

Test: getConfig returns empty object when file missing, returns parsed JSON when present, setPermissions writes file preserving other settings, setPermissions creates directory if missing.

- [ ] **Step 6: Run tests and typecheck**

```bash
npm run typecheck && npm run test:main
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(permissions): IPC handlers for ~/.claude/settings.json"
```

---

### Task 2: AgentPermissionsSection Component

**Files:**

- Create: `src/renderer/src/components/settings/AgentPermissionsSection.tsx`
- Create: `src/renderer/src/components/settings/__tests__/AgentPermissionsSection.test.tsx`

- [ ] **Step 1: Define presets and tool descriptions**

```typescript
const TOOL_DESCRIPTIONS: Record<string, string> = {
  Read: 'Read file contents',
  Write: 'Create new files',
  Edit: 'Modify existing files',
  Glob: 'Search for files by pattern',
  Grep: 'Search file contents',
  Bash: 'Run shell commands (npm, git, etc.)',
  Agent: 'Spawn sub-agents for parallel work',
  WebFetch: 'Fetch web URLs',
  WebSearch: 'Search the web',
  NotebookEdit: 'Edit Jupyter notebooks'
}

const PRESETS = {
  recommended: {
    allow: [
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'Bash',
      'Agent',
      'WebFetch',
      'WebSearch',
      'NotebookEdit'
    ],
    deny: [
      'Bash(rm -rf /*)',
      'Bash(rm -rf ~*)',
      'Bash(sudo rm *)',
      'Bash(sudo dd *)',
      'Bash(mkfs*)',
      'Bash(chmod -R 777 /*)'
    ]
  },
  restrictive: {
    allow: ['Read', 'Glob', 'Grep'],
    deny: ['Bash(rm -rf /*)', 'Bash(rm -rf ~*)', 'Bash(sudo rm *)', 'Bash(sudo dd *)']
  },
  permissive: {
    allow: [
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'Bash',
      'Agent',
      'WebFetch',
      'WebSearch',
      'NotebookEdit'
    ],
    deny: []
  }
}
```

- [ ] **Step 2: Implement component**

Structure:

```tsx
export function AgentPermissionsSection(): React.JSX.Element {
  const [allow, setAllow] = useState<string[]>([])
  const [deny, setDeny] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [consented, setConsented] = useState(
    () => localStorage.getItem('bde-permissions-consent') === 'true'
  )

  // Load on mount
  useEffect(() => {
    window.api.claudeConfig
      .get()
      .then((config) => {
        setAllow(config.permissions?.allow ?? [])
        setDeny(config.permissions?.deny ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  // Save handler
  async function handleSave() {
    await window.api.claudeConfig.setPermissions({ allow, deny })
    setDirty(false)
    toast.success('Agent permissions saved')
  }

  // Consent handler
  function handleAcceptDefaults() {
    setAllow(PRESETS.recommended.allow)
    setDeny(PRESETS.recommended.deny)
    setConsented(true)
    setDirty(true)
    localStorage.setItem('bde-permissions-consent', 'true')
  }

  // Toggle a tool in allow list
  function toggleTool(tool: string) {
    setAllow((prev) => (prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]))
    setDirty(true)
  }

  // Apply preset
  function applyPreset(name: keyof typeof PRESETS) {
    setAllow(PRESETS[name].allow)
    setDeny(PRESETS[name].deny)
    setDirty(true)
  }

  // Add/remove deny rule
  function addDenyRule(rule: string) {
    if (rule.trim() && !deny.includes(rule.trim())) {
      setDeny([...deny, rule.trim()])
      setDirty(true)
    }
  }
  function removeDenyRule(rule: string) {
    setDeny(deny.filter((r) => r !== rule))
    setDirty(true)
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section__title bde-section-title">Agent Permissions</h2>

      {/* Consent banner — shown until user accepts */}
      {!consented && !loading && (
        <div className="permissions-banner">
          <p>BDE agents need permission to read/write files and run commands in your repos.</p>
          <p>
            Review the default permissions below, or accept the recommended defaults to get started.
          </p>
          <div className="permissions-banner__actions">
            <button className="bde-btn bde-btn--primary bde-btn--sm" onClick={handleAcceptDefaults}>
              Accept Recommended
            </button>
            <button
              className="bde-btn bde-btn--ghost bde-btn--sm"
              onClick={() => {
                setConsented(true)
                localStorage.setItem('bde-permissions-consent', 'true')
              }}
            >
              I'll Configure Manually
            </button>
          </div>
        </div>
      )}

      {/* Presets */}
      <div className="settings-field">
        <span className="settings-field__label">Presets</span>
        <div className="settings-theme-buttons">
          <button
            className="bde-btn bde-btn--sm bde-btn--ghost"
            onClick={() => applyPreset('recommended')}
          >
            Recommended
          </button>
          <button
            className="bde-btn bde-btn--sm bde-btn--ghost"
            onClick={() => applyPreset('restrictive')}
          >
            Restrictive
          </button>
          <button
            className="bde-btn bde-btn--sm bde-btn--ghost"
            onClick={() => applyPreset('permissive')}
          >
            Permissive
          </button>
        </div>
      </div>

      {/* Allow list — checkboxes */}
      <div className="settings-field">
        <span className="settings-field__label">Allowed Tools</span>
        <div className="permissions-tools">
          {Object.entries(TOOL_DESCRIPTIONS).map(([tool, desc]) => (
            <label key={tool} className="permissions-tool">
              <input
                type="checkbox"
                checked={allow.includes(tool)}
                onChange={() => toggleTool(tool)}
              />
              <span className="permissions-tool__name">{tool}</span>
              <span className="permissions-tool__desc">{desc}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Deny list — editable */}
      <div className="settings-field">
        <span className="settings-field__label">Blocked Commands</span>
        <div className="permissions-deny-list">
          {deny.map((rule) => (
            <div key={rule} className="permissions-deny-rule">
              <code>{rule}</code>
              <button onClick={() => removeDenyRule(rule)} aria-label={`Remove ${rule}`}>
                ×
              </button>
            </div>
          ))}
          <input
            className="settings-field__input"
            placeholder="Add deny rule (e.g., Bash(rm -rf /*))"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                addDenyRule((e.target as HTMLInputElement).value)
                ;(e.target as HTMLInputElement).value = ''
              }
            }}
          />
        </div>
      </div>

      {/* Save */}
      <div className="settings-field">
        <button
          className="bde-btn bde-btn--primary bde-btn--sm"
          disabled={!dirty}
          onClick={handleSave}
        >
          Save Permissions
        </button>
        {dirty && (
          <span style={{ fontSize: 12, color: 'var(--bde-warning)' }}>Unsaved changes</span>
        )}
      </div>

      {/* Info */}
      <div className="settings-field">
        <span className="permissions-info">
          These permissions apply to all BDE-spawned agents. Pipeline agents (autonomous tasks)
          auto-allow all tools for safety via worktree isolation. Changes are saved to
          ~/.claude/settings.json.
        </span>
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Write tests**

Test: renders consent banner when not consented, hides banner after accept, toggles tool checkbox, applies preset, save calls IPC, add/remove deny rules.

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/renderer/src/components/settings/__tests__/AgentPermissionsSection.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(permissions): AgentPermissionsSection component with consent + presets"
```

---

### Task 3: Wire into Settings View + CSS

**Files:**

- Modify: `src/renderer/src/views/SettingsView.tsx:19-43`
- Modify: `src/renderer/src/assets/settings-neon.css`

- [ ] **Step 1: Add Permissions tab**

In `SettingsView.tsx`, add to TABS array (after 'agent' entry, ~line 23):

```typescript
{ id: 'permissions', label: 'Permissions', icon: Shield },
```

Import `Shield` from `lucide-react`.

Add to SECTION_MAP:

```typescript
permissions: AgentPermissionsSection,
```

Import `AgentPermissionsSection`.

- [ ] **Step 2: Add CSS**

In `settings-neon.css`, add:

```css
/* ── Agent Permissions ─────────────────────────────── */
.permissions-banner {
  background: var(--neon-cyan-surface);
  border: 1px solid var(--neon-cyan-border);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
  color: var(--neon-text);
  font-size: 13px;
  line-height: 1.5;
}

.permissions-banner p {
  margin: 0 0 8px;
}

.permissions-banner__actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.permissions-tools {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.permissions-tool {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}

.permissions-tool__name {
  font-weight: 600;
  color: var(--neon-text);
  min-width: 100px;
}

.permissions-tool__desc {
  color: var(--neon-text-muted);
  font-size: 12px;
}

.permissions-deny-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.permissions-deny-rule {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--neon-surface-dim);
  border: 1px solid var(--bde-border);
  border-radius: 6px;
  font-size: 12px;
}

.permissions-deny-rule code {
  color: var(--neon-red);
  font-family: var(--bde-font-code);
}

.permissions-deny-rule button {
  background: none;
  border: none;
  color: var(--neon-text-dim);
  cursor: pointer;
  font-size: 16px;
  padding: 0 4px;
}

.permissions-deny-rule button:hover {
  color: var(--neon-red);
}

.permissions-info {
  font-size: 11px;
  color: var(--neon-text-dim);
  line-height: 1.5;
}
```

- [ ] **Step 3: Run typecheck and full tests**

```bash
npm run typecheck && npm test
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(permissions): wire into Settings view + neon CSS"
```

---

### Task 4: Update Handler Counts + Final Verification

**Files:**

- Modify: `src/main/__tests__/integration/ipc-registration.test.ts`

- [ ] **Step 1: Update handler count test**

Add new `claude:getConfig` and `claude:setPermissions` channels — both use `safeHandle` so they count toward the handler total. Increment the count or verify the test still passes.

- [ ] **Step 2: Run full suite**

```bash
npm run typecheck && npm test && npm run test:main
```

- [ ] **Step 3: Run coverage**

```bash
npm run test:coverage 2>&1 | grep ERROR
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(permissions): agent permissions settings complete"
```

---

### Task 5: Manual Testing

- [ ] **Step 1: Build and run**

```bash
npm run dev
```

- [ ] **Step 2: Test consent banner**

1. Clear consent: `localStorage.removeItem('bde-permissions-consent')` in DevTools
2. Navigate to Settings > Permissions
3. Verify: banner appears with "Accept Recommended" and "I'll Configure Manually"
4. Click "Accept Recommended" → banner hides, checkboxes populated

- [ ] **Step 3: Test presets**

1. Click "Restrictive" → only Read/Glob/Grep checked
2. Click "Permissive" → all checked, no deny rules
3. Click "Recommended" → standard set with deny rules

- [ ] **Step 4: Test editing**

1. Uncheck "Bash" → dirty indicator shows
2. Click "Save Permissions" → toast "Agent permissions saved"
3. Reload app → Bash still unchecked (persisted)
4. Add deny rule "Bash(curl \*)" via input → appears in list
5. Remove a deny rule via × button

- [ ] **Step 5: Verify agent inherits**

1. Save permissions with Bash unchecked
2. Spawn an adhoc agent
3. Agent should not be able to run Bash commands (settingSources reads the updated file)
