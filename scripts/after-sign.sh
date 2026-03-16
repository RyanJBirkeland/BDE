#!/bin/bash
# Ad-hoc re-sign after electron-builder signs (handles macOS 26 Team ID mismatch)
APP_PATH="$BUILT_APP_PATH"
if [ -z "$APP_PATH" ]; then
  APP_PATH="release/mac-arm64/BDE.app"
fi
echo "Ad-hoc signing: $APP_PATH"
codesign --deep --force --sign - "$APP_PATH" 2>/dev/null || true
