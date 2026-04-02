# Agent Permissions Settings — Design Spec

**Date:** 2026-03-30
**Status:** Draft (not yet implemented)

## Overview

Add a dedicated "Agent Permissions" section in Settings where users can view, modify, and understand what BDE-spawned agents are allowed to do. Includes a first-time consent banner explaining why permissions are needed.

## Requirements

- **Settings > Agent Permissions tab** — shows current allow/deny rules from `~/.claude/settings.json`
- **First-time banner** — "BDE agents need permission to read/write files and run commands in your repos. Review and approve the default permissions below." with [Accept Defaults] [Customize] buttons
- **Editable rules** — users can add/remove allow and deny rules
- **Presets** — "Recommended" (current BDE defaults), "Restrictive" (read-only + limited bash), "Permissive" (everything allowed)
- **Explanation per rule** — tooltip explaining what each permission does and why agents need it
- **Live validation** — show which rules would block common agent operations (npm install, git push, file edit)
- **Persist to `~/.claude/settings.json`** — BDE reads/writes the same file Claude Code CLI uses

## Architecture

### Settings UI
New `AgentPermissionsSection.tsx` component in `src/renderer/src/components/settings/`. Renders:
- Consent banner (dismissible, shown until user accepts)
- Allow rules list (checkboxes for each tool: Read, Write, Edit, Bash, etc.)
- Deny rules list (editable list of patterns like `Bash(rm -rf /*)`)
- Preset buttons (Recommended / Restrictive / Permissive)
- "What agents can do" explanation card

### IPC
- `settings:getClaudeConfig` — reads `~/.claude/settings.json`
- `settings:setClaudeConfig` — writes `~/.claude/settings.json`
- `settings:getPermissionConsent` — checks if user has accepted permissions

### Data flow
Settings UI → IPC → main process reads/writes `~/.claude/settings.json` → agents inherit via `settingSources`

## Current State (what's already built)
- `claude-settings-bootstrap.ts` — applies defaults if no permissions exist
- Pipeline agents use `canUseTool: allow` (auto-allow, isolated worktree)
- Adhoc/assistant agents use `settingSources` (inherit user config)
- `resources/default-claude-settings.json` — reference template

## Not Yet Built
- Settings UI for viewing/editing permissions
- First-time consent banner
- Presets
- Per-rule explanations
- Live validation
