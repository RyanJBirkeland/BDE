#!/usr/bin/env bash
# bde-watcher.sh — polls origin/main every 60s and restarts the dev service on new commits
#
# DEV ONLY — NOT bundled in the BDE app DMG.
# Before use, replace /Users/RBTECHBOT/Documents/Repositories/BDE with your actual repo path.
# See scripts/dev/README.md for full setup instructions.

set -euo pipefail

REPO_DIR="/Users/RBTECHBOT/Documents/Repositories/BDE"
SERVICE_LABEL="com.rbtechbot.bde-dev"
LOG="/tmp/bde-watcher.log"
INTERVAL=60

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"
}

cd "$REPO_DIR"
log "watcher started (pid $$)"

while true; do
  git fetch origin main --quiet 2>>"$LOG" || { log "fetch failed"; sleep "$INTERVAL"; continue; }

  LOCAL=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse origin/main)

  if [ "$LOCAL" != "$REMOTE" ]; then
    log "origin/main ($REMOTE) is ahead of HEAD ($LOCAL) — pulling and restarting"
    git pull origin main --ff-only 2>>"$LOG" || { log "pull failed"; sleep "$INTERVAL"; continue; }
    log "pull complete — restarting $SERVICE_LABEL"
    launchctl stop "$SERVICE_LABEL" 2>>"$LOG" || true
    launchctl start "$SERVICE_LABEL" 2>>"$LOG" || true
    log "restart issued"
  fi

  sleep "$INTERVAL"
done
