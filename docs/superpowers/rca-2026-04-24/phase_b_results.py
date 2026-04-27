"""
Phase B results — pull metrics for the 10 experiment tasks and emit a paired
A/B comparison table. Run after the monitor exits.

Outputs to stdout (markdown table form) and to /tmp/phase_b_results.json.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

DB_PATH = Path.home() / ".bde" / "bde.db"
MANIFEST_PATH = Path("/tmp/phase_b_manifest.json")


def _to_str(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, bytes):
        return v.decode("utf-8", errors="replace")
    return str(v)


def load_runs(conn: sqlite3.Connection, task_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT id, status, started_at, finished_at, exit_code,
               num_turns, cost_usd, duration_ms, tokens_in, tokens_out
          FROM agent_runs
         WHERE sprint_task_id = ?
         ORDER BY started_at ASC
        """,
        (task_id,),
    ).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        events = conn.execute(
            "SELECT event_type, payload FROM agent_events WHERE agent_id = ? ORDER BY timestamp ASC",
            (r[0],),
        ).fetchall()
        error_msgs: list[str] = []
        env_failure = False
        max_turns_hit = False
        for et, payload_str in events:
            if et == "agent:error":
                try:
                    payload = json.loads(_to_str(payload_str) or "{}")
                except json.JSONDecodeError:
                    continue
                msg = payload.get("message", "")
                error_msgs.append(msg)
                lower = msg.lower()
                if "executable not found" in lower or "claude code executable" in lower:
                    env_failure = True
                if "max_turns_exceeded" in lower:
                    max_turns_hit = True
        out.append({
            "run_id": _to_str(r[0]),
            "status": _to_str(r[1]),
            "started_at": _to_str(r[2]),
            "finished_at": _to_str(r[3]),
            "exit_code": r[4],
            "num_turns": r[5],
            "cost_usd": r[6],
            "duration_ms": r[7],
            "tokens_in": r[8],
            "tokens_out": r[9],
            "env_failure": env_failure,
            "max_turns_hit": max_turns_hit,
            "errors": error_msgs[:3],  # cap for compactness
            "event_count": len(events),
        })
    return out


def load_task(conn: sqlite3.Connection, task_id: str) -> dict[str, Any]:
    row = conn.execute(
        """
        SELECT id, title, status, retry_count, fast_fail_count,
               failure_reason, started_at, completed_at, duration_ms
          FROM sprint_tasks
         WHERE id = ?
        """,
        (task_id,),
    ).fetchone()
    if row is None:
        return {"id": task_id, "missing": True}
    return {
        "id": _to_str(row[0]),
        "title": _to_str(row[1]),
        "status": _to_str(row[2]),
        "retry_count": row[3],
        "fast_fail_count": row[4],
        "failure_reason": _to_str(row[5]),
        "started_at": _to_str(row[6]),
        "completed_at": _to_str(row[7]),
        "duration_ms": row[8],
    }


def best_run(runs: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Pick the most informative run for headline metric (last successful, else last)."""
    successful = [r for r in runs if r["status"] == "done" and not r["env_failure"]]
    if successful:
        return successful[-1]
    real_runs = [r for r in runs if not r["env_failure"]]
    if real_runs:
        return real_runs[-1]
    return runs[-1] if runs else None


def main() -> None:
    manifest = json.loads(MANIFEST_PATH.read_text())
    pairs = manifest["pairs"]

    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.text_factory = lambda b: b.decode("utf-8", errors="replace") if isinstance(b, bytes) else b

    enriched_pairs: list[dict[str, Any]] = []
    for pair in pairs:
        a_task = load_task(conn, pair["arm_a_id"])
        b_task = load_task(conn, pair["arm_b_id"])
        a_runs = load_runs(conn, pair["arm_a_id"])
        b_runs = load_runs(conn, pair["arm_b_id"])
        enriched_pairs.append({
            "title": pair["arm_a_title"],
            "arm_a": {"task": a_task, "runs": a_runs, "best": best_run(a_runs)},
            "arm_b": {"task": b_task, "runs": b_runs, "best": best_run(b_runs)},
        })

    print("# Phase B Results — Header Injection A/B\n")
    print(f"## Per-pair comparison (n={len(enriched_pairs)})\n")
    print("| # | Task | Arm A status | A turns | A cost | A retries | Arm B status | B turns | B cost | B retries |")
    print("|---|------|--------------|---------|--------|-----------|--------------|---------|--------|-----------|")
    for i, p in enumerate(enriched_pairs, 1):
        a = p["arm_a"]
        b = p["arm_b"]
        a_run = a["best"]
        b_run = b["best"]
        a_turns = a_run["num_turns"] if a_run else "-"
        b_turns = b_run["num_turns"] if b_run else "-"
        a_cost = f"${a_run['cost_usd']:.2f}" if a_run and a_run["cost_usd"] else "-"
        b_cost = f"${b_run['cost_usd']:.2f}" if b_run and b_run["cost_usd"] else "-"
        title_short = p["title"][:60]
        print(f"| {i} | {title_short} | {a['task']['status']} | {a_turns} | {a_cost} | {a['task']['retry_count']} "
              f"| {b['task']['status']} | {b_turns} | {b_cost} | {b['task']['retry_count']} |")

    # Aggregate
    a_pass = sum(1 for p in enriched_pairs if p["arm_a"]["task"]["status"] in ("review", "done"))
    b_pass = sum(1 for p in enriched_pairs if p["arm_b"]["task"]["status"] in ("review", "done"))
    a_max_turns = [p["arm_a"]["best"]["num_turns"] for p in enriched_pairs
                   if p["arm_a"]["best"] and p["arm_a"]["best"]["num_turns"]]
    b_max_turns = [p["arm_b"]["best"]["num_turns"] for p in enriched_pairs
                   if p["arm_b"]["best"] and p["arm_b"]["best"]["num_turns"]]
    a_cost_sum = sum(p["arm_a"]["best"]["cost_usd"] for p in enriched_pairs
                     if p["arm_a"]["best"] and p["arm_a"]["best"]["cost_usd"])
    b_cost_sum = sum(p["arm_b"]["best"]["cost_usd"] for p in enriched_pairs
                     if p["arm_b"]["best"] and p["arm_b"]["best"]["cost_usd"])
    a_env_runs = sum(1 for p in enriched_pairs for r in p["arm_a"]["runs"] if r["env_failure"])
    b_env_runs = sum(1 for p in enriched_pairs for r in p["arm_b"]["runs"] if r["env_failure"])
    a_max_hits = sum(1 for p in enriched_pairs for r in p["arm_a"]["runs"] if r["max_turns_hit"])
    b_max_hits = sum(1 for p in enriched_pairs for r in p["arm_b"]["runs"] if r["max_turns_hit"])

    print("\n## Aggregate\n")
    print(f"- Pass rate (status in review/done): A={a_pass}/{len(enriched_pairs)}, B={b_pass}/{len(enriched_pairs)}")
    print(f"- Mean turns (best run): A={sum(a_max_turns)/len(a_max_turns):.1f} (n={len(a_max_turns)}), "
          f"B={sum(b_max_turns)/len(b_max_turns):.1f} (n={len(b_max_turns)})" if a_max_turns and b_max_turns else "")
    print(f"- Total cost: A=${a_cost_sum:.2f}, B=${b_cost_sum:.2f}")
    print(f"- Env failures (Stream interrupted): A={a_env_runs} runs, B={b_env_runs} runs")
    print(f"- max_turns_exceeded events: A={a_max_hits}, B={b_max_hits}")

    Path("/tmp/phase_b_results.json").write_text(json.dumps(enriched_pairs, indent=2, default=str))
    print(f"\nDetailed JSON: /tmp/phase_b_results.json")

    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_text(json.dumps(enriched_pairs, indent=2, default=str))


if __name__ == "__main__":
    main()
