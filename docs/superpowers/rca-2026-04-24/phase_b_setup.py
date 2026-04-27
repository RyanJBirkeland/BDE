"""
Phase B setup — clones 5 backlog tasks with `## Multi-File: true` injected into
the spec, then queues all 10 (5 originals + 5 clones) for the agent manager.

Two-arm A/B:
  Arm A = original task as-is (current spec, current heuristic-derived turn budget)
  Arm B = `[B-arm]` clone with header prepended (forced 75-turn budget)

Read-only impact on canonical task rows: only their `status` flips backlog→queued.
B-arm rows are insertions; cleaned up after measurement.

Outputs:
  - inserts 5 new sprint_tasks rows
  - flips 5 existing rows to status='queued'
  - prints a JSON-serializable manifest to /tmp/phase_b_manifest.json
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

DB_PATH = Path.home() / ".bde" / "bde.db"

CANDIDATES = [
    "035eebc8e1da8f75457439c269070c78",  # T-22 escapeXmlContent
    "347fc3a19e6d843962640c5e13fba3ee",  # T-50 redirect fast-fail log
    "3616a07c390eb195884aa4495501f4f1",  # T-44 orphan recovery
    "696a21b8d370bb976317aec7b43500e0",  # T-47 reset fast_fail_count
    "9164b71c50280aa100c858395d4fe4ab",  # T-23 propagate disallowedTools
]

HEADER = "## Multi-File: true\n\n"
B_ARM_TITLE_PREFIX = "[B-arm] "


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.text_factory = lambda b: b.decode("utf-8", errors="replace") if isinstance(b, bytes) else b

    manifest: list[dict[str, str]] = []
    inserted_clone_ids: list[str] = []

    cur = conn.cursor()
    try:
        for original_id in CANDIDATES:
            row = cur.execute(
                """
                SELECT id, title, prompt, repo, priority, spec, spec_type,
                       playground_enabled, needs_review, max_runtime_ms,
                       template_name, tags
                  FROM sprint_tasks
                 WHERE id = ?
                """,
                (original_id,),
            ).fetchone()

            if row is None:
                raise RuntimeError(f"Candidate task not found: {original_id}")

            (orig_id, title, prompt, repo, priority, spec, spec_type,
             playground_enabled, needs_review, max_runtime_ms,
             template_name, tags) = row

            spec_text = spec or ""
            if HEADER.strip() in spec_text:
                arm_b_spec = spec_text  # already has it; insert as-is
            else:
                arm_b_spec = HEADER + spec_text

            arm_b_title = B_ARM_TITLE_PREFIX + title

            cur.execute(
                """
                INSERT INTO sprint_tasks (
                    title, prompt, repo, status, priority, spec, spec_type,
                    playground_enabled, needs_review, max_runtime_ms,
                    template_name, tags
                ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    arm_b_title,
                    prompt or "",
                    repo,
                    priority,
                    arm_b_spec,
                    spec_type,
                    playground_enabled,
                    needs_review,
                    max_runtime_ms,
                    template_name,
                    tags,
                ),
            )
            clone_id = cur.execute(
                "SELECT id FROM sprint_tasks WHERE title = ? ORDER BY created_at DESC LIMIT 1",
                (arm_b_title,),
            ).fetchone()[0]
            inserted_clone_ids.append(clone_id)

            # Promote the original to queued
            cur.execute(
                "UPDATE sprint_tasks SET status = 'queued' WHERE id = ?",
                (orig_id,),
            )

            manifest.append({
                "arm_a_id": orig_id,
                "arm_a_title": title,
                "arm_b_id": clone_id,
                "arm_b_title": arm_b_title,
                "spec_chars_a": len(spec_text),
                "spec_chars_b": len(arm_b_spec),
            })

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    out_path = Path("/tmp/phase_b_manifest.json")
    out_path.write_text(json.dumps({
        "inserted_clone_ids": inserted_clone_ids,
        "pairs": manifest,
    }, indent=2))
    print(f"Wrote manifest to {out_path}")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
