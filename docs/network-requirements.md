# FLEET Network Requirements

Required outbound HTTPS (port 443) access for FLEET to function on a corporate network.
All traffic uses TLS 1.2+. No inbound ports are required.

## Required domains

### Anthropic / Claude Code

| Domain | Purpose |
|--------|---------|
| `api.anthropic.com` | Claude API — all agent inference calls, OAuth token creation |
| `mcp-proxy.anthropic.com` | MCP tool proxy used by the Claude Code CLI |

These are hard blockers. FLEET will not be able to run agents if either is unreachable.

### GitHub

| Domain | Purpose |
|--------|---------|
| `api.github.com` | PR creation, check-run polling, GitHub API proxy |
| `github.com` | `git push`/`pull` over HTTPS, `gh` CLI authentication |
| `raw.githubusercontent.com` | Claude Code plugin manifests (fetched by Claude Code CLI) |

`api.github.com` is required for PR workflows. Git operations over SSH (port 22) to
`github.com` can substitute for HTTPS if your firewall blocks port 443 to `github.com`,
but `api.github.com` always uses HTTPS.

### Telemetry (optional — non-blocking)

| Domain | Purpose |
|--------|---------|
| `api.segment.io` | Anonymous usage telemetry sent by the Claude Code CLI |

Blocking this domain will not prevent FLEET from functioning. The CLI handles connection
failures to telemetry endpoints gracefully.

---

## Proxy configuration

FLEET respects standard proxy environment variables. Set these before launching the app
(e.g., in your shell profile or via a launch script):

```sh
export HTTPS_PROXY=http://proxy.corp.example.com:8080
export NO_PROXY=localhost,127.0.0.1
```

Both uppercase and lowercase variants are supported (`HTTPS_PROXY` / `https_proxy`,
`HTTP_PROXY` / `http_proxy`, `NO_PROXY` / `no_proxy`).

If your proxy uses a self-signed or corporate CA certificate, point Node.js at it:

```sh
export NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.crt
```

The Claude Code CLI also reads `GIT_SSL_CAINFO` for git operations.

## Corporate GitHub (GitHub Enterprise)

FLEET currently targets `api.github.com` directly. GitHub Enterprise Server is not yet
supported — the GitHub API base URL is hardcoded.

## Verifying connectivity

After setting proxy variables, you can test from the terminal before launching FLEET:

```sh
# Test Anthropic API reachability
curl -I https://api.anthropic.com

# Test GitHub API reachability
curl -I https://api.github.com

# Test gh CLI auth (should already be set up before first FLEET launch)
gh auth status
```
