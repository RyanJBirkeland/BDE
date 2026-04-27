#!/bin/bash
set -e

echo "=== FLEET Install ==="

# Safety: unload dev plist if running
if launchctl list com.rbtechbot.fleet-dev &>/dev/null; then
  echo "Unloading dev service..."
  launchctl unload ~/Library/LaunchAgents/com.rbtechbot.fleet-dev.plist 2>/dev/null || true
fi

echo "Building..."
npm run build
electron-builder --mac --arm64

echo "Installing to /Applications..."
rm -rf /Applications/FLEET.app
cp -r "release/mac-arm64/FLEET.app" /Applications/FLEET.app

echo "Ad-hoc signing..."
codesign --deep --force --sign - /Applications/FLEET.app

echo "Installing launchd service..."
cp scripts/com.rbtechbot.fleet.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.rbtechbot.fleet.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.rbtechbot.fleet.plist

echo "=== Done. FLEET installed and will auto-start on login. ==="
echo "Log: /tmp/fleet.log"
