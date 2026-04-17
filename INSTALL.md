# Installing BDE on macOS

BDE is distributed as an unsigned DMG. macOS Gatekeeper blocks unsigned apps on first launch — the workaround is a one-time right-click → Open. After that, the app launches normally.

This document walks through the full install with the exact prompts you will see.

---

## Prerequisites

Before running BDE, make sure you have:

- **macOS** 12 (Monterey) or later on Apple Silicon (arm64).
- **Claude Code CLI** installed and authenticated — run `claude login` at least once.
- **git** on `PATH`.
- **GitHub CLI (`gh`)** on `PATH` — optional but required for PR features.

BDE checks all four on first launch and surfaces an actionable error for any that are missing.

---

## Step 1 — Download and mount the DMG

Grab the latest `BDE-<version>-arm64.dmg` from the [Releases page](https://github.com/RyanJBirkeland/BDE/releases). Double-click the downloaded file to mount it.

A Finder window opens showing two icons side by side:

```
   ┌─────────────────────────────────────────────┐
   │                                             │
   │     ╔══════╗              ╔══════╗          │
   │     ║  B   ║              ║  📁  ║          │
   │     ║ D E  ║    ───▶      ║      ║          │
   │     ╚══════╝              ╚══════╝          │
   │      BDE                Applications        │
   │                                             │
   └─────────────────────────────────────────────┘
```

---

## Step 2 — Copy BDE to Applications

Drag `BDE` onto the `Applications` shortcut. The OS copies it into `/Applications`.

Eject the DMG by dragging the mounted volume to the Trash (or pressing **Cmd+E** in Finder).

---

## Step 3 — First launch (the Gatekeeper step)

**This is the one step where unsigned builds differ from the App Store experience.**

Open the `Applications` folder in Finder. Locate `BDE`. **Right-click** (or hold Control and click) the icon, then select **Open** from the context menu:

```
   ┌─────────────── Right-click menu ────────────┐
   │  Open                  ◀── choose this      │
   │  Show Package Contents                      │
   │  ─────────────────────                      │
   │  Move to Trash                              │
   │  ─────────────────────                      │
   │  Get Info                                   │
   │  ...                                        │
   └─────────────────────────────────────────────┘
```

macOS will display a warning dialog:

```
   ┌─────────────────────────────────────────────┐
   │  ⚠   macOS cannot verify the developer      │
   │      of "BDE".                              │
   │                                             │
   │      Are you sure you want to open it?      │
   │                                             │
   │               [ Move to Trash ]  [ Open ]   │
   └─────────────────────────────────────────────┘
```

Click **Open**. The app launches. macOS records your decision, so every subsequent launch works from a normal double-click.

> **Why not double-click the first time?** Double-clicking an unsigned app produces a strict dialog with no **Open** button — only **Cancel** / **Move to Trash**. Right-click → Open is the documented Apple workaround that adds the **Open** button.

---

## Power-user shortcut

If you prefer a terminal-only workflow, you can clear the quarantine attribute before double-clicking:

```bash
xattr -dr com.apple.quarantine /Applications/BDE.app
```

After this command, the app launches from a plain double-click with no warning dialog. The `-r` flag handles the entire bundle.

---

## Troubleshooting

### "BDE is damaged and can't be opened. You should move it to the Trash."

This means quarantine is still set and you double-clicked instead of right-clicking. Use the power-user shortcut above, or re-run the right-click → Open flow from Step 3.

### "BDE cannot be opened because the developer cannot be verified" (no **Open** button)

You double-clicked on first launch. Close the dialog and return to Step 3 — right-click → Open has an **Open** button that plain double-click does not.

### First launch opens a setup wizard asking for Claude CLI, token, git, and repos

That is expected. BDE runs a readiness check on first launch and walks you through any missing prerequisites. Running `claude login` in a terminal before launching BDE skips the auth portion of the wizard.

### The app opens but the Terminal panel is empty or errors on launch

This is a native-module rebuild problem — usually only hit by developers running from source, not DMG installs. See [CLAUDE.md](./CLAUDE.md) for the rebuild pipeline and required Node version.

---

## What BDE does on first launch

- Creates `~/.bde/` (SQLite DB, logs, OAuth token cache).
- Runs readiness checks for Claude CLI, `git`, `gh`, and configured repositories.
- Shows the onboarding wizard once; subsequent launches skip to the main UI.

All state is local. BDE does not send telemetry or phone home.

---

## Uninstall

```bash
rm -rf /Applications/BDE.app
rm -rf ~/.bde         # deletes database, logs, and OAuth token cache
```

That fully removes the app. If you had active git worktrees under `~/worktrees/bde/`, delete them separately.
