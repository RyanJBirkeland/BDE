# Developer Launch Agent Scripts

These scripts set up macOS launchd agents for local development only.
**They are NOT bundled with the BDE app and require manual setup.**

## Setup

1. Edit the plist/sh files to replace the hardcoded paths with your actual paths:
   - Replace `/Users/RBTECHBOT/Documents/Repositories/BDE` with your repo path
   - Replace `/Users/RBTECHBOT` with your home directory

2. Copy to LaunchAgents: `cp com.rbtechbot.bde.plist ~/Library/LaunchAgents/`
3. Load: `launchctl load ~/Library/LaunchAgents/com.rbtechbot.bde.plist`
