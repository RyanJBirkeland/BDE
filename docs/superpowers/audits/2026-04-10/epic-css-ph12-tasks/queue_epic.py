#!/usr/bin/env python3
"""Queue all CSS Audit Remediation Ph12 tasks into BDE's SQLite sprint_tasks table."""

import sqlite3
import os
from pathlib import Path

DB_PATH = os.path.expanduser("~/.bde/bde.db")
TASK_DIR = Path(__file__).parent

TASKS = [
    ("01-spacing-tokens-ide-diff.md", "CSS Refactor Ph12a: Spacing tokens — IDE + diff components"),
    ("02-spacing-tokens-sprint-review-planner-workbench.md", "CSS Refactor Ph12b: Spacing tokens — sprint + review + planner + workbench"),
    ("03-spacing-tokens-agents-dashboard-settings-layout.md", "CSS Refactor Ph12c: Spacing tokens — agents + dashboard + settings + layout"),
    ("04-spacing-tokens-design-system-views-assets.md", "CSS Refactor Ph12d: Spacing tokens — design-system + views + assets"),
    ("05-dead-css-important-cleanup.md", "CSS Refactor Ph12e: Dead CSS + !important cleanup"),
]


def main():
    if not os.path.exists(DB_PATH):
        print(f"ERROR: Database not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    queued = 0

    for filename, title in TASKS:
        spec_path = TASK_DIR / filename
        if not spec_path.exists():
            print(f"SKIP: {filename} not found")
            continue

        spec = spec_path.read_text()

        # Check for duplicate by title
        cur.execute("SELECT id FROM sprint_tasks WHERE title = ?", (title,))
        if cur.fetchone():
            print(f"SKIP: '{title}' already exists")
            continue

        sql = """
            INSERT INTO sprint_tasks (title, status, repo, spec, spec_type, priority, needs_review, playground_enabled)
            VALUES (?, 'queued', 'bde', ?, 'refactor', 1, 1, 0)
        """
        cur.execute(sql, (title, spec))
        queued += 1
        print(f"QUEUED: {title}")

    conn.commit()
    conn.close()
    print(f"\nDone. {queued} tasks queued, {len(TASKS) - queued} skipped.")


if __name__ == "__main__":
    main()
