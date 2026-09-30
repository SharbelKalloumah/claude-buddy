#!/bin/sh
# Build the macOS speech helper. Needs Xcode Command Line Tools (swiftc).
# It must be a signed .app bundle: macOS only grants speech access to a bundle
# that carries its own usage description.
set -e
cd "$(dirname "$0")"
APP=SpeechHelper.app
mkdir -p "$APP/Contents/MacOS"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>stt</string>
  <key>CFBundleIdentifier</key><string>com.claudebuddy.speechhelper</string>
  <key>CFBundleName</key><string>Claude Buddy Speech</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSBackgroundOnly</key><true/>
  <key>NSSpeechRecognitionUsageDescription</key><string>Claude Buddy turns what you say into a prompt for Claude Code.</string>
</dict></plist>
PLIST
swiftc -O -o "$APP/Contents/MacOS/stt" stt.swift
codesign -s - --force --deep "$APP" >/dev/null 2>&1
echo "built native/$APP"
