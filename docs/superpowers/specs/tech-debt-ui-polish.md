# Tech Debt: UI Polish - Source Control CSS & Dashboard Error Handling

## Overview

Two independent UI polish tasks:

1. **Source Control CSS consolidation** — Move Git-related CSS rules from `diff.css` to `source-control-neon.css` to improve maintainability
2. **Dashboard per-card error retry** — Replace global retry button with per-card retry buttons for better UX

Both are low-risk refactors with clear success criteria.

---

## Task 1: Consolidate Source Control CSS

### Problem

The Source Control view (GitTreeView) has CSS split across two files:

- `src/renderer/src/assets/source-control-neon.css` — Git Tree view styles (lines 1-579)
- `src/renderer/src/assets/diff.css` — Contains Git Client section (lines 329-589)

The Git Client rules in `diff.css` (`.git-branch-select`, `.git-push-output`, `.git-client`, `.git-sidebar`, `.git-file-item`, `.git-commit-panel`, `.git-diff-pane`) are used by the Source Control view, not by diff viewers in PR Station.

### Implementation

**File: `src/renderer/src/assets/diff.css`**

Remove lines 329-589 (the entire "Git Client" section). This includes:

```css
/* ── Git Client ────────────────────────────────────────── */

.git-branch-select {
  background: var(--bde-surface);
  /* ... */
}

.git-push-output {
  /* ... */
}

/* ... all other .git-* rules ... */

.git-diff-pane__file-path {
  font-family: var(--bde-font-code);
  font-size: var(--bde-size-sm);
  color: var(--bde-accent);
  font-weight: 500;
}
```

**File: `src/renderer/src/assets/source-control-neon.css`**

Append the removed Git Client CSS rules to the end of this file (after line 579). No modifications needed — just move as-is.

### Verification

1. Run `npm run typecheck` — should pass
2. Run `npm test` — should pass (CSS changes don't affect tests)
3. Manual smoke test:
   - Launch BDE dev mode: `npm run dev`
   - Navigate to Source Control view (⌘6)
   - Verify all UI elements render correctly:
     - Branch selector dropdown
     - File list sections (staged/modified/untracked)
     - Commit box with textarea and buttons
     - Inline diff drawer
     - Push output banner (if visible)
   - Navigate to PR Station view (⌘5)
   - Open a PR detail
   - Verify diff viewer still renders correctly (no broken styles)

### Success Criteria

- All Git Client CSS rules removed from `diff.css`
- All Git Client CSS rules present in `source-control-neon.css`
- Source Control view renders identically before/after
- PR Station diff viewer unaffected
- No console warnings about missing styles

---

## Task 2: Dashboard Per-Card Error Retry

### Problem

The Dashboard view (`src/renderer/src/views/DashboardView.tsx`) fetches data for multiple cards:

- Completions per hour chart (lines 139-159)
- Recent events feed (lines 161-180)
- PR count (lines 182-189)

Errors are tracked per-card in `cardErrors` state (line 62), but only a single global "Retry" button is shown (lines 238-247) that retries ALL cards, even those that succeeded.

### Current Behavior

```tsx
// Line 62
const [cardErrors, setCardErrors] = useState<{ chart?: string; feed?: string; prs?: string }>({})

// Lines 156-159 (chart error)
} catch (err) {
  console.error('[Dashboard] Failed to fetch completions:', err)
  errors.chart = 'Failed to load completions'
}

// Lines 232-251 (global error display)
{fetchError ? (
  <span className="dashboard-status-error">
    {Object.values(cardErrors).join(' · ') || 'Failed to load dashboard data'}
    <button onClick={() => fetchDashboardData()} className="dashboard-retry-btn">
      Retry
    </button>
  </span>
) : (
  'SYS.OK'
)}
```

### Desired Behavior

Each card should show its own error state with a retry button that only refetches that card's data.

### Implementation

**Step 1: Extract per-card fetch functions**

In `DashboardView.tsx`, after line 133, add three new async functions:

```tsx
const fetchCompletionsChart = useCallback(async (): Promise<void> => {
  try {
    const data = await window.api.dashboard?.completionsPerHour()
    if (cancelledRef.current || !data) return
    const accents: Array<'cyan' | 'pink' | 'blue' | 'orange' | 'purple'> = [
      'cyan',
      'pink',
      'blue',
      'orange',
      'purple'
    ]
    setChartData(
      data.map((d, i) => ({
        value: d.count,
        accent: accents[i % accents.length],
        label: d.hour
      }))
    )
    setCardErrors((prev) => ({ ...prev, chart: undefined }))
  } catch (err) {
    console.error('[Dashboard] Failed to fetch completions:', err)
    setCardErrors((prev) => ({ ...prev, chart: 'Failed to load completions' }))
  }
}, [])

const fetchActivityFeed = useCallback(async (): Promise<void> => {
  try {
    const events = await window.api.dashboard?.recentEvents(30)
    if (cancelledRef.current || !events) return
    setFeedEvents(
      events.map((e) => ({
        id: String(e.id),
        label: `${e.event_type}: ${e.agent_id}`,
        accent:
          e.event_type === 'error'
            ? ('red' as const)
            : e.event_type === 'complete'
              ? ('cyan' as const)
              : ('purple' as const),
        timestamp: e.timestamp
      }))
    )
    setCardErrors((prev) => ({ ...prev, feed: undefined }))
  } catch (err) {
    console.error('[Dashboard] Failed to fetch events:', err)
    setCardErrors((prev) => ({ ...prev, feed: 'Failed to load activity feed' }))
  }
}, [])

const fetchPRCount = useCallback(async (): Promise<void> => {
  try {
    const prs = await window.api.getPrList()
    if (cancelledRef.current) return
    setPrCount(prs?.prs?.length ?? 0)
    setCardErrors((prev) => ({ ...prev, prs: undefined }))
  } catch (err) {
    console.error('[Dashboard] Failed to fetch PR list:', err)
    setCardErrors((prev) => ({ ...prev, prs: 'Failed to load PR data' }))
  }
}, [])
```

**Step 2: Update `fetchDashboardData` to call extracted functions**

Replace lines 134-197 with:

```tsx
const fetchDashboardData = useCallback(async (): Promise<void> => {
  setLoading(true)
  setFetchError(false)

  await Promise.all([fetchCompletionsChart(), fetchActivityFeed(), fetchPRCount()])

  if (!cancelledRef.current) {
    const anyError = Object.values(cardErrors).length > 0
    setFetchError(anyError)
    setLoading(false)
  }
}, [fetchCompletionsChart, fetchActivityFeed, fetchPRCount])
```

**Step 3: Remove global retry button**

In the StatusBar (lines 229-252), remove the retry button:

```tsx
<StatusBar title="BDE Command Center" status="ok">
  {loading && !chartData.length ? (
    <span className="dashboard-status-loading">Loading...</span>
  ) : fetchError ? (
    <span className="dashboard-status-error" style={{ color: neonVar('red', 'color') }}>
      {Object.values(cardErrors).filter(Boolean).length} card
      {Object.values(cardErrors).filter(Boolean).length !== 1 ? 's' : ''} failed
    </span>
  ) : (
    'SYS.OK'
  )}
</StatusBar>
```

**Step 4: Add per-card error overlays**

Wrap each affected NeonCard with conditional error state. Example for the Completions chart (around line 302):

```tsx
<NeonCard accent="cyan" title="Completions / Hour" icon={<Zap size={12} />}>
  {cardErrors.chart ? (
    <div className="dashboard-card-error">
      <div className="dashboard-card-error__message">{cardErrors.chart}</div>
      <button
        className="dashboard-card-error__retry"
        onClick={() => fetchCompletionsChart()}
        style={{
          border: `1px solid ${neonVar('red', 'color')}`,
          color: neonVar('red', 'color')
        }}
      >
        Retry
      </button>
    </div>
  ) : (
    <>
      <MiniChart data={chartData} height={120} />
      <div className="dashboard-chart-caption">last 24 hours</div>
    </>
  )}
</NeonCard>
```

Repeat for the Activity Feed card (line 337) with `cardErrors.feed` and `fetchActivityFeed()`.

For the PR count card (line 284), add error badge inline instead of replacing content:

```tsx
<StatCounter
  label="PRs"
  value={cardErrors.prs ? 0 : prCount}
  accent={cardErrors.prs ? 'red' : 'blue'}
  icon={<GitPullRequest size={10} />}
  onClick={() => (cardErrors.prs ? fetchPRCount() : navigateToSprintWithFilter('awaiting-review'))}
/>
```

**Step 5: Add CSS for card error state**

In `src/renderer/src/assets/dashboard-neon.css`, append:

```css
/* ── Card Error State ── */
.dashboard-card-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--bde-space-2);
  padding: var(--bde-space-4);
  min-height: 120px;
}

.dashboard-card-error__message {
  font-size: var(--bde-size-sm);
  color: var(--neon-red);
  text-align: center;
}

.dashboard-card-error__retry {
  padding: 4px 12px;
  border-radius: var(--bde-radius-sm);
  background: rgba(255, 50, 50, 0.1);
  font-size: var(--bde-size-xs);
  font-weight: 600;
  cursor: pointer;
  transition: background var(--bde-transition-fast);
}

.dashboard-card-error__retry:hover {
  background: rgba(255, 50, 50, 0.2);
}
```

### Verification

1. **Type check**: `npm run typecheck` — should pass
2. **Unit tests**: `npm test` — should pass (no Dashboard tests currently)
3. **Manual smoke test**:
   - Launch dev mode: `npm run dev`
   - Navigate to Dashboard (⌘1)
   - **Simulate chart error**: Kill dashboard IPC handler temporarily or inject error in `fetchCompletionsChart`
   - Verify:
     - StatusBar shows "1 card failed" (not full error text)
     - Completions chart card shows inline error with "Retry" button
     - Other cards (Feed, PRs) still render normally
     - Click "Retry" on chart card
     - Only chart refetches (check console logs)
   - **Simulate multiple errors**: Inject errors in both chart and feed
   - Verify:
     - StatusBar shows "2 cards failed"
     - Both cards show inline error states
     - PR count card unaffected
     - Each retry button only refetches its own data

### Success Criteria

- Global retry button removed from StatusBar
- StatusBar shows count of failed cards (e.g., "2 cards failed")
- Each failed card shows inline error message + retry button
- Retry buttons only refetch their own data (not all cards)
- Successful cards display normally even when others fail
- No console errors
- No regressions in Dashboard polling behavior

---

## Testing Checklist

- [ ] TypeScript compiles: `npm run typecheck`
- [ ] Tests pass: `npm test`
- [ ] Source Control view renders correctly (Task 1)
- [ ] PR Station diff viewer unaffected (Task 1)
- [ ] Dashboard cards show per-card errors (Task 2)
- [ ] Dashboard retry buttons work independently (Task 2)
- [ ] No console warnings or errors

---

## Notes

- **CSS file order**: Verify `main.css` imports `source-control-neon.css` after `diff.css` to maintain cascade order
- **Dashboard error simulation**: Use browser DevTools Network tab to block API responses for testing
- **No breaking changes**: Both tasks are pure refactors with no functional changes
- **Commit separately**: Create two separate commits (one per task) for easier review

---

## Estimated Effort

- Task 1 (CSS consolidation): 10 minutes
- Task 2 (Per-card retry): 30 minutes
- Total: ~40 minutes
