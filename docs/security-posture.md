# BDE Security Posture

Last updated: 2026-04-21

## Network Surface

BDE's network surface is **loopback-only** — no externally reachable ports, no outbound HTTP calls beyond the Anthropic API and optional GitHub calls.

- **Status HTTP server**: unconditional, binds `127.0.0.1:18791`. Read-only `/status` endpoint used for introspection. Source: `src/main/services/status-server.ts`.
- **Local MCP server** (opt-in): binds `127.0.0.1:18792` when enabled via Settings → Connections → Local MCP Server. Bearer-token auth against `~/.bde/mcp-token` (mode `0600`). Source: `src/main/mcp-server/`.
- **Outbound**:
  - Anthropic API via the Claude Agent SDK (same as Claude Code CLI).
  - GitHub API (direct `fetch`/`gh` CLI) for PR polling and worktree ops, only when you configure repos with GitHub credentials.
- Legacy notes: Queue API (port 18790) removed in PR #613; Runner client (port 18799) removed in PR #614.

## Comparison: BDE vs Claude Code CLI

### Equivalent

| Concern                 | Claude Code CLI          | BDE                                                          |
| ----------------------- | ------------------------ | ------------------------------------------------------------ |
| Network surface         | None                     | Loopback-only (status 18791, optional MCP 18792)             |
| Agent capabilities      | Full file/shell access   | Same — uses the same SDK                                     |
| Token storage           | `~/.claude/` (plaintext) | `~/.bde/oauth-token` (0600 perms), Keychain fallback removed |
| Push-to-main prevention | Permission prompts       | Prompt conventions + branch naming + review gate             |

### Where BDE adds protection

| Concern          | Claude Code CLI              | BDE                                                                             |
| ---------------- | ---------------------------- | ------------------------------------------------------------------------------- |
| Agent isolation  | Runs in your repo directly   | Pipeline agents run in disposable git worktrees                                 |
| Code review      | You review diffs in terminal | Code Review Station UI — structured diff view, commit history, conversation log |
| Task audit trail | None                         | Field-level change tracking in SQLite (`task_changes` table)                    |

### Where BDE has more surface area

| Concern          | Claude Code CLI     | BDE                                                                       |
| ---------------- | ------------------- | ------------------------------------------------------------------------- |
| Electron process | N/A — Node CLI only | Chromium renderer + main process                                          |
| Dependencies     | ~50                 | ~200+ (Electron, Monaco, React, etc.)                                     |
| Local data store | None                | `~/.bde/bde.db` — task specs, agent history (readable by local processes) |
| IPC channels     | None                | ~138 typed channels between renderer and main                             |
| Loopback ports   | None                | `:18791` (status, always on) + `:18792` (MCP, opt-in)                     |
| Binary signing   | Installed via npm   | Unsigned DMG (Gatekeeper warning)                                         |

### Threat model summary

**"Don't leak data over the network"** — BDE and Claude Code CLI are effectively equivalent to external observers: BDE's loopback listeners (`:18791` status, `:18792` MCP when enabled) do not accept connections from anything off the machine.

**Local process compromise** — If an attacker has local access as your user, both tools are equally exposed. BDE stores more data locally (SQLite with task specs and agent history) and exposes it via the loopback MCP server when enabled — the bearer token at `~/.bde/mcp-token` is the only gate for another local process, so treat it like any other long-lived credential (`chmod 600`, don't commit).

**Supply chain** — BDE has a larger dependency tree due to Electron/React/Monaco. Dependencies are audited regularly via `npm audit`. As of 2026-04-03: 0 high/critical vulnerabilities, 2 moderate (Monaco's internal DOMPurify — not exploitable in BDE's context).

## Security measures in place

- **Parameterized SQL** — all database queries use prepared statements
- **Argument-array exec** — all shell commands use `execFileAsync(cmd, [args])`, never string interpolation
- **Electron contextIsolation** — renderer cannot access Node APIs directly
- **DOMPurify + iframe sandbox** — playground HTML sanitized before rendering
- **Path traversal prevention** — IDE file handlers and playground handler validate paths against allowed roots using symlink-aware `realpathSync` checks
- **Timing-safe auth comparison** — internal auth uses `timingSafeEqual`
- **Content Security Policy** — production builds restrict script sources to `'self'`
- **GitHub API allowlist** — only specific HTTP methods and fields permitted through the proxy

## Files

- Security audit spec: `docs/superpowers/specs/2026-04-03-security-audit-hardening-design.md`
- Security audit plan: `docs/superpowers/plans/2026-04-03-security-audit-hardening.md`
- Database: `~/.bde/bde.db` (WAL mode, 0600 permissions)
- OAuth token: `~/.bde/oauth-token` (plaintext, 0600 permissions)
- MCP bearer token: `~/.bde/mcp-token` (plaintext, 0600 permissions; only present when MCP server is enabled)
- Logs: `~/.bde/bde.log` (authoritative), `~/.bde/agent-manager.log` (legacy — may be stale from prior builds)
- Worktrees: `~/.bde/worktrees/<repo-slug>/<task-id>/` (pipeline), `~/.bde/worktrees-adhoc/` (adhoc agents)
