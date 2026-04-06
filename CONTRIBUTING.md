# Contributing to BDE

Thanks for your interest in BDE. A few things to know before you spend time on this.

## Current Status

**BDE is not accepting outside contributions at this time.**

The repository is public so people can read, clone, fork, and learn from it. But the maintainer is the only one merging code to `main` right now. If you open a PR, it probably won't be merged — not because it's bad, but because BDE's direction is still being set deliberately.

This may change in the future. When it does, this document will be updated.

## What you CAN do

### Report bugs

Open an issue with:
- **What you did** — the exact steps to reproduce
- **What you expected** — the result you thought you'd get
- **What happened** — the actual result, including any error messages
- **Environment** — OS version, Node version, BDE commit SHA
- **Logs** — check `~/.bde/bde.log` and `~/.bde/agent-manager.log`, redact any personal info

### Suggest features

Open a [Discussion](https://github.com/RyanJBirkeland/BDE/discussions) (if enabled) or a `feature-request` issue. Be specific about the problem you're trying to solve — "I want X so I can Y" is much more useful than "BDE should have X."

### Fork for your own use

The MIT license lets you fork, modify, and use BDE however you want. Go for it.

### Report security issues

See [SECURITY.md](./SECURITY.md). Do **not** open a public issue for vulnerabilities.

## What happens if you open a PR anyway

It will probably sit. The maintainer may:
1. Close it with a short explanation
2. Leave a comment describing why the approach doesn't fit the current direction
3. Occasionally cherry-pick an idea if it's a clear win

If you open a PR, please:
- Keep it focused on one thing
- Include a clear description of what and why
- Don't be offended if it's closed — it's not personal

## Development Setup

If you want to build BDE locally (for your own use or to understand the code):

```bash
# Prerequisites
#   macOS (Apple Silicon recommended)
#   Node.js 22+
#   Claude Code CLI (`claude login` must succeed)
#   git and gh CLI

git clone https://github.com/RyanJBirkeland/BDE.git
cd BDE
npm install
npm run dev        # development with HMR
# OR
npm run build:mac  # produces an unsigned DMG in ./release/
```

See the [development guide](./docs/DEVELOPMENT.md) for more detail on the architecture, key files, and how to run tests.

## Code of Conduct

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). Be kind. Disagree with ideas, not people.
