#!/usr/bin/env bash
# .claude/hooks/artifact-drift-check.sh
# PostToolUse hook: warns on generated artifacts under src/ and status doc edits.
# Exit 2 = show as non-blocking feedback to Claude.

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

# --- Check 1: generated artifact under src/ ---
if echo "$fp" | grep -qE '/src/.*\.(js|d\.ts|js\.map)$'; then
  echo "WARNING: Generated artifact written under src/: $fp"
  echo "Files matching *.js / *.d.ts / *.js.map under src/ should not be committed."
  echo "Delete if unintentional, or verify this is expected (e.g. a deliberate JS file, not tsc output)."
  exit 2
fi

# --- Check 2: PROGRAM_STATUS.md edited — remind to sync Linear ---
if echo "$fp" | grep -q "PROGRAM_STATUS.md"; then
  echo "REMINDER: PROGRAM_STATUS.md was updated."
  echo "Verify that Linear issue statuses reflect the current program state."
  echo "  pnpm linear:issues   — check queue state"
  exit 2
fi

exit 0
