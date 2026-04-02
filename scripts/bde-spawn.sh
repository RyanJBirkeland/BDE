#!/bin/bash
# bde-spawn.sh — run a claude agent and register it in BDE's AgentHistoryPanel
# Usage: bde-spawn.sh --model <model> --repo <name> --repo-path <path> --task <task prompt>
#
# Registers the agent in ~/.bde/agents.json and tees output to
# ~/.bde/agent-logs/<date>/<id>/output.log so BDE can stream it live.

set -euo pipefail

MODEL="claude-sonnet-4-5"
REPO="unknown"
REPO_PATH="$(pwd)"
TASK=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)     MODEL="$2";     shift 2 ;;
    --repo)      REPO="$2";      shift 2 ;;
    --repo-path) REPO_PATH="$2"; shift 2 ;;
    --task)      TASK="$2";      shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

BDE_DIR="$HOME/.bde"
AGENTS_INDEX="$BDE_DIR/agents.json"
DATE="$(date -u +%Y-%m-%d)"
ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
LOG_DIR="$BDE_DIR/agent-logs/$DATE/$ID"
LOG_FILE="$LOG_DIR/output.log"
META_FILE="$LOG_DIR/meta.json"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

mkdir -p "$LOG_DIR"
touch "$LOG_FILE"

# Write meta.json
python3 - "$META_FILE" "$AGENTS_INDEX" "$ID" "$MODEL" "$REPO" "$REPO_PATH" "$TASK" "$STARTED_AT" "$LOG_FILE" << 'PYEOF'
import json, sys, os
meta_path, index_path, agent_id, model, repo, repo_path, task, started_at, log_path = sys.argv[1:]

meta = {
  "id": agent_id,
  "pid": None,
  "bin": "claude",
  "model": model,
  "repo": repo,
  "repoPath": repo_path,
  "task": task,
  "startedAt": started_at,
  "finishedAt": None,
  "exitCode": None,
  "status": "running",
  "logPath": log_path,
  "source": "openclaw"
}

with open(meta_path, "w") as f:
    json.dump(meta, f, indent=2)

# Prepend to agents index
os.makedirs(os.path.dirname(index_path), exist_ok=True)
try:
    with open(index_path) as f:
        index = json.load(f)
except Exception:
    index = []

index.insert(0, meta)
with open(index_path, "w") as f:
    json.dump(index, f, indent=2)

print(f"[bde-spawn] Registered agent {agent_id}")
PYEOF

# Augment PATH for claude binary
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"

echo "[bde-spawn] Starting: $ID" >> "$LOG_FILE"

# Run claude, tee output to log file so BDE can read it
# stdout+stderr both go to log
set +e
claude \
  --print \
  --output-format stream-json \
  --include-partial-messages \
  --verbose \
  --model "$MODEL" \
  --permission-mode bypassPermissions \
  "$TASK" >> "$LOG_FILE" 2>&1
EXIT_CODE=$?
set -e

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
STATUS="done"
[[ $EXIT_CODE -ne 0 ]] && STATUS="failed"

# Update status in index and meta
python3 - "$META_FILE" "$AGENTS_INDEX" "$ID" "$EXIT_CODE" "$FINISHED_AT" "$STATUS" << 'PYEOF'
import json, sys
meta_path, index_path, agent_id = sys.argv[1], sys.argv[2], sys.argv[3]
exit_code, finished_at, status = int(sys.argv[4]), sys.argv[5], sys.argv[6]

try:
    with open(meta_path) as f:
        meta = json.load(f)
    meta.update({"exitCode": exit_code, "finishedAt": finished_at, "status": status})
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
except Exception as e:
    print(f"warn: meta update failed: {e}", file=sys.stderr)

try:
    with open(index_path) as f:
        index = json.load(f)
    for a in index:
        if a["id"] == agent_id:
            a.update({"exitCode": exit_code, "finishedAt": finished_at, "status": status})
    with open(index_path, "w") as f:
        json.dump(index, f, indent=2)
except Exception as e:
    print(f"warn: index update failed: {e}", file=sys.stderr)
PYEOF

echo "[bde-spawn] Done: $ID (exit=$EXIT_CODE status=$STATUS)"
