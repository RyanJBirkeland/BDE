# Security Policy

## Supported Versions

BDE is under active development on `main`. Only the latest commit on `main` receives security fixes. There are no LTS branches.

| Version | Supported |
| ------- | --------- |
| `main`  | ✅        |
| older commits | ❌  |

## Reporting a Vulnerability

**Please do not file public GitHub issues for security vulnerabilities.**

Use GitHub's [private vulnerability reporting](https://github.com/RyanJBirkeland/BDE/security/advisories/new) to report the issue. We'll acknowledge receipt within a few days and keep you updated on the fix timeline.

If private vulnerability reporting is not available, you can contact the maintainer directly via the email listed on their GitHub profile.

### What counts as a security issue

- Arbitrary code execution via agent prompt injection that escapes the read-only copilot scope
- Privilege escalation via IPC handler exploitation
- Filesystem access outside the configured repository paths
- Credential leakage (OAuth tokens, API keys) via logs, state files, or IPC surface
- Cross-site scripting in the Dev Playground sandboxed iframe that escapes the sandbox
- Any path that lets a pipeline agent push to `main` directly (the hard rule is "never")

### What does NOT count as a security issue

- Agent-produced code that's buggy (that's what the review station is for)
- The unsigned macOS DMG warning (documented; not a vulnerability)
- BDE running arbitrary commands via the agent manager — this is the product's core function
- The Dev Playground rendering HTML (sandboxed; DOMPurify-sanitized)
- Missing input validation on settings fields (file an issue instead)

## Scope

This policy covers the BDE codebase in this repository. It does NOT cover:

- The Claude Agent SDK or Claude Code CLI (report to Anthropic)
- The GitHub CLI (report to GitHub)
- Electron or Node.js runtime vulnerabilities (report upstream)
- User-configured repositories that BDE operates on

## Disclosure Policy

Once a fix is available, we'll publish a security advisory on GitHub describing:
- What the vulnerability was
- Who reported it (with permission)
- Which versions were affected
- How to verify you're running the fixed version
