# BDE v<VERSION>

<!--
Paste this template into the body of a new GitHub release.
Fill in the highlights and let GitHub auto-generate the "What's Changed" list.
The install block below MUST stay at the top so users hit it before scrolling.
-->

## Install (macOS, Apple Silicon)

BDE is distributed **unsigned**. macOS Gatekeeper will block the first launch until you explicitly allow it.

1. Download `BDE-<VERSION>-arm64.dmg` below.
2. Double-click the DMG and drag `BDE.app` into `Applications`.
3. Open the `Applications` folder, **right-click** `BDE.app`, and choose **Open**. *Do not double-click the first time.*
4. Gatekeeper warns "BDE cannot be verified" — click **Open**. macOS remembers the choice; normal double-click works afterward.

**Power-user shortcut** — clear quarantine in one command, then double-click to launch:

```bash
xattr -dr com.apple.quarantine /Applications/BDE.app
```

Full walkthrough with screenshots: [INSTALL.md](https://github.com/RyanJBirkeland/BDE/blob/main/INSTALL.md).

## Prerequisites

- Claude Code CLI installed and authenticated (`claude login`).
- `git` and `gh` CLIs on `PATH`.

## Highlights

<!-- Replace with 2-5 bullets summarizing this release's user-facing changes. -->
-
-

## What's Changed

<!-- GitHub auto-generates this list from merged PRs; leave the marker below and click "Generate release notes" in the draft. -->
<!-- AUTO-GENERATED-NOTES -->
