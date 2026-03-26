#!/usr/bin/env bash
# .claude/hooks/suggest-test-group.sh
# PostToolUse hook: maps an edited file path to the relevant pnpm test group.
# Exit 0 = no suggestion. Exit 2 = non-blocking suggestion shown to Claude.

input=$(cat)
file_path=$(echo "$input" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('file_path', ''))
except Exception:
    print('')
" 2>/dev/null || echo "")

[ -z "$file_path" ] && exit 0

# Normalize backslashes to forward slashes
fp="${file_path//\\//}"

group=""

if echo "$fp" | grep -qE '^(apps/api|apps/worker|apps/operator-web)/'; then
  group="test:apps"
elif echo "$fp" | grep -qE '^packages/verification/'; then
  group="test:verification"
elif echo "$fp" | grep -qE '^packages/domain/src/(probability|outcomes/core)/'; then
  group="test:domain-probability"
elif echo "$fp" | grep -qE '^packages/domain/src/(features|models)/'; then
  group="test:domain-features"
elif echo "$fp" | grep -qE '^packages/domain/src/(signals|bands|calibration|scoring)/'; then
  group="test:domain-signals"
elif echo "$fp" | grep -qE '^packages/domain/src/(outcomes|market|eval|edge|rollups|system-health|risk|strategy)/'; then
  group="test:domain-analytics"
fi

if [ -n "$group" ]; then
  echo "Suggested: pnpm $group"
  exit 2
fi

exit 0
