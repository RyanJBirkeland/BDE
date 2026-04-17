# First-Launch Onboarding UX Audit

## Summary

BDE uses a **two-layer onboarding system**: (1) an initial "Onboarding" component that performs blocking preflight checks (Claude CLI, auth token, git) and shows a persistent check/retry UI, and (2) an "OnboardingWizard" that runs only if `onboarding.completed` setting is false, walking users through a 6-step wizard (Welcome → Auth → Git → GitHub CLI → Repos → Done). The wizard is skippable at the Repos step (optional) and auto-completes when all required checks pass. The system persists completion via localStorage, preventing repeated wizard runs. However, there are several UX and accessibility concerns that could frustrate fresh Mac users.

---

## Findings

### F-t2-onboarding-1: Two Separate Onboarding Systems Confuse Intent

**Severity:** High  
**Category:** ux | blocking-check  
**Location:** `src/renderer/src/App.tsx:201-214`, `src/renderer/src/components/Onboarding.tsx:113-248`, `src/renderer/src/components/onboarding/OnboardingWizard.tsx:14-72`  
**Evidence:**
- App.tsx renders `OnboardingWizard` if `showOnboarding` hook returns true (lines 201-209)
- If wizard is skipped/completed, then `Onboarding` component renders until `onReady()` is called (lines 212-213)
- Two separate UIs, two separate check mechanisms, unclear visual hierarchy

**Impact:** A fresh user sees either the wizard OR the check screen, depending on settings state. If they close the wizard midway or skip it, they land on the rigid check screen with no way back. Unclear which onboarding layer is responsible for which checks. If wizard is not triggered (bug), user sees just the check screen forever.

**Recommendation:** 
- Unify both systems: make wizard the primary flow for all new users
- Move git/auth checks into the wizard steps (already there for some)
- Remove or integrate the standalone `Onboarding` component as a fallback only if wizard is not triggerable
- Document the trigger condition for `showOnboarding` clearly: "fires only on first launch if onboarding.completed is falsy"

**Effort:** M  
**Confidence:** High

---

### F-t2-onboarding-2: "Continue Anyway" Button Enabled Even When Critical Checks Fail

**Severity:** Critical  
**Category:** blocking-check | ux  
**Location:** `src/renderer/src/components/Onboarding.tsx:228-243`  
**Evidence:**
```tsx
<Button variant="ghost" onClick={onReady} disabled={checking || anyRequiredFailed}>
  Continue Anyway
</Button>
```
- Button is disabled only if `checking` is true OR any required check failed
- However, once checks complete and any fail, button remains disabled — user cannot proceed with broken setup
- "Continue Anyway" label implies an override, but is effectively useless when git/auth/CLI checks fail
- User is stuck staring at the check screen with no actionable path forward

**Impact:** Fresh user with missing Claude CLI or no `claude login` sees a check screen that locks them out. The "Continue Anyway" button doesn't say "go fix this first" or provide next steps. Error messages are shown (e.g., "Run `claude login`"), but button is inaccessible, so user has no way to bypass.

**Recommendation:**
- Remove "Continue Anyway" button or only show it for optional/warning-level checks (repos configured)
- Provide a clearer error state: show what must be fixed, in bold/prominently
- Add a "Help" or "Why?" link next to each failed check that opens docs
- Once user fixes their setup externally, let them click "Check Again" to re-verify and unblock the main UI

**Effort:** S  
**Confidence:** High

---

### F-t2-onboarding-3: "Check Again" Button Usability Unclear

**Severity:** Medium  
**Category:** ux | copy  
**Location:** `src/renderer/src/components/Onboarding.tsx:221-232`  
**Evidence:**
```tsx
{instruction && !checking && (
  <div className="onboarding-instruction">
    <code className="onboarding-instruction__code">{instruction}</code>
  </div>
)}

{!checking && (
  <Button variant="ghost" onClick={runCheck} loading={checking} disabled={checking}>
    <RefreshCw size={14} />
    Check Again
  </Button>
)}
```
- "Check Again" button is only rendered if checks are complete (`!checking`)
- User is told "Run `claude login`" in a `<code>` block, but no clear link between that instruction and the "Check Again" button
- User may run the command in terminal, come back to BDE, and not know to click "Check Again"

**Impact:** User runs `claude login` in terminal, returns to BDE, sees the same failed check. Confusion: "Did it work?" Needs explicit CTA: "Ran the command? Check Again to verify."

**Recommendation:**
- Rename button to "Verify Setup" or "Check Again After Setup" to clarify intent
- Dynamically show/hide button only when there are failed required checks (not when all pass)
- Consider adding a small info icon next to instruction: "After running this command, click Check Again"

**Effort:** S  
**Confidence:** Medium

---

### F-t2-onboarding-4: Auth Token Expiry Check May Fail Silently

**Severity:** High  
**Category:** blocking-check  
**Location:** `src/main/auth-guard.ts:96-107`  
**Evidence:**
```ts
if (!oauth.expiresAt) {
  return { cliFound, tokenFound: true, tokenExpired: true }
}
const expiresMs = parseInt(oauth.expiresAt, 10)
if (Number.isNaN(expiresMs)) {
  return { cliFound, tokenFound: true, tokenExpired: true }
}
```
- If `expiresAt` is missing or NaN, token is marked as expired
- However, onboarding component's instruction logic doesn't explicitly handle this edge case separately
- User sees "Token is valid" fail, but instruction says "Run `claude login` to refresh your session"
- No diagnostic info on what went wrong (missing expiresAt vs. actual expiry)

**Impact:** User runs `claude login`, but if expiry parsing fails again (malformed keychain data), they see the same error. No clue whether it's a token issue or a data corruption issue.

**Recommendation:**
- Add explicit error messaging for "expiresAt malformed" vs. "token expired"
- Log warnings in main process when expiresAt parsing fails
- Consider a "Force Refresh" button that clears cached keychain and re-reads

**Effort:** M  
**Confidence:** Medium

---

### F-t2-onboarding-5: No Documentation Link for Claude Code CLI Install

**Severity:** Medium  
**Category:** ux | copy  
**Location:** `src/renderer/src/components/Onboarding.tsx:51-57, 191-195`  
**Evidence:**
```tsx
function getInstruction(status: AuthStatus | null): string | null {
  if (!status) return null
  if (!status.cliFound) return 'Install Claude Code CLI and add it to your PATH'
  ...
}
```
- Message "Install Claude Code CLI and add it to your PATH" is plain text in a code block
- No hyperlink to official docs, no Homebrew command, no download page
- Compare: GhStep has proper link `<a href="https://cli.github.com">` (line 84 in GhStep)

**Impact:** Unfamiliar user doesn't know how to install Claude CLI. Searches for "Claude Code CLI" and may find wrong docs. Wastes time.

**Recommendation:**
- Add a clickable link in the help text: "Install Claude Code CLI (https://claude.ai/docs/...)"
- Or provide the actual install command: `npm install -g @anthropic-ai/claude-cli` (or current method)
- Make it copy-pasteable so user can instantly run it in terminal

**Effort:** S  
**Confidence:** High

---

### F-t2-onboarding-6: WelcomeStep Back Button Does Nothing

**Severity:** Low  
**Category:** ux | accessibility  
**Location:** `src/renderer/src/components/onboarding/steps/WelcomeStep.tsx:42-45`  
**Evidence:**
```tsx
{!isFirst && (
  <Button variant="ghost" onClick={() => {}}>
    Back
  </Button>
)}
```
- Back button handler is an empty function `onClick={() => {}}`
- Button never appears on WelcomeStep anyway because `isFirst === true` (it's step 0)
- Dead code

**Impact:** Confusing to readers; suggests incomplete UX if user ever reaches a state where back is needed.

**Recommendation:** Remove dead code or properly wire the back button handler (`onClick={onBack}`).

**Effort:** S  
**Confidence:** High

---

### F-t2-onboarding-7: GitHub CLI Optional But Unclear (No Skip Button)

**Severity:** Medium  
**Category:** ux | copy  
**Location:** `src/renderer/src/components/onboarding/steps/GhStep.tsx:112-118`  
**Evidence:**
```tsx
<Button variant="primary" onClick={onNext} disabled={checking || !ready}>
  Next
  <ArrowRight size={16} />
</Button>
```
- GhStep Next button is disabled until both ghAvailable AND ghAuthenticated are true
- RepoStep has explicit "Skip for now" button (line 190, RepoStep.tsx)
- GhStep has no equivalent skip option — user cannot proceed until `gh auth login` succeeds
- User cannot bypass this step even if they don't intend to use GitHub PR features initially

**Impact:** User without `gh` installed is blocked at step 4. If they don't use GitHub (e.g., Gitea, GitLab), they're still forced to install and auth with `gh`, even though it's optional for core BDE functionality.

**Recommendation:**
- Add "Skip for now" button to GhStep (like RepoStep does)
- Or mark GhStep description as "(Required for PR features)" so user knows why they can't skip
- Or gate the PR functionality later at runtime instead of at onboarding

**Effort:** M  
**Confidence:** Medium

---

### F-t2-onboarding-8: Repositories Are Optional, But No Empty-State Guidance After Onboarding

**Severity:** Medium  
**Category:** empty-state | ux  
**Location:** `src/renderer/src/components/onboarding/steps/RepoStep.tsx:105-108`, `src/renderer/src/stores/panel-tree.ts:1` (DEFAULT_LAYOUT = 'dashboard')  
**Evidence:**
- RepoStep is optional; user can skip with "Skip for now" button
- DoneStep shows "Create your first task" button, which tries to use `repoOptions[0]?.label ?? ''` (DoneStep, line 25)
- If no repos configured, the first task's repo field is empty string
- Main app loads DEFAULT_LAYOUT = dashboard (empty state)

**Impact:** User completes onboarding without configuring repos, clicks "Create your first task", lands in Task Workbench with empty repo dropdown. Immediately confused: "Why is the repo field empty? How do I create a task?"

**Recommendation:**
- Show a banners/toast after onboarding if repos are empty: "No repositories configured. Go to Settings → Repositories to add one, or create a task on an existing repo."
- Or, auto-navigate to Settings:Repositories on first task creation if empty
- Or, require repos in onboarding (move from optional to required), but offer a quick "Detect Repos" scanner to auto-find local git repos on user's machine

**Effort:** M  
**Confidence:** High

---

### F-t2-onboarding-9: No Accessibility Labels on Check Rows

**Severity:** Low  
**Category:** accessibility  
**Location:** `src/renderer/src/components/Onboarding.tsx:59-111`  
**Evidence:**
```tsx
<div className="onboarding-check" style={{ gap: 'var(--bde-space-1)' }}>
  <div className="onboarding-check__row">
    <StatusIcon state={state} />
    <span className="onboarding-check__label">{label}</span>
```
- CheckRow divs have no role, no aria-label, no aria-describedby
- StatusIcon renders Lucide icons with no aria-label (pass/fail/loading not announced to screen readers)
- Keyboard navigation: unclear if checks are focusable

**Impact:** Screen reader users don't hear check status (pass/fail/loading); they only hear the label text. Icon states are silent.

**Recommendation:**
- Add role="status" or aria-live="polite" to each check row
- Add aria-label to StatusIcon: `aria-label={state === 'pass' ? 'Passed' : state === 'fail' ? 'Failed' : 'Loading'}`
- Ensure Tab navigation through buttons (Check Again, Continue, Continue Anyway) works smoothly
- Test with Narrator/VoiceOver

**Effort:** S  
**Confidence:** High

---

### F-t2-onboarding-10: OnboardingWizard Step Indicators Not Semantic

**Severity:** Low  
**Category:** accessibility  
**Location:** `src/renderer/src/components/onboarding/OnboardingWizard.tsx:48-57`  
**Evidence:**
```tsx
<div className="onboarding-wizard__step-indicator" data-testid={`step-indicator-${index}`}>
  <div className="onboarding-wizard__step-number">{index + 1}</div>
  <div className="onboarding-wizard__step-title">{step.title}</div>
</div>
```
- Step indicators are divs, not semantic elements
- No role="progressbar" or aria-current="step" to indicate active step
- Screen reader doesn't know which step is active

**Impact:** Keyboard/screen reader users don't get clear feedback on wizard progress.

**Recommendation:**
- Add `role="progressbar"` to progress container
- Add `aria-current="step"` to active step indicator
- Add `aria-label="Step X of N: StepTitle"` to each indicator

**Effort:** S  
**Confidence:** Medium

---

### F-t2-onboarding-11: No Test Coverage for Onboarding Paths

**Severity:** Medium  
**Category:** ux | blocking-check  
**Location:** No test files found matching `*onboarding*test*` or `*test*onboarding*`  
**Evidence:**
- Grep found zero test files for onboarding components
- No unit tests for Onboarding.tsx, OnboardingWizard.tsx, or step components
- No integration tests for check logic or handler calls

**Impact:** Regressions in onboarding flows are not caught by CI. A change to auth-guard or wizard logic could break first-launch silently.

**Recommendation:**
- Add `src/renderer/src/components/__tests__/Onboarding.test.tsx`
- Add `src/renderer/src/components/onboarding/__tests__/OnboardingWizard.test.tsx`
- Test: wizard advances correctly through steps, checks are performed, instructions display on failure, skip buttons work
- Test: auth check calls window.api.auth.status() and handles failures
- Test: repoStep persists repos to settings correctly

**Effort:** M  
**Confidence:** High

---

### F-t2-onboarding-12: "Setting" Key `onboarding.completed` Not Documented

**Severity:** Low  
**Category:** ux  
**Location:** `src/renderer/src/hooks/useOnboardingCheck.ts:11`, `src/renderer/src/components/onboarding/steps/DoneStep.tsx:27`  
**Evidence:**
```ts
window.api.settings.get('onboarding.completed').then((val) => {
  if (!val) {
    setShowOnboarding(true)
  }
})
```
- Magic string 'onboarding.completed' used in multiple places
- No constant export or explanation of what this flag controls
- If a user manually deletes this setting, onboarding re-triggers on next restart

**Impact:** Confusing state management; unclear how/why onboarding is triggered. Support burden if users accidentally reset it.

**Recommendation:**
- Define a constant: `export const ONBOARDING_COMPLETED_SETTING = 'onboarding.completed'` in a settings module
- Document the setting in CLAUDE.md or a Settings schema file
- Consider versioning: `onboarding.v1.completed` in case onboarding steps change and you need users to re-run it

**Effort:** S  
**Confidence:** Low

---

### F-t2-onboarding-13: GhStep Version Display Does Not Validate Minimum Version

**Severity:** Low  
**Category:** blocking-check  
**Location:** `src/renderer/src/components/onboarding/steps/GhStep.tsx:61-63`, `src/main/handlers/auth-handlers.ts:18-32`  
**Evidence:**
```tsx
<span>
  {ghAvailable && ghVersion ? `gh CLI is available (${ghVersion})` : 'gh CLI is available on PATH'}
</span>
```
- Shows gh version string as-is (e.g., "gh version 1.25.0 (2024-04-01)")
- No check that version meets minimum requirements
- User could have an ancient `gh` that lacks features BDE needs

**Impact:** User has outdated `gh` CLI, onboarding passes, but later PR creation fails silently.

**Recommendation:**
- Parse version from output
- Compare against MIN_GH_VERSION (e.g., "2.0.0")
- Show warning if too old: "gh CLI is outdated (v1.x). Please upgrade to v2.0+: `brew upgrade gh`"

**Effort:** M  
**Confidence:** Low

---

### F-t2-onboarding-14: DoneStep Always Uses First Repo, Not Selected Repo

**Severity:** Medium  
**Category:** ux  
**Location:** `src/renderer/src/components/onboarding/steps/DoneStep.tsx:22-33`  
**Evidence:**
```tsx
const handleCreateFirstTask = (): void => {
  setField('title', SAMPLE_FIRST_TASK.title)
  setField('spec', SAMPLE_FIRST_TASK.spec)
  setField('repo', repoOptions[0]?.label ?? '')  // Always first repo
  setSpecType(SAMPLE_FIRST_TASK.specType)
```
- "Create your first task" button auto-fills repo with `repoOptions[0]`
- If user has multiple repos and wants to use the second one, they must manually select it after task is created
- UI doesn't ask user which repo they want

**Impact:** User with 10 repos sees first task created with repo #1. Confusion: "I didn't want to start with that repo."

**Recommendation:**
- If multiple repos configured, show a dropdown selector in DoneStep: "Select a repo to start with"
- Or, require at least one repo to be selected during onboarding
- Or, accept the limitation and document it: "First task will be created on your first repository. You can change it in the task workbench."

**Effort:** S  
**Confidence:** Medium

---

### F-t2-onboarding-15: No Network Timeout Handling for Auth Checks

**Severity:** Medium  
**Category:** blocking-check  
**Location:** `src/renderer/src/components/Onboarding.tsx:121-159`  
**Evidence:**
```tsx
const [authResult] = await Promise.allSettled([
  window.api.auth.status().then((result) => {
    setStatus(result)
    return result
  })
])
```
- `window.api.auth.status()` call has no explicit timeout
- If network is slow or IPC handler hangs, user sees "Loading..." forever
- No error boundary or max-wait timer

**Impact:** User on slow network (or with a misconfigured handler) sees spinner indefinitely. No way to cancel or retry. Appears frozen.

**Recommendation:**
- Add Promise.race() with a timeout (e.g., 5 seconds): 
  ```ts
  Promise.race([
    window.api.auth.status(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Check timeout')), 5000))
  ])
  ```
- Catch timeout and show error: "Verification timed out. Try 'Check Again' or check system network settings."
- Log warnings in main process if checks are slow

**Effort:** M  
**Confidence:** High

---

### F-t2-onboarding-16: RepoStep Inline Form Styling Inconsistent with Settings UI

**Severity:** Low  
**Category:** ux  
**Location:** `src/renderer/src/components/onboarding/steps/RepoStep.tsx:125-180`  
**Evidence:**
```tsx
<div className="onboarding-step__repo-form" style={{ marginTop: '1rem' }}>
  <div className="settings-repo-form">
```
- RepoStep reuses `.settings-repo-form` classes from the Settings UI
- CSS classes are tied to Settings context, not onboarding
- If Settings form is refactored, onboarding breaks

**Impact:** Maintenance burden; tight coupling between two unrelated contexts.

**Recommendation:**
- Extract repo form into a reusable `<RepoForm />` component
- Use it in both Settings and RepoStep, passing handlers as props
- Decouple CSS classes from Settings context

**Effort:** M  
**Confidence:** Low

---

## Summary by Severity

| Count | Severity   | Category          |
|-------|-----------|------------------|
| 1     | Critical   | blocking-check   |
| 4     | High       | ux/blocking-check|
| 5     | Medium     | ux/accessibility |
| 5     | Low        | ux/accessibility |

**Critical Issues (Must Fix for First Launch):**
1. "Continue Anyway" button disabled when checks fail, traps user
2. Two onboarding layers create confusion

**High Priority (Should Fix Before Release):**
1. No link/docs for Claude CLI install
2. Auth token expiry parsing can fail silently
3. Network timeout can freeze UI indefinitely
4. No test coverage for onboarding

**Medium Priority (Nice to Have):**
1. GitHub CLI should be skippable
2. Empty-state guidance if no repos configured
3. Accessibility labels missing
4. First task always uses first repo

---

## Recommended Launch Checklist

- [ ] Fix critical issues #1, #2
- [ ] Add documentation link for Claude CLI install
- [ ] Add timeout to auth/git checks
- [ ] Test wizard flow end-to-end: fresh Mac, no prior setup
- [ ] Test with screen reader (Narrator/VoiceOver)
- [ ] Test slow network / IPC timeout scenarios
- [ ] Add basic unit tests for onboarding steps
- [ ] Document settings keys (onboarding.completed)
- [ ] Verify all error messages are actionable (user knows what to do next)
