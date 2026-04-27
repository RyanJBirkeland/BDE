"""
Re-queue the 5 Phase-B Arm-A originals after the new turn-budget code is live.

Prerequisites (must be done before running this script):
  1. Merge `agent/rca-pipeline-painpoints-last` to `main`
  2. Rebuild BDE so the agent-manager picks up `DEFAULT_MAX_TURNS=75`
  3. Restart BDE

This script calls the local MCP server's `tasks.update` tool for each of the
five tasks. MCP's `tasks.update` routes through the same revive-terminal-task
path the IPC `sprint:retry` uses, so `retry_count`, `fast_fail_count`,
`completed_at`, `failure_reason`, `claimed_by`, `started_at`, and
`next_eligible_at` are cleared cleanly. Raw SQL `UPDATE ... SET status='queued'`
would leave those stale (per CLAUDE.md).

Read-only against ~/.bde/mcp-token; calls MCP at the configured port.
Idempotent — running it twice is harmless if the tasks are already queued.
"""

from __future__ import annotations

import json
import sys
import urllib.request
import urllib.error
from pathlib import Path

MCP_TOKEN_PATH = Path.home() / ".bde" / "mcp-token"
MCP_URL = "http://127.0.0.1:18792/mcp"

ORIGINALS = [
    ("035eebc8e1da8f75457439c269070c78", "T-22 escapeXmlContent"),
    ("9164b71c50280aa100c858395d4fe4ab", "T-23 propagate disallowedTools"),
    ("3616a07c390eb195884aa4495501f4f1", "T-44 orphan recovery"),
    ("696a21b8d370bb976317aec7b43500e0", "T-47 reset fast_fail_count"),
    ("347fc3a19e6d843962640c5e13fba3ee", "T-50 redirect fast-fail log"),
]


def mcp_call(token: str, request_id: int, method: str, params: dict) -> dict:
    payload = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        MCP_URL,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8")
    return parse_response(body)


def parse_response(body: str) -> dict:
    """MCP HTTP transport may return SSE (`event: message\\ndata: {...}`) or
    plain JSON. Pull the first JSON object out of either shape."""
    body = body.strip()
    if body.startswith("{"):
        return json.loads(body)
    for line in body.splitlines():
        if line.startswith("data:"):
            return json.loads(line[len("data:") :].strip())
    raise RuntimeError(f"unexpected MCP response shape: {body[:200]!r}")


def reset_task(token: str, task_id: str, label: str, request_id: int) -> None:
    response = mcp_call(
        token,
        request_id,
        "tools/call",
        {
            "name": "tasks.update",
            "arguments": {"id": task_id, "patch": {"status": "queued"}},
        },
    )
    if "error" in response:
        print(f"  FAIL {label} ({task_id[:8]}): {response['error']}")
        return
    result = response.get("result", {})
    is_error = result.get("isError", False)
    text_blocks = [c.get("text", "") for c in result.get("content", []) if c.get("type") == "text"]
    summary = " | ".join(text_blocks)[:120] or "(empty)"
    status = "ERROR" if is_error else "OK"
    print(f"  {status:5s} {label} ({task_id[:8]}): {summary}")


def main() -> None:
    if not MCP_TOKEN_PATH.exists():
        print(f"MCP token not found at {MCP_TOKEN_PATH}", file=sys.stderr)
        print("Enable MCP in Settings → Connections → Local MCP Server first.", file=sys.stderr)
        sys.exit(1)

    token = MCP_TOKEN_PATH.read_text().strip()

    print(f"Re-queueing {len(ORIGINALS)} Phase-B Arm-A originals via MCP...")
    for i, (task_id, label) in enumerate(ORIGINALS, start=1):
        try:
            reset_task(token, task_id, label, request_id=i)
        except urllib.error.URLError as exc:
            print(f"  FAIL {label} ({task_id[:8]}): cannot reach MCP — is BDE running? {exc}")
            sys.exit(2)
    print("Done. Watch the Sprint Pipeline view; the drain loop will pick them up within 30s.")


if __name__ == "__main__":
    main()
