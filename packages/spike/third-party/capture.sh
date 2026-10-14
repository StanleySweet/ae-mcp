#!/bin/sh
# E14-1 spike capture helper.
#
# Runs packages/spike/third-party/investigate.jsx against the comp open in
# After Effects and saves the report under a label, so the "before" and "after"
# runs of a hand-applied preset/tool can be diffed.
#
# usage: capture.sh <label>          # e.g. before | after | motion-after
# env:   AE_APP   (default: Adobe After Effects 2026)
set -e
label="${1:?usage: capture.sh <label>}"
here="$(cd "$(dirname "$0")" && pwd)"
ae_app="${AE_APP:-Adobe After Effects 2026}"
report="$HOME/Desktop/ae-mcp-thirdparty-report.txt"
out="$HOME/Desktop/ae-mcp-thirdparty-${label}.txt"

rm -f "$report"
osascript -e "tell application \"$ae_app\" to DoScriptFile \"$here/investigate.jsx\"" &
pid=$!
( sleep 120; kill "$pid" 2>/dev/null ) &
waiter=$!
wait "$pid" 2>/dev/null || { kill "$waiter" 2>/dev/null; echo "DoScriptFile timed out (AE busy?)" >&2; exit 1; }
kill "$waiter" 2>/dev/null || true

[ -f "$report" ] || { echo "no report written: is a comp open and scripts allowed to write files?" >&2; exit 1; }
cp "$report" "$out"
echo "$out"
