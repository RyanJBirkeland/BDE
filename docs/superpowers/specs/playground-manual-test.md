# Dev Playground — Manual Test Script

**Purpose:** Verify the full playground flow end-to-end in the BDE application

**Prerequisites:**

- BDE app running in development mode (`npm run dev`)
- Task with `playground_enabled: true` created
- Agent prompt that will generate HTML files

---

## Test 1: Basic Playground Flow

### Setup

1. Open BDE
2. Navigate to Sprint Center
3. Create a new task:
   - Title: "Create a simple HTML preview"
   - Prompt: "Create a simple HTML file with a centered h1 saying 'Hello Playground'"
   - ✅ Check "Dev Playground" checkbox
   - Click "Create Task"

### Expected Behavior

1. ✅ Task should be created with `playground_enabled: true`
2. ✅ Agent system prompt should include playground instructions
3. ✅ Agent should write an HTML file (e.g., `preview.html`)
4. ✅ Playground card should appear inline in agent chat
5. ✅ Card should show:
   - File icon (FileCode)
   - Filename (e.g., "preview.html")
   - File size (e.g., "125 B")
   - "Preview" button/hint

### Verification

- [ ] Card appears in chat
- [ ] Filename is correct
- [ ] File size is displayed
- [ ] Card has hover effect (border color changes to accent)

---

## Test 2: Modal Opening and Rendering

### Action

1. Click the playground card from Test 1

### Expected Behavior

1. ✅ Modal should open immediately
2. ✅ Modal should cover ~90% of viewport
3. ✅ Toolbar should show:
   - File icon
   - Filename
   - File size
   - View mode toggle (Split | Preview | Source)
   - "Open in Browser" button
   - Close button (✕)
4. ✅ Split view (default):
   - Left pane: Sandboxed iframe rendering HTML
   - Right pane: Source code with syntax highlighting and line numbers
5. ✅ Iframe should render the HTML correctly (centered "Hello Playground" heading)

### Verification

- [ ] Modal opens without errors
- [ ] Both panes are visible
- [ ] Iframe renders HTML correctly
- [ ] Source shows colored syntax (tags, attributes, strings)
- [ ] Line numbers are visible (1, 2, 3...)

---

## Test 3: View Mode Switching

### Actions

1. Click "Preview" tab
2. Verify preview-only mode
3. Click "Source" tab
4. Verify source-only mode
5. Click "Split" tab
6. Verify split mode restored

### Expected Behavior

1. **Preview Mode:**
   - ✅ Only iframe visible
   - ✅ No source pane
   - ✅ Preview tab highlighted (accent color)

2. **Source Mode:**
   - ✅ Only source pane visible
   - ✅ No iframe
   - ✅ Source tab highlighted

3. **Split Mode:**
   - ✅ Both panes visible
   - ✅ Split tab highlighted

### Verification

- [ ] Preview mode works
- [ ] Source mode works
- [ ] Split mode works
- [ ] Active tab is visually distinct
- [ ] No layout jank when switching

---

## Test 4: Modal Closing

### Actions (perform separately)

1. Press Escape key
2. Click overlay (dark area outside modal)
3. Click close button (✕)

### Expected Behavior

- ✅ Modal closes immediately
- ✅ No errors in console
- ✅ Chat is still visible with playground card

### Verification

- [ ] Escape closes modal
- [ ] Overlay click closes modal
- [ ] Close button closes modal
- [ ] Modal does not close when clicking content area

---

## Test 5: Multiple Playground Files

### Setup

1. Create a task with prompt:
   ```
   Create 3 different HTML files:
   1. v1.html - Red background with "Version 1"
   2. v2.html - Blue background with "Version 2"
   3. v3.html - Green background with "Version 3"
   ```
2. ✅ Enable playground

### Expected Behavior

1. ✅ Agent writes 3 separate .html files
2. ✅ 3 playground cards appear in chat (stacked vertically)
3. ✅ Each card shows correct filename (v1.html, v2.html, v3.html)
4. ✅ Clicking each card opens the corresponding preview

### Verification

- [ ] All 3 cards appear
- [ ] Each card is clickable
- [ ] Each modal shows different content
- [ ] Can switch between cards by closing and reopening

---

## Test 6: Security — Sandbox Isolation

### Setup

1. Create a task with prompt:
   ```
   Create an HTML file with:
   - A button that tries to alert("Hello")
   - A script that tries to access window.parent
   - A script that tries to navigate top frame
   ```
2. ✅ Enable playground

### Expected Behavior

1. ✅ HTML file is created
2. ✅ Card appears
3. ✅ Modal opens
4. ✅ Iframe has `sandbox="allow-scripts"` attribute
5. ✅ Button click works (alert shows)
6. ⚠️ `window.parent` access is blocked (logs error to iframe console)
7. ⚠️ Top frame navigation is blocked

### Verification

- [ ] Iframe has `sandbox="allow-scripts"` (inspect DOM)
- [ ] No `allow-same-origin` attribute
- [ ] Scripts run (alert works)
- [ ] Parent access is blocked

---

## Test 7: Large File Handling

### Setup

1. Create a task that generates a large HTML file (e.g., 6MB)
2. Try to preview it

### Expected Behavior

1. ✅ Handler rejects files > 5MB
2. ✅ Error message shown (not card)
3. ✅ Message mentions file size limit

### Verification

- [ ] Files > 5MB are rejected
- [ ] Clear error message displayed
- [ ] Files ≤ 5MB work normally

---

## Test 8: Non-.html File Handling

### Setup

1. Create a task that writes various file types:
   - `test.txt`
   - `style.css`
   - `script.js`
   - `data.json`
   - `preview.html` (should work)

### Expected Behavior

1. ✅ Only .html files trigger playground cards
2. ✅ Other files are ignored (no playground events)
3. ✅ Agent can still write non-HTML files normally

### Verification

- [ ] Only .html files create cards
- [ ] No errors for non-HTML files
- [ ] Other tool results render normally

---

## Test 9: Prompt Augmentation

### Setup

1. Create two tasks with identical prompts but different playground settings
2. Compare agent behavior

### Task A (playground disabled)

- Prompt: "Create an HTML preview"
- Playground: ❌ Disabled

### Task B (playground enabled)

- Prompt: "Create an HTML preview"
- Playground: ✅ Enabled

### Expected Behavior

1. **Task A:**
   - Agent may try to open browser or start server
   - No playground instructions in system prompt

2. **Task B:**
   - Agent writes self-contained HTML
   - System prompt includes: "You have access to a Dev Playground"
   - No `open` or `localhost` commands

### Verification

- [ ] Task A does not get playground instructions
- [ ] Task B gets playground instructions
- [ ] Task B agent behavior changes accordingly

---

## Test 10: Keyboard Navigation

### Actions

1. Open playground modal
2. Test keyboard shortcuts:
   - Tab through controls
   - Space/Enter to activate buttons
   - Escape to close

### Expected Behavior

- ✅ Tab moves focus between toolbar buttons
- ✅ View mode tabs are keyboard-navigable
- ✅ Space/Enter activates focused button
- ✅ Escape closes modal
- ✅ Focus returns to card when modal closes

### Verification

- [ ] All interactive elements are reachable via Tab
- [ ] Focus indicators are visible
- [ ] Keyboard shortcuts work
- [ ] Focus management is correct

---

## Test 11: Content Preservation

### Setup

1. Create HTML with special characters:
   ```html
   <html>
     <body>
       <h1>Test & "quotes" & 'apostrophes'</h1>
       <p>Symbols: <>&"'</p>
     </body>
   </html>
   ```

### Expected Behavior

- ✅ HTML content is preserved exactly (no sanitization)
- ✅ Special characters render correctly in iframe
- ✅ Source code shows escaped entities in syntax highlighting

### Verification

- [ ] Content displays correctly
- [ ] No corruption or encoding issues
- [ ] Source pane shows proper escaping

---

## Test 12: Responsive Layout

### Actions

1. Open playground modal
2. Resize BDE window
3. Test at different sizes (small, medium, large)

### Expected Behavior

- ✅ Modal scales to 90vw × 90vh at all sizes
- ✅ Split view maintains 50/50 layout
- ✅ Toolbar remains readable
- ✅ Source code wraps or scrolls appropriately

### Verification

- [ ] Modal is responsive
- [ ] No layout overflow
- [ ] All content remains accessible

---

## Success Criteria

All checkboxes must be ✅ for the feature to be considered complete and functional.

**Total Tests:** 12
**Test Cases:** 60+

---

## Known Limitations (Expected)

1. ❌ No DevTools integration (Console/Elements) in modal
2. ❌ No hot-reload — new file write creates new card
3. ❌ No file watching — agent must explicitly write new file
4. ❌ Files are ephemeral (live with worktree, not persisted)
5. ❌ No support for external CSS/JS (must be inline)

---

## Bug Reporting Template

If any test fails, report using this template:

```
**Test:** [Test number and name]
**Expected:** [What should happen]
**Actual:** [What actually happened]
**Steps to Reproduce:**
1. ...
2. ...
3. ...
**Console Errors:** [Paste any errors]
**Screenshot:** [Attach if relevant]
```
