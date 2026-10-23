#!/bin/bash
# Installs a packaged build of this fork as /Applications/T3 Code.app, isolated from
# the official T3 Code apps: its own T3 home and Chromium profile (so it never opens
# the live ~/.t3/userdata database or fights Nightly for the single-instance lock),
# and no auto-update (which would replace the fork with upstream Beta).
#
# Usage: scripts/install-fork-mac.sh [path/to/T3-Code-*.zip]   (defaults to newest in release/)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
ZIP="${1:-$(ls -t "$REPO"/release/T3-Code-*-arm64.zip | head -1)}"
DEST="/Applications/T3 Code.app"
FORK_HOME="$HOME/.t3-fork"
FORK_PROFILE="$HOME/Library/Application Support/t3code-fork"

# Upstream's stable app can live at the same path; never replace it with the fork.
if [ -d "$DEST" ] && [ "$(defaults read "$DEST/Contents/Info" CFBundleIdentifier)" != "com.t3tools.t3code.fork" ]; then
  echo "error: $DEST is not this fork's app. Move or rename it first; its data in ~/.t3 is not touched." >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
ditto -x -k "$ZIP" "$STAGE"
APP="$(find "$STAGE" -maxdepth 1 -name '*.app' | head -1)"
PLIST="$APP/Contents/Info.plist"

# Main bundle must exist or Electron silently shows an unreachable error dialog.
if ! npx --yes @electron/asar list "$APP/Contents/Resources/app.asar" | grep -q '^/apps/desktop/dist-electron/main.cjs$'; then
  echo "error: $ZIP is missing dist-electron/main.cjs (was a dev watcher running during the build?)" >&2
  exit 1
fi

# CFBundleName must keep matching the Helper app names, so only the id and display name change.
plutil -replace CFBundleIdentifier -string "com.t3tools.t3code.fork" "$PLIST"
plutil -replace CFBundleDisplayName -string "T3 Code" "$PLIST"
plutil -replace LSEnvironment -json "$(printf '{"T3CODE_HOME":"%s","T3CODE_DESKTOP_USER_DATA_DIR":"%s","T3CODE_DISABLE_AUTO_UPDATE":"1"}' "$FORK_HOME" "$FORK_PROFILE")" "$PLIST"

xattr -cr "$APP"
codesign --force --deep --sign - "$APP"

rm -rf "$DEST"
ditto "$APP" "$DEST"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST"
echo "Installed $DEST from $(basename "$ZIP")"
