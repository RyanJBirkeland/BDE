# BDE Security Posture

Last updated: 2026-04-03

## Network Surface

BDE has **zero network surface**. No HTTP servers, no open ports, no outbound HTTP calls to external services.

- Queue API (port 18790) removed in PR #613
- Runner client (port 18799) removed in PR #614
- The only network traffic is to the Anthropic API via the Claude Agent SDK (same as Claude Code CLI)

## Comparison: BDE vs Claude Code CLI

### Equivalent

| Concern | Claude Code CLI | BDE |
|---------|----------------|-----|
| Network surface | None | None |
| Agent capabilities | Full file/shell access | Same — uses the same SDK |
| Token storage | `~/.claude/` (plaintext) | `~/.bde/oauth-token` (0600 perms) |
| Push-to-main prevention | Permission prompts | Prompt conventions + branch naming |

### Where BDE adds protection

| Concern | Claude Code CLI | BDE |
|---------|----------------|-----|
| Agent isolation | Runs in your repo directly | Pipeline agents run in disposable git worktrees |
| Code review | You review diffs in terminal | Code Review Station UI — structured diff view, commit history, conversation log |
| Task audit trail | None | Field-level change tracking in SQLite (`task_changes` table) |

### Where BDE has more surface area

| Concern | Claude Code CLI | BDE |
|---------|----------------|-----|
| Electron process | N/A — Node CLI only | Chromium renderer + main process |
| Dependencies | ~50 | ~200+ (Electron, Monaco, React, etc.) |
| Local data store | None | `~/.bde/bde.db` — task specs, agent history (readable by local processes) |
| IPC channels | None | 86 typed channels between renderer and main |
| Binary signing | Installed via npm | Unsigned DMG (Gatekeeper warning) |

### Threat model summary

**"Don't leak data over the network"** — BDE and Claude Code CLI are equivalent. Neither opens ports or sends data anywhere except the Anthropic API.

**Local process compromise** — If an attacker has local access as your user, both tools are equally exposed. BDE stores more data locally (SQLite with task specs and agent history) but none of it is network-accessible.

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
- Logs: `~/.bde/bde.log`, `~/.bde/agent-manager.log` (10MB rotation)
