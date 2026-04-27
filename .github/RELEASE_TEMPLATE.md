# FLEET v<VERSION>

<!--
Paste this template into the body of a new GitHub release.
Fill in the highlights and let GitHub auto-generate the "What's Changed" list.
The install block below MUST stay at the top so users hit it before scrolling.
-->

## Install (macOS, Apple Silicon)

FLEET is distributed **unsigned**. macOS Gatekeeper will block the first launch until you explicitly allow it.

1. Download `FLEET-<VERSION>-arm64.dmg` below.
2. Double-click the DMG and drag `FLEET.app` into `Applications`.
3. Open the `Applications` folder, **right-click** `FLEET.app`, and choose **Open**. *Do not double-click the first time.*
4. Gatekeeper warns "FLEET cannot be verified" — click **Open**. macOS remembers the choice; normal double-click works afterward.

**Power-user shortcut** — clear quarantine in one command, then double-click to launch:

```bash
xattr -dr com.apple.quarantine /Applications/FLEET.app
```

Full walkthrough with screenshots: [INSTALL.md](https://github.com/RyanJBirkeland/FLEET/blob/main/INSTALL.md).

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
