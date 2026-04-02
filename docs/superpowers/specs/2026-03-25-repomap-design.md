# repomap — Interactive Repository Architecture Visualizer

**Date:** 2026-03-25
**Status:** Design approved
**Repo:** Standalone (new repo: `repomap`)

## Overview

`repomap` is a standalone CLI + browser tool that visualizes repository architecture as an interactive, expandable graph. It combines AST-based static analysis with LLM enrichment to produce a living architecture diagram that developers can explore by clicking into modules, seeing dependencies, and understanding domain boundaries.

### Motivation

As AI accelerates code production, engineers increasingly operate at the architecture level rather than the code level. Understanding *what you've built* becomes the bottleneck. repomap solves this by giving developers an always-current, interactive map of their codebase — the architectural equivalent of Google Maps for code.

### Core Beliefs

- Engineers need to understand architecture without reading every line of code
- Static analysis provides the reliable structural skeleton; LLM adds meaning
- Initial analysis can be slow, but incremental updates must be fast
- The tool must work standalone — BDE is one consumer, not the only one

## Distribution

```bash
npx repomap .                    # Analyze current dir, open browser
npx repomap ./my-project         # Analyze specific path
npx repomap . --no-enrich        # Skip LLM enrichment, structural only
npx repomap . --port 3333        # Custom port
npx repomap . --json             # Output merged graph to stdout, no server
npx repomap . --force            # Full re-parse, ignore cache
```

CLI parses the repo, starts a local Express server, opens the browser. No install required beyond `npx`.

Default behavior is always incremental — if `.repomap/graph.json` exists and is still valid, only changed files are re-parsed. Use `--force` to bypass the cache entirely. Use `--json` for programmatic consumption (CI pipelines, BDE embedding, custom dashboards).

## Architecture

Three-layer system with clear boundaries:

```
┌─────────────────────────────────────────────────┐
│                   Browser (React)                │
│         Expandable graph visualization           │
│    D3-force layout + HTML nodes + SVG edges      │
├─────────────────────────────────────────────────┤
│              Local Server (Express)              │
│     /api/graph endpoint + WebSocket deltas        │
├──────────────────┬──────────────────────────────┤
│  Parser Layer    │    Enrichment Layer           │
│  TS Compiler API │    Agent SDK (claude-agent)   │
│  → structural    │    → summaries, domains,      │
│    graph         │      edge descriptions        │
└──────────────────┴──────────────────────────────┘
         │                       │
         ▼                       ▼
   .repomap/graph.json    .repomap/enrichment.json
```

### Layer 1: Parser

- Uses TypeScript compiler API (`ts.createProgram`) to parse `.ts`/`.tsx` files
- Extracts: directory tree, file exports, import edges (import / type-import / re-export)
- Non-TS files (JSON, CSS) registered as nodes without deep parsing
- Respects `.gitignore` + `.repomapignore` for exclusions
- Output: `RepoGraph` with structural fields populated, enrichment fields `undefined`
- Caching: writes to `.repomap/graph.json`, compares file mtimes on re-run, only re-parses changed files + direct dependents
- **Large repo safeguard:** If file count exceeds 5,000, emit a warning and proceed with directory-level nodes only (no file-level expansion until the user drills in). Keeps initial parse and render performant. Files within a directory are lazy-parsed on first expand.

### Layer 2: Enrichment

- Takes raw `RepoGraph`, batches nodes by directory proximity
- Prompts LLM with exported symbols + import/export edges + neighboring file names (not full source)
- Fills in: `summary`, `domain`, `tags` on nodes; `description` on edges
- Uses `@anthropic-ai/claude-agent-sdk` with `query()` — direct async iteration, no CLI subprocess
- Auth chain (same pattern as claude-task-runner):
  1. `ANTHROPIC_AUTH_TOKEN` env var — direct token
  2. `CLAUDE_TOKEN_FILE` env var — path to JSON credentials file
  3. `~/.claude/.credentials.json` — Claude Code's default credential store (cross-platform)
  4. macOS Keychain (`security find-generic-password`) — macOS only, skipped on Linux/Windows
  - Token refresh with atomic file writes (tmp → rename). MVP targets macOS + Linux; Windows support is best-effort (steps 1-3 work, step 4 skipped).
- Factory pattern: `createEnrichmentAdapter(config)` — fully dependency-injected, mockable
- Caching: `.repomap/enrichment.json` keyed by node ID + structural hash. Only re-enriches nodes whose structure changed.
- Fallback: no auth found → skip enrichment gracefully, structural graph still works. Print: "Install Claude Code for architecture annotations."
- **Error handling:** 1 retry per enrichment batch on failure. Partial batch failure keeps successful enrichments, marks failed nodes as unenriched. CLI shows progress bar with success/failure counts. Rate limiting handled with exponential backoff (same pattern as claude-task-runner watchdog). Malformed LLM output → discard that batch, log warning, continue.

### Layer 3: Visualization

- React app served as static files by the local Express server
- Graph data fetched via `/api/graph` endpoint
- D3-force for layout (force-directed, collision detection, expand/collapse reshuffling)
- SVG for edges (lines, arrows, labels), HTML/CSS for nodes (rich content, summaries, badges)
- Dark theme by default, domain-based color coding
- Live updates via WebSocket — file changes push deltas without browser refresh

## Graph Model

```typescript
interface RepoGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  metadata: RepoMetadata
}

interface GraphNode {
  id: string                    // unique path-based ID: "src/main/agent-manager"
  label: string                 // display name: "agent-manager"
  type: 'directory' | 'file' | 'export'
  children: string[]            // IDs of child nodes (for expand/collapse)
  parent: string | null         // ID of parent node
  // AST-derived
  exports: string[]             // exported symbols
  lineCount: number
  // LLM-enriched (nullable until enrichment runs)
  summary?: string              // "Orchestrates agent lifecycle and task execution"
  domain?: string               // "Agent Pipeline"
  tags?: string[]               // ["orchestration", "side-effects", "core"]
}

interface GraphEdge {
  source: string                // node ID
  target: string                // node ID
  type: 'import' | 'type-import' | 're-export'
  // LLM-enriched
  description?: string          // "agent events flow through IPC to renderer"
  weight?: number               // coupling strength (import count)
}

interface RepoMetadata {
  schemaVersion: number         // increment on breaking graph model changes
  name: string
  rootPath: string
  analyzedAt: string            // ISO timestamp
  languages: string[]
  nodeCount: number
  edgeCount: number
}

// Pushed via WebSocket when files change
interface GraphDelta {
  nodesAdded: GraphNode[]
  nodesRemoved: string[]        // node IDs
  nodesUpdated: GraphNode[]     // full replacement for changed nodes
  edgesAdded: GraphEdge[]
  edgesRemoved: Array<{ source: string; target: string }>
  edgesUpdated: GraphEdge[]
}
```

Key decisions:
- `export` as a node type — expanding a file shows its exported functions/classes/types as leaf nodes (deepest zoom level). Edges always target file-level nodes; export nodes are visual children only (no edge retargeting on expand).
- `domain` on nodes — LLM-assigned grouping enabling domain-colored overlay
- `weight` on edges — derived from import count, rendered as edge thickness to highlight coupling hotspots
- `schemaVersion` on metadata — version mismatch triggers full re-parse, preventing stale cache errors after tool upgrades
- Edge types are limited to statically detectable relationships (`import`, `type-import`, `re-export`). Event/message-passing relationships may be added in a future version via pattern matching or LLM inference.

## Interaction Model: Expandable Graph

- **Expand/collapse:** Click a node → children animate in, parent becomes a container. Click again → children collapse. Multiple nodes can be expanded simultaneously. D3 force simulation handles repositioning.
- **Pan + drag:** Click-drag canvas to pan, drag individual nodes to rearrange
- **Search:** `Cmd+K` fuzzy search across labels, summaries, domains. Highlights and centers matched node.
- **Domain filter:** Sidebar toggle to show/hide by LLM-assigned domain
- **Edge toggles:** Show/hide by edge type (imports, type-imports, re-exports)
- **Annotation toggle:** Switch between raw structural view and LLM-enriched view
- **Node detail panel:** Click node → slide-out panel with summary, exports list, file size, incoming/outgoing edges, domain tags

## CLI Lifecycle

What happens on `npx repomap .`:

1. Check for `.repomap/graph.json` — if exists and `schemaVersion` matches current, compare `graph.json` mtime against newest repo file mtime (respecting ignore patterns). If cache is newer, skip to step 4. If `--force`, always re-parse.
2. Parser walks the repo, builds structural graph, writes `.repomap/graph.json`
3. Enrichment annotates the graph (if auth available), writes `.repomap/enrichment.json`
4. Merge structural + enrichment into single annotated graph
5. Start Express server, serve React app + `/api/graph` endpoint
6. Open browser to `http://localhost:<port>`
7. File watcher starts — on changes, re-parse affected files, push updates via WebSocket
8. `SIGINT`/`SIGTERM` → close file watcher, shut down WebSocket connections, release port, exit cleanly. Port-in-use at startup → error with clear message ("Port 3000 in use, try --port 3001").

## Incremental Updates

- File watcher monitors repo files
- On change: re-parse that file → diff against cached graph → if structural edges changed, queue re-enrichment for that node → push delta via WebSocket
- Browser applies delta — adds/removes/updates nodes and edges, D3 force simulation re-settles
- No browser refresh needed

## Cache Directory

```
.repomap/
├── graph.json          # Structural graph (AST-derived)
└── enrichment.json     # LLM annotations (keyed by node ID + structural hash)
```

Users add `.repomap/` to `.gitignore`.

Ignore patterns go in `.repomapignore` at repo root (same convention as `.gitignore`). CLI flags override file-based config for MVP — no `config.json` until there's demand for persistent non-ignore configuration.

## Language Support

- **Day one:** TypeScript/JavaScript only (via TS compiler API)
- **Graph model is language-agnostic** — nodes, edges, metadata have no TS-specific concepts
- **Future:** Tree-sitter parsers slot in for Python, Go, Rust, etc. without changing visualization or enrichment layers

## Testing Strategy (TDD)

### Unit Tests (vitest)

- **Parser:** Fixture TypeScript files → assert correct graph nodes/edges. Covers: imports, re-exports, type-only imports, circular references, barrel files, path aliases.
- **Enrichment:** Mock Agent SDK adapter → assert correct prompts sent, correct fields populated, caching/hash logic.
- **Graph model:** Merge structural + enrichment → assert combined output. Delta diffing → assert correct change sets.
- **CLI:** Arg parsing, config loading, ignore pattern matching.

### Integration Tests (vitest)

- Parser + real TS compiler API against fixture repo → assert end-to-end graph correctness
- Server + WebSocket: start server, connect client, trigger file change, assert delta received
- Enrichment cache: parse → enrich → change file → re-parse → assert only changed node re-enriched

### E2E Tests (Playwright)

- Boot repomap against fixture repo → assert graph rendered with correct node count
- Expand node → assert children visible
- Search → assert highlight
- Toggle edge type → assert edges hidden/shown

### Fixture Repo

Small, purpose-built TypeScript project at `test/fixtures/sample-repo/`:
- 3 directories, 8 files
- Deliberate circular dependency
- Re-exports, type-only imports
- Stable assertions across all parser tests

### Coverage

- Start at 80% across statements, branches, functions, lines
- Ratchet up as codebase matures

## BDE Integration Path (Future)

repomap is standalone. BDE integration options for later:
- Embed via webview/iframe in a BDE panel
- BDE spawns `repomap` CLI process, points a panel at the local URL
- Share repo configs from BDE settings so repomap doesn't need separate setup

This is explicitly out of scope for the initial build.

## Dependencies (Minimal)

- `typescript` — compiler API for parsing
- `@anthropic-ai/claude-agent-sdk` — LLM enrichment via Claude subscription
- `express` — local server
- `ws` — WebSocket for live updates
- `react` + `react-dom` — visualization UI
- `d3-force` — graph layout engine
- `vite` — dev server + build
- `vitest` — test runner
- `playwright` — E2E tests
- `chokidar` (or `fs.watch`) — file watching

No unnecessary packages. Each dependency earns its place.
