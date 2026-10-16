#!/bin/bash
# AE-MCP Setup is not notarized, so macOS quarantines it after download and
# refuses to open it ("damaged" or "unidentified developer"). This clears the
# quarantine attributes from the installed app so it opens normally.
app="/Applications/AE-MCP Setup.app"
if [ ! -d "$app" ]; then
    echo "AE-MCP Setup is not in /Applications yet."
    echo "Drag \"AE-MCP Setup\" onto the Applications folder in this window, then run this again."
    read -r -p "Press Return to close."
    exit 1
fi
xattr -cr "$app" && echo "Done: you can now open AE-MCP Setup from Applications." \
    || echo "Could not clear the quarantine on $app. Run in Terminal: xattr -cr \"$app\""
read -r -p "Press Return to close."
