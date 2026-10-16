#!/usr/bin/env bash
# Assembles the published self-contained output into a macOS .app and a .dmg.
set -euo pipefail

publish_dir="$1"
out_dir="$2"
arch="$3"
version="$4"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

app="$out_dir/AE-MCP Setup.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp -R "$publish_dir"/* "$app/Contents/MacOS/"
cp "$here/icon.icns" "$app/Contents/Resources/icon.icns"

cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>AE-MCP Setup</string>
  <key>CFBundleDisplayName</key><string>AE-MCP Setup</string>
  <key>CFBundleIdentifier</key><string>com.aemcp.setup</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>AE-MCP Setup</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppleEventsUsageDescription</key><string>AE-MCP Setup runs a script in your open After Effects to finish installing.</string>
  <key>NSDesktopFolderUsageDescription</key><string>AE-MCP Setup writes its diagnostics report to your Desktop.</string>
</dict>
</plist>
PLIST

# Re-sign ad-hoc with the bundle identifier so macOS TCC (Automation/Desktop) and
# the admin prompt key on com.aemcp.setup instead of the .NET apphost default.
# --deep also signs the nested native libs (.NET publishes Avalonia.Native.dll as Mach-O).
codesign --force --deep --sign - --identifier com.aemcp.setup "$app"

dmg="$out_dir/AE-MCP Setup-${version}-${arch}.dmg"
rm -f "$dmg"
stage="$(mktemp -d)"
cp -R "$app" "$stage/"
ln -s /Applications "$stage/Applications"
# The app is ad-hoc signed only; this helper clears the download quarantine (#187).
cp "$here/unquarantine.command" "$stage/If Setup will not open.command"
chmod +x "$stage/If Setup will not open.command"
hdiutil create -volname "AE-MCP Setup" -srcfolder "$stage" -ov -format UDZO "$dmg"
rm -rf "$stage"

echo "built $dmg"
