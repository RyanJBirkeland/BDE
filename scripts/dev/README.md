# Developer Launch Agent Scripts

These scripts set up macOS launchd agents for local development only.
**They are NOT bundled with the FLEET app and require manual setup.**

## Files

### `com.rbtechbot.fleet.plist`

Launches the FLEET Electron app at login and keeps it alive via launchd.

### `com.rbtechbot.fleet-watcher.plist` + `fleet-watcher.sh`

Runs a background file watcher that triggers rebuilds or other dev tasks when
source files change. The shell script (`fleet-watcher.sh`) contains the actual
watch logic — you must edit its `REPO_DIR` variable to point to your local
repo before use.

---

## Setup

### Step 1 — Edit hardcoded paths

In all plist and shell files, replace the hardcoded placeholder paths with your
actual values:

- Replace `/Users/RBTECHBOT/Documents/Repositories/FLEET` with your repo path
- Replace `/Users/RBTECHBOT` with your home directory

Also open `fleet-watcher.sh` and set the `REPO_DIR` variable at the top of the
file to your repo path.

### Step 2 — Install `com.rbtechbot.fleet.plist`

```bash
cp scripts/dev/com.rbtechbot.fleet.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.rbtechbot.fleet.plist
```

### Step 3 — Install `com.rbtechbot.fleet-watcher.plist`

```bash
cp scripts/dev/com.rbtechbot.fleet-watcher.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.rbtechbot.fleet-watcher.plist
```

To stop either agent:

```bash
launchctl unload ~/Library/LaunchAgents/com.rbtechbot.fleet.plist
launchctl unload ~/Library/LaunchAgents/com.rbtechbot.fleet-watcher.plist
```
