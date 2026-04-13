# IDE: wire Cmd+F to Monaco find widget when editor is focused

## Problem

`src/renderer/src/views/IDEView.tsx` (shortcuts list around lines 23-37) binds `Cmd+F` to "Find in terminal" — the terminal's find widget. When the user has Monaco editor focus and presses Cmd+F expecting to find text in the file they're editing, the terminal find opens instead. Every developer tool on earth uses Cmd+F for editor find.

Monaco has a built-in find widget (`editor.getAction('actions.find').run()`) that is always available — BDE just isn't routing Cmd+F to it when the editor is focused.

Flagged by Bravo PM and Bravo Senior Dev as MAJOR.

## Solution

When a Monaco editor tab is focused, Cmd+F should open Monaco's find widget. When the terminal is focused, Cmd+F should open the terminal's find (current behavior). The decision is based on focus.

Preferred implementation:

1. On the Monaco editor mount (`onMount` callback — probably in `src/renderer/src/components/ide/EditorTab.tsx` or similar), register a command: `editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => editor.getAction('editor.action.startFindReplaceAction')?.run())` — or whatever the Monaco API is for triggering find. Read the Monaco imports already in the file to figure out the exact pattern.
2. Let Monaco handle it locally — no global listener needed. Monaco's keybinding only fires when the editor has focus.
3. Leave the terminal's Cmd+F handler in place — it only fires when the terminal has focus, so there's no conflict.
4. Update the shortcuts help overlay (in `IDEView.tsx` around line 23-37) to list both: "Cmd+F in editor: find in file, Cmd+F in terminal: find in terminal".

Do NOT add a global Cmd+F listener in the renderer. Do NOT try to detect which sub-component has focus from outside — let Monaco and the terminal each own their own Cmd+F.

## Files to Change

- The Monaco editor mount file (find via `grep -l "onMount\|monaco.editor" src/renderer/src/components/ide/`) — register the Cmd+F command
- `src/renderer/src/views/IDEView.tsx` — update the shortcuts help text if it lists Cmd+F

## How to Test

1. `npm run typecheck` — 0 errors
2. `npm run test:coverage` — all tests pass
3. `npm run lint` — 0 errors
4. Run IDE tests in isolation first if you see failures.
5. `grep -rn "startFindReplace\|actions.find\|KeyCode.KeyF" src/renderer/src/components/ide/` — must show at least one match after the fix.

## Out of Scope

- Cmd+Shift+F project-wide search (separate task — requires ripgrep IPC)
- Changing Find & Replace UX within Monaco itself
- Touching the terminal find widget
- Adding any keybinding customization UI
