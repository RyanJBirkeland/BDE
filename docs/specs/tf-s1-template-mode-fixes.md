# TF-S1: Template Mode Fixes
**Epic:** Ticket Flow  
**Phase:** 1 of 3  
**Status:** Ready to implement

## Problem
The NewTicketModal has 5 compounding issues that make the current ticket creation experience feel unfinished:
1. No CSS rules exist for any `.new-ticket-modal__*` class — layout is browser defaults + inherited glass styles
2. "Ask Paul" ignores which template is selected — generates freeform even when Bug Fix is active
3. "Ask Paul" fails silently — empty `catch {}` at line 121 of NewTicketModal.tsx, user waits 30s and sees nothing
4. Selecting a template chip destructively overwrites user-written spec content with no confirmation
5. Two common task types (Test Coverage, Performance) have no template

## Solution
Fix all 5 issues in a single focused PR. No new IPC. No new components. All changes in 2 files (NewTicketModal.tsx + CSS).

## Data / RPC Shapes
No new IPC. Existing `window.api.sprint.create()` and `window.api.invokeTool('sessions_send', ...)` unchanged.

## Exact Changes

### 1. CSS — Add all `.new-ticket-modal__*` rules

**File:** `src/renderer/src/assets/sprint.css` (append to end of file)

Add these CSS rules exactly:

```css
/* ─── New Ticket Modal ─────────────────────────────────────────── */

.new-ticket-modal__body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 24px;
}

.new-ticket-modal__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.new-ticket-modal__label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--bde-text-dim);
}

.new-ticket-modal__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.new-ticket-modal__templates {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.new-ticket-modal__chip {
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid var(--bde-border);
  background: transparent;
  color: var(--bde-text-dim);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.new-ticket-modal__chip:hover {
  border-color: var(--bde-accent);
  color: var(--bde-text);
}

.new-ticket-modal__chip--active {
  border-color: var(--bde-accent);
  background: color-mix(in srgb, var(--bde-accent) 15%, transparent);
  color: var(--bde-accent);
}

.new-ticket-modal__spec-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.new-ticket-modal__spec-editor {
  width: 100%;
  min-height: 180px;
  resize: vertical;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--bde-border);
  border-radius: 8px;
  color: var(--bde-text);
  font-family: var(--bde-font-mono);
  font-size: 12px;
  line-height: 1.6;
  outline: none;
  box-sizing: border-box;
}

.new-ticket-modal__spec-editor:focus {
  border-color: var(--bde-accent);
}

.new-ticket-modal__footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  padding: 16px 24px;
  border-top: 1px solid var(--bde-border);
}

.new-ticket-modal__ask-paul {
  padding: 5px 12px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--bde-border);
  background: transparent;
  color: var(--bde-text-dim);
  cursor: pointer;
  transition: all 0.15s ease;
}

.new-ticket-modal__ask-paul:hover:not(:disabled) {
  border-color: var(--bde-accent);
  color: var(--bde-accent);
}

.new-ticket-modal__ask-paul:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

**Note:** Check which CSS custom properties (`--bde-accent`, `--bde-border`, `--bde-text`, `--bde-text-dim`, `--bde-font-mono`) are defined in `design-system.css` or `main.css`. Use exact variable names from those files. If any variable doesn't exist, use the closest existing one.

### 2. NewTicketModal.tsx — Template-aware Ask Paul

**File:** `src/renderer/src/components/sprint/NewTicketModal.tsx`

Find the `handleAskPaul` function (currently around line 96-126). Replace the system prompt construction:

**Before (find this code):**
```typescript
const message = `You are a senior software engineer writing a precise, agent-executable spec...
Title: "${title}"
Repo: ${repo}
...`
```

**After (replace with):**
```typescript
const selectedTemplateData = selectedTemplate ? TEMPLATES[selectedTemplate] : null
const templateInstruction = selectedTemplateData
  ? `You are writing a spec for a "${selectedTemplateData.label}" task.
Use EXACTLY this structure (fill in each section — do not change the headings):
${selectedTemplateData.spec}

Fill in each section based on:
- Title: "${title}"
- Repo: ${repo}
- User's draft: ${spec.trim() || '(none)'}

Rules:
- Name exact file paths (e.g. src/renderer/src/components/sprint/SprintCenter.tsx)
- Describe exact code changes (not "update the component" but "add useEffect with X dependency")
- Keep Out of Scope short and direct
- Output ONLY the filled spec markdown — no preamble, no commentary`
  : `You are a senior software engineer writing a precise, agent-executable spec for a coding task.

Title: "${title}"
Repo: ${repo}
User's draft: ${spec.trim() || '(none)'}

Write a spec with these sections: Problem, Solution, Files to Change, Out of Scope.
Be specific: name exact file paths and describe exact changes.
Output ONLY the spec markdown — no preamble.`
```

### 3. NewTicketModal.tsx — Error feedback for Ask Paul

**File:** `src/renderer/src/components/sprint/NewTicketModal.tsx`

Find the catch block in `handleAskPaul` (currently `catch { /* silent */ }` or empty `catch {}`).

**Before:**
```typescript
  } catch {
    // or: } catch (err) {
  }
```

**After:**
```typescript
  } catch {
    setSpec('')  // clear "Generating..." placeholder
    // Show toast — find the existing toast utility used elsewhere in the file
    // If using react-hot-toast: toast.error('Spec generation failed — try again')
    // If there's a different toast pattern, use the same one
    console.error('Ask Paul failed in NewTicketModal')
  } finally {
    setGenerating(false)
  }
```

**Important:** Check how toasts are shown elsewhere in the sprint components (SprintCenter, SpecDrawer). Use the same pattern. If `toast` from `react-hot-toast` is used, add the import: `import toast from 'react-hot-toast'`. If a custom `useToast` hook exists, use that. Do NOT introduce a new toast library.

### 4. NewTicketModal.tsx — Template overwrite confirmation

**File:** `src/renderer/src/components/sprint/NewTicketModal.tsx`

Find the `handleSelectTemplate` function (or wherever `setSpec(TEMPLATES[key].spec)` is called when clicking a template chip).

**Before (approximately):**
```typescript
const handleSelectTemplate = (key: string) => {
  if (selectedTemplate === key) {
    setSelectedTemplate(null)
    setSpec('')
    return
  }
  setSelectedTemplate(key)
  setSpec(TEMPLATES[key].spec)
}
```

**After:**
```typescript
const handleSelectTemplate = (key: string) => {
  if (selectedTemplate === key) {
    setSelectedTemplate(null)
    setSpec('')
    return
  }

  const isSpecDirty = spec.trim() !== '' && spec !== TEMPLATES[selectedTemplate ?? '']?.spec
  if (isSpecDirty) {
    const confirmed = window.confirm('Replace your current spec with the template?')
    if (!confirmed) return
  }

  setSelectedTemplate(key)
  setSpec(TEMPLATES[key].spec)
}
```

### 5. NewTicketModal.tsx — Add Test Coverage and Performance templates

**File:** `src/renderer/src/components/sprint/NewTicketModal.tsx`

Find the `TEMPLATES` const (top of file, around line 25-50). Add two new entries:

```typescript
  test: {
    label: 'Test Coverage',
    spec: `## What to Test
<!-- Component, hook, or module under test -->

## Test Strategy
<!-- unit / integration / e2e — pick one and explain why -->

## Files to Create
<!-- e.g. src/renderer/src/components/sprint/__tests__/SprintCenter.test.tsx -->

## Coverage Target
<!-- What specific behaviors must be covered -->

## Out of Scope
<!-- What is NOT being tested in this ticket -->`,
  },
  performance: {
    label: 'Performance',
    spec: `## What's Slow
<!-- Describe the bottleneck with specifics — e.g. "SprintCenter re-renders every 5s even when hidden" -->

## Current Metrics
<!-- Before measurement — e.g. "11 setInterval timers running simultaneously" -->

## Target Metrics
<!-- After target — e.g. "0 timers running when sprint view is not active" -->

## Approach
<!-- Exact fix: what code changes, what pattern to use -->

## Files to Change
<!-- Explicit list with what changes in each -->

## How to Verify
<!-- How to confirm the fix worked -->`,
  },
```

**Note:** Add these entries at the end of the `TEMPLATES` object. Do NOT reorder existing entries. Verify the template chip render loop renders them automatically (it should if it maps over `Object.entries(TEMPLATES)`).

## Files to Change

| File | What Changes |
|------|-------------|
| `src/renderer/src/assets/sprint.css` | Append all `.new-ticket-modal__*` CSS rules |
| `src/renderer/src/components/sprint/NewTicketModal.tsx` | Template-aware Ask Paul prompt, error toast, overwrite confirmation, 2 new templates |

## Out of Scope
- Mode tabs (Quick / Design) — that's TF-S2 and TF-S3
- Markdown preview toggle — separate ticket
- Draft persistence (localStorage) — separate ticket
- Any changes to SpecDrawer
- Any changes to IPC handlers or preload
- Any changes to SprintCenter or TaskCard

## Test Plan
After implementing:
1. Open NewTicketModal, click "Bug Fix" template — spec textarea fills with Bug Fix scaffold
2. Type "Fix the thing" as title, click "Ask Paul" — verify generated spec follows Bug Fix structure (has "Bug Description", "Root Cause" etc headings)
3. Click "Feature" template while spec textarea has user-typed content — verify confirm dialog appears
4. Disconnect from gateway, click "Ask Paul" — verify a toast/error message appears (not silent failure)
5. Verify template chips have visible active state (colored border/background) when selected
6. Verify modal body has correct layout (not browser defaults)

## PR Command
```bash
git add -A && git commit -m "fix: template-aware Ask Paul, error feedback, overwrite confirmation, CSS, new templates" && git push origin HEAD && gh api repos/RyanJBirkeland/BDE/pulls --method POST -f title="fix: NewTicketModal — template-aware AI, error handling, CSS, Test+Perf templates" -f body="5 fixes in NewTicketModal:\n- Ask Paul now generates within selected template structure\n- Error toast on Ask Paul failure (was silent catch)\n- Confirm dialog before template chip overwrites user content\n- Full CSS rules for all .new-ticket-modal__* classes\n- Added Test Coverage and Performance template options" -f head="\$(git branch --show-current)" -f base=main --jq ".html_url"
```
