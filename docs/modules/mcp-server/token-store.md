# token-store

**Layer:** MCP Server
**Source:** `src/main/mcp-server/token-store.ts`

## Purpose
Persistent bearer token storage for MCP server authentication. Generates a 32-byte random token (64 hex characters) on first read and stores it at `~/.bde/mcp-token` with mode `0600`; the parent `~/.bde/` directory is locked to `0700`. Subsequent reads return the existing token and flag whether the caller just minted a new one.

## Public API
- `readOrCreateToken(filePath?, options?): Promise<TokenReadResult>` — reads the token from disk, regenerating if it is missing, corrupt, or unparseable. Accepts an optional logger in `options` to warn on corrupt content or file-mode drift and to record non-ENOENT read errors before rethrowing.
- `regenerateToken(filePath?): Promise<TokenReadResult>` — unconditionally writes a new token. The returned `created` flag is always `true`.
- `tokenFilePath(): string` — default token path (`~/.bde/mcp-token`).
- `TokenReadResult` — `{ token: string; created: boolean; path: string }`. `created` is `true` when a fresh token was written this call (missing file or corrupt contents); `false` when a valid existing token was returned as-is.
- `TokenStoreOptions` — `{ logger?: TokenStoreLogger }`; `TokenStoreLogger` needs `warn` and `error`.

## Hardening
- Exclusive create (`fs.open(path, 'wx', 0o600)`) eliminates the umask race on first write; existing-file rewrites fall back to `writeFile` + explicit `chmod`.
- Parent directory is forced to mode `0700` on every read path via `mkdir({ mode })` plus an idempotent `chmod`, tightening installs that were created without the mode flag.
- The hex-validation regex is derived from `TOKEN_BYTES * 2`, so bumping `TOKEN_BYTES` updates the length check automatically.
- A valid token at the wrong file mode (for example `0o644`) is returned as-is but logged at `warn` — an operator signal without locking the user out.

## Key Dependencies
- `node:fs` (promises) — `open('wx')` for atomic create, `writeFile` + `chmod` for overwrite, `stat` for mode-drift detection.
- `node:crypto` — 32-byte random token generation.
- `node:path`, `node:os` — path resolution and home directory lookup.
