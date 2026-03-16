#!/bin/bash
set -e

echo "=== BDE Install ==="

# Safety: unload dev plist if running
if launchctl list com.rbtechbot.bde-dev &>/dev/null; then
  echo "Unloading dev service..."
  launchctl unload ~/Library/LaunchAgents/com.rbtechbot.bde-dev.plist 2>/dev/null || true
fi

echo "Building..."
npm run build
electron-builder --mac --arm64

echo "Installing to /Applications..."
rm -rf /Applications/BDE.app
cp -r "release/mac-arm64/BDE.app" /Applications/BDE.app

echo "Ad-hoc signing..."
codesign --deep --force --sign - /Applications/BDE.app

echo "Installing launchd service..."
cp scripts/com.rbtechbot.bde.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.rbtechbot.bde.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.rbtechbot.bde.plist

echo "=== Done. BDE installed and will auto-start on login. ==="
echo "Log: /tmp/bde.log"
