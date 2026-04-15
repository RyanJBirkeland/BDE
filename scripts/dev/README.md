# Developer Launch Agent Scripts

These scripts set up macOS launchd agents for local development only.
**They are NOT bundled with the BDE app and require manual setup.**

## Files

### `com.rbtechbot.bde.plist`

Launches the BDE Electron app at login and keeps it alive via launchd.

### `com.rbtechbot.bde-watcher.plist` + `bde-watcher.sh`

Runs a background file watcher that triggers rebuilds or other dev tasks when
source files change. The shell script (`bde-watcher.sh`) contains the actual
watch logic — you must edit its `REPO_DIR` variable to point to your local
repo before use.

---

## Setup

### Step 1 — Edit hardcoded paths

In all plist and shell files, replace the hardcoded placeholder paths with your
actual values:

- Replace `/Users/RBTECHBOT/Documents/Repositories/BDE` with your repo path
- Replace `/Users/RBTECHBOT` with your home directory

Also open `bde-watcher.sh` and set the `REPO_DIR` variable at the top of the
file to your repo path.

### Step 2 — Install `com.rbtechbot.bde.plist`

```bash
cp scripts/dev/com.rbtechbot.bde.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.rbtechbot.bde.plist
```

### Step 3 — Install `com.rbtechbot.bde-watcher.plist`

```bash
cp scripts/dev/com.rbtechbot.bde-watcher.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.rbtechbot.bde-watcher.plist
```

To stop either agent:

```bash
launchctl unload ~/Library/LaunchAgents/com.rbtechbot.bde.plist
launchctl unload ~/Library/LaunchAgents/com.rbtechbot.bde-watcher.plist
```
